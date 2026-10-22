import { deductionLines } from "./invoiceDeductions";
import { pendingAttachments, qbContentType, qbUploadBody } from "./qbAttachments";
// Server-only QuickBooks Online helpers: OAuth tokens + invoice/bill delivery.
export const QB_REDIRECT_URI = "https://tms.clearwatercargo.com/oauth/quickbooks/return";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const API = "https://quickbooks.api.intuit.com/v3/company";
const MINOR = "minorversion=75";

/** Two QuickBooks companies: 1 = Clearwater Cargo (brokerage AR/AP), 2 = Foust Farms (fleet invoices). */
export type QbEntity = "brokerage" | "fleet";
export const entityId = (e: QbEntity) => (e === "fleet" ? 2 : 1);
/** Fleet invoices go to Foust Farms' QuickBooks; customer invoices and carrier bills go to Clearwater's. */
export const entityForKind = (kind: string): QbEntity => (kind === "fleet_invoice" ? "fleet" : "brokerage");

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

function creds() {
  const id = process.env["QUICKBOOKS_CLIENT_ID"];
  const secret = process.env["QUICKBOOKS_CLIENT_SECRET"];
  if (!id || !secret) throw new Error("QuickBooks keys are not saved yet.");
  return { id, secret, basic: btoa(`${id}:${secret}`) };
}

export function authorizeUrl(state: string) {
  const u = new URL("https://appcenter.intuit.com/connect/oauth2");
  u.searchParams.set("client_id", creds().id);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "com.intuit.quickbooks.accounting");
  u.searchParams.set("redirect_uri", QB_REDIRECT_URI);
  u.searchParams.set("state", state);
  return u.toString();
}

async function tokenCall(body: Record<string, string>) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${creds().basic}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(body).toString(),
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    console.error("QuickBooks token error", res.status, j);
    throw new Error(`QuickBooks sign-in failed (${String(j.error ?? res.status)}).`);
  }
  return j as { access_token: string; refresh_token: string; expires_in: number; x_refresh_token_expires_in?: number };
}

const toRow = (t: Awaited<ReturnType<typeof tokenCall>>) => ({
  access_token: t.access_token,
  refresh_token: t.refresh_token,
  access_expires_at: new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString(),
  refresh_expires_at: t.x_refresh_token_expires_in ? new Date(Date.now() + t.x_refresh_token_expires_in * 1000).toISOString() : null,
  updated_at: new Date().toISOString(),
});

export async function exchangeCode(admin: Admin, code: string, realmId: string, userId: string, entity: QbEntity = "brokerage") {
  // Keep the books separate: the same QuickBooks company can't fill both slots.
  const { data: other } = await admin.from("qb_connection" as never).select("realm_id").eq("id", entityId(entity === "fleet" ? "brokerage" : "fleet")).maybeSingle();
  if ((other as { realm_id?: string } | null)?.realm_id === realmId) throw new Error(`That QuickBooks company is already connected as ${entity === "fleet" ? "Clearwater Cargo" : "Foust Farms"}. Pick the other company when QuickBooks asks.`);
  const t = await tokenCall({ grant_type: "authorization_code", code, redirect_uri: QB_REDIRECT_URI });
  const row = { id: entityId(entity), realm_id: realmId, connected_by: userId, connected_at: new Date().toISOString(), ...toRow(t) };
  let company: string | null = null;
  try {
    const r = await fetch(`${API}/${realmId}/companyinfo/${realmId}?${MINOR}`, { headers: { Authorization: `Bearer ${t.access_token}`, Accept: "application/json" } });
    const j = (await r.json()) as { CompanyInfo?: { CompanyName?: string } };
    company = j.CompanyInfo?.CompanyName ?? null;
  } catch { /* name is optional */ }
  const { error } = await admin.from("qb_connection" as never).upsert({ ...row, company_name: company } as never);
  if (error) throw new Error(error.message);
  return company;
}

type Conn = { realm_id: string; access_token: string; refresh_token: string; access_expires_at: string };

export async function getConn(admin: Admin, entity: QbEntity = "brokerage"): Promise<Conn | null> {
  const { data } = await admin.from("qb_connection" as never).select("*").eq("id", entityId(entity)).maybeSingle();
  const c = data as Conn | null;
  if (!c) return null;
  if (new Date(c.access_expires_at).getTime() > Date.now()) return c;
  const t = await tokenCall({ grant_type: "refresh_token", refresh_token: c.refresh_token });
  const upd = toRow(t);
  await admin.from("qb_connection" as never).update(upd as never).eq("id", entityId(entity));
  return { ...c, ...upd };
}

class Qb {
  constructor(private c: Conn) {}
  async req<T = Record<string, unknown>>(path: string, body?: unknown): Promise<T> {
    const sep = path.includes("?") ? "&" : "?";
    const res = await fetch(`${API}/${this.c.realm_id}/${path}${sep}${MINOR}`, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${this.c.access_token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const f = (j.Fault as { Error?: { Message?: string; Detail?: string }[] } | undefined)?.Error?.[0];
      throw new Error(f ? `${f.Message}${f.Detail ? ` — ${f.Detail}` : ""}` : `QuickBooks error ${res.status}`);
    }
    return j as T;
  }
  async query<T>(entity: string, where: string): Promise<T[]> {
    const q = encodeURIComponent(`select * from ${entity} ${where} maxresults 5`);
    const j = await this.req<{ QueryResponse: Record<string, T[]> }>(`query?query=${q}`);
    return j.QueryResponse?.[entity] ?? [];
  }
  /** Uploads one file and links it to an Invoice or Bill (QuickBooks Attachable). */
  async attach(type: "Invoice" | "Bill", id: string, bytes: Uint8Array, fileName: string, contentType: string, includeOnSend: boolean) {
    const boundary = `cwc${crypto.randomUUID().replace(/-/g, "")}`;
    const meta = { AttachableRef: [{ EntityRef: { type, value: id }, ...(type === "Invoice" ? { IncludeOnSend: includeOnSend } : {}) }], FileName: fileName, ContentType: contentType };
    const res = await fetch(`${API}/${this.c.realm_id}/upload?${MINOR}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.c.access_token}`, Accept: "application/json", "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body: qbUploadBody(boundary, meta, bytes, fileName, contentType),
    });
    const j = (await res.json().catch(() => ({}))) as { AttachableResponse?: { Fault?: { Error?: { Message?: string; Detail?: string }[] } }[]; Fault?: { Error?: { Message?: string; Detail?: string }[] } };
    const f = j.Fault?.Error?.[0] ?? j.AttachableResponse?.[0]?.Fault?.Error?.[0];
    if (!res.ok || f) throw new Error(f ? `${f.Message}${f.Detail ? ` — ${f.Detail}` : ""}` : `QuickBooks upload error ${res.status}`);
  }
}
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
type Ref = { Id: string; Name?: string; DisplayName?: string };

async function party(qb: Qb, entity: "Customer" | "Vendor", name: string) {
  const n = name.slice(0, 100).replace(/:/g, "-");
  const found = await qb.query<Ref>(entity, `where DisplayName = '${esc(n)}'`);
  if (found[0]) return found[0].Id;
  const j = await qb.req<Record<string, Ref>>(entity.toLowerCase(), { DisplayName: n });
  return j[entity]!.Id;
}
async function account(qb: Qb, types: string[]) {
  for (const t of types) {
    const a = await qb.query<Ref>("Account", `where AccountType = '${t}' and Active = true`);
    const freight = a.find((x) => /freight|haul|transport/i.test(x.Name ?? ""));
    const hit = freight ?? a[0]; if (hit) return hit.Id;
  }
  throw new Error(`No ${types.join("/")} account found in QuickBooks.`);
}
async function freightItem(qb: Qb) {
  const found = await qb.query<Ref>("Item", `where Name = 'Freight Services'`);
  if (found[0]) return found[0].Id;
  const inc = await account(qb, ["Income"]);
  const j = await qb.req<{ Item: Ref }>("item", { Name: "Freight Services", Type: "Service", IncomeAccountRef: { value: inc } });
  return j.Item.Id;
}
async function klass(qb: Qb, name: string | null) {
  if (!name) return null;
  try {
    const found = await qb.query<Ref>("Class", `where Name = '${esc(name)}'`);
    if (found[0]) return found[0].Id;
    return (await qb.req<{ Class: Ref }>("class", { Name: name })).Class.Id;
  } catch {
    return null; // class tracking may be off in this company file
  }
}

type SyncRow = { id: string; kind: string; payee: string | null; amount: number; invoice_number: string | null; qb_class: string | null; qb_ref: string | null; load_id: string; deductions?: unknown };
type LoadLite = { id: string; load_number: string; origin_city: string | null; origin_state: string | null; dest_city: string | null; dest_state: string | null; delivery_at: string | null };

export async function deliverQueued(admin: Admin, ids?: string[]) {
  let q = admin.from("qb_sync").select("*").in("status", ["queued", "error"]).is("qb_ref", null);
  if (ids?.length) q = q.in("id", ids);
  const { data: rows } = await q.limit(100);
  const list = (rows ?? []) as SyncRow[];
  if (!list.length) return { sent: 0, failed: 0 };
  const { data: loads } = await admin.from("loads").select("id, load_number, origin_city, origin_state, dest_city, dest_state, delivery_at").in("id", list.map((r) => r.load_id));
  const byId = new Map(((loads ?? []) as LoadLite[]).map((l) => [l.id, l]));
  let sent = 0, failed = 0;
  // Each row goes to its own company's QuickBooks (connections are opened lazily, once per company).
  const conns = new Map<QbEntity, Promise<Qb | null>>();
  const qbFor = (e: QbEntity) => {
    if (!conns.has(e)) conns.set(e, getConn(admin, e).then((c) => (c ? new Qb(c) : null)));
    return conns.get(e)!;
  };
  // Combined invoices: several rows share one invoice_number → one QuickBooks invoice with a line per load.
  const made = new Map<string, string>();
  const laneOf = (x?: LoadLite) => (x ? `${x.load_number}: ${x.origin_city ?? ""}, ${x.origin_state ?? ""} to ${x.dest_city ?? ""}, ${x.dest_state ?? ""}` : "");
  for (const r of list) {
    const l = byId.get(r.load_id);
    try {
      if (!l) throw new Error("Load not found.");
      const ent = entityForKind(r.kind);
      const qb = await qbFor(ent);
      if (!qb) throw new Error(ent === "fleet" ? "Foust Farms QuickBooks is not connected." : "Clearwater Cargo QuickBooks is not connected.");
      const lane = `${l.load_number}: ${l.origin_city ?? ""}, ${l.origin_state ?? ""} to ${l.dest_city ?? ""}, ${l.dest_state ?? ""}`;
      const classId = await klass(qb, r.qb_class);
      const classRef = classId ? { ClassRef: { value: classId } } : {};
      const txnDate = (l.delivery_at ?? new Date().toISOString()).slice(0, 10);
      let ref: string;
      if (r.kind === "bill") {
        const doc = l.load_number.slice(0, 21);
        const vendor = await party(qb, "Vendor", r.payee || "Unknown carrier");
        const dup = await qb.query<Ref>("Bill", `where DocNumber = '${esc(doc)}'`);
        if (dup[0]) ref = dup[0].Id;
        else {
          const acct = await account(qb, ["Cost of Goods Sold", "Expense"]);
          const j = await qb.req<{ Bill: Ref }>("bill", {
            VendorRef: { value: vendor }, DocNumber: doc, TxnDate: txnDate, PrivateNote: lane,
            Line: [{ Amount: Number(r.amount), DetailType: "AccountBasedExpenseLineDetail", Description: `Carrier pay — ${lane}`, AccountBasedExpenseLineDetail: { AccountRef: { value: acct }, ...classRef } }],
          });
          ref = j.Bill.Id;
        }
      } else {
        const doc = (r.invoice_number ?? l.load_number).slice(0, 21);
        const group = r.invoice_number ? list.filter((x) => x.kind === r.kind && x.invoice_number === r.invoice_number) : [r];
        const cust = await party(qb, "Customer", r.payee || "Unknown customer");
        const dup = await qb.query<Ref>("Invoice", `where DocNumber = '${esc(doc)}'`);
        if (made.has(`${r.kind}:${doc}`)) ref = made.get(`${r.kind}:${doc}`)!;
        else if (dup[0]) ref = dup[0].Id;
        else {
          const item = await freightItem(qb);
          const j = await qb.req<{ Invoice: Ref }>("invoice", {
            CustomerRef: { value: cust }, DocNumber: doc, TxnDate: txnDate, PrivateNote: lane, ...classRef,
            SalesTermRef: undefined,
            // Freight line per load, then each percentage deduction as a negative line so QuickBooks totals what the customer owes.
            Line: group.flatMap((g) => [
              { Amount: Number(g.amount), DetailType: "SalesItemLineDetail", Description: `Freight — ${laneOf(byId.get(g.load_id)) || lane}`, SalesItemLineDetail: { ItemRef: { value: item }, Qty: 1, UnitPrice: Number(g.amount), ...classRef } },
              ...deductionLines(Number(g.amount), g.deductions).map((d) => ({ Amount: d.amount, DetailType: "SalesItemLineDetail", Description: `${d.label} — ${byId.get(g.load_id)?.load_number ?? ""}`, SalesItemLineDetail: { ItemRef: { value: item }, Qty: 1, UnitPrice: d.amount, ...classRef } })),
            ]),
          });
          ref = j.Invoice.Id;
        }
      }
      if (r.kind !== "bill") made.set(`${r.kind}:` + (r.invoice_number ?? l.load_number).slice(0, 21), ref);
      await admin.from("qb_sync").update({ status: "sent", qb_ref: ref, error: null, sent_at: new Date().toISOString() }).eq("id", r.id);
      sent++;
    } catch (e) {
      await admin.from("qb_sync").update({ status: "error", error: (e as Error).message.slice(0, 500) }).eq("id", r.id);
      failed++;
    }
  }
  return { sent, failed };
}

type AttachRow = { id: string; kind: string; qb_ref: string; attachments: unknown; attachments_sent: unknown; attach_on_send: boolean };
const MAX_BYTES = 25 * 1024 * 1024;
/** Uploads picked load documents onto invoices/bills that already exist in QuickBooks. Each file goes once. */
export async function sendAttachments(admin: Admin, ids?: string[]) {
  let q = admin.from("qb_sync").select("id, kind, qb_ref, attachments, attachments_sent, attach_on_send").eq("status", "sent").not("qb_ref", "is", null).not("attachments->0", "is", null);
  if (ids?.length) q = q.in("id", ids);
  const { data } = await q.limit(200);
  const rows = ((data ?? []) as unknown as AttachRow[]).filter((r) => pendingAttachments(r.attachments, r.attachments_sent).length);
  let attached = 0, attachFailed = 0;
  const conns = new Map<QbEntity, Promise<Qb | null>>();
  for (const r of rows) {
    const ent = entityForKind(r.kind);
    if (!conns.has(ent)) conns.set(ent, getConn(admin, ent).then((c) => (c ? new Qb(c) : null)));
    const qb = await conns.get(ent)!;
    const sent = Array.isArray(r.attachments_sent) ? [...(r.attachments_sent as string[])] : [];
    const errs: string[] = [];
    for (const a of pendingAttachments(r.attachments, r.attachments_sent)) {
      try {
        if (!qb) throw new Error(ent === "fleet" ? "Foust Farms QuickBooks is not connected." : "Clearwater Cargo QuickBooks is not connected.");
        const type = qbContentType(a.name);
        if (!type) throw new Error("QuickBooks doesn't accept this file type (use PDF, JPG, PNG, Word, Excel or text).");
        const { data: blob, error } = await admin.storage.from("load-docs").download(a.path);
        if (error || !blob) throw new Error("File not found in load documents.");
        if (blob.size > MAX_BYTES) throw new Error("File is over 25 MB.");
        await qb.attach(r.kind === "bill" ? "Bill" : "Invoice", r.qb_ref, new Uint8Array(await blob.arrayBuffer()), a.name, type, r.attach_on_send);
        sent.push(a.path); attached++;
      } catch (e) {
        errs.push(`${a.name}: ${(e as Error).message}`); attachFailed++;
      }
    }
    await admin.from("qb_sync").update({ attachments_sent: sent, attach_error: errs.length ? errs.join(" · ").slice(0, 500) : null } as never).eq("id", r.id);
  }
  return { attached, attachFailed };
}

type RawInv = { Id: string; DocNumber?: string; TxnDate?: string; TotalAmt?: number; Balance?: number; CustomerRef?: { name?: string }; PrivateNote?: string; CustomerMemo?: { value?: string }; ShipAddr?: Record<string, string>; Line?: { Amount?: number; Description?: string; DetailType?: string }[] };
/** Read-only pull of QuickBooks invoices in a date range (paged, max 2000). */
export async function scanInvoices(admin: Admin, from: string, to: string, openOnly: boolean, entity: QbEntity = "brokerage") {
  const c = await getConn(admin, entity);
  if (!c) throw new Error(entity === "fleet" ? "Foust Farms QuickBooks isn't connected." : "Clearwater Cargo QuickBooks isn't connected.");
  const qb = new Qb(c);
  const where: string[] = [];
  if (from) where.push(`TxnDate >= '${from}'`);
  if (to) where.push(`TxnDate <= '${to}'`);
  if (openOnly) where.push(`Balance > '0'`);
  const out: RawInv[] = [];
  for (let start = 1; start <= 2000; start += 500) {
    const q = encodeURIComponent(`select * from Invoice ${where.length ? "where " + where.join(" and ") : ""} startposition ${start} maxresults 500`);
    const j = await qb.req<{ QueryResponse: { Invoice?: RawInv[] } }>(`query?query=${q}`);
    const page = j.QueryResponse?.Invoice ?? [];
    out.push(...page);
    if (page.length < 500) break;
  }
  return out.map((i) => {
    const lines = (i.Line ?? []).filter((l) => l.DetailType !== "SubTotalLineDetail").map((l) => ({ amount: Number(l.Amount ?? 0), description: l.Description ?? "" }));
    const text = [i.PrivateNote, i.CustomerMemo?.value, ...lines.map((l) => l.description), ...Object.values(i.ShipAddr ?? {})].filter(Boolean).join(" ");
    return { id: i.Id, docNumber: i.DocNumber ?? null, date: i.TxnDate ?? null, customer: i.CustomerRef?.name ?? "", total: Number(i.TotalAmt ?? 0), balance: Number(i.Balance ?? 0), lines, text };
  });
}
