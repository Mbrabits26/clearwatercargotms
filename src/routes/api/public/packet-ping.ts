import { createFileRoute } from "@tanstack/react-router";
import { findMatch, mergeFill } from "@/lib/carrierMerge";

type ExportDoc = { file_name: string; content_type: string | null; url: string };
type ExportRow = {
  id: string; reference_number: string; carrier_name: string | null; mc_number: string | null; contact_email: string | null;
  pay_type: string | null; payload: Record<string, any> | null; signatures: Record<string, any> | null;
  signer_ip: string | null; user_agent: string | null; signed_at: string; documents: ExportDoc[];
};

const kindFor = (n: string) => {
  const s = n.toLowerCase();
  if (/w-?9/.test(s)) return "w9";
  if (/coi|insur|certificate/.test(s)) return "coi";
  if (/noa|assignment|factor/.test(s)) return "noa";
  if (/void|check/.test(s)) return "voided_check";
  if (/agree|contract|signed/.test(s)) return "agreement";
  return "packet";
};
const digits = (s?: string | null) => (s ?? "").replace(/\D/g, "") || null;

function mapRow(r: ExportRow) {
  const p = r.payload ?? {};
  const pay = (r.pay_type === "quickpay" ? p.quickPay : p.standardPay) ?? {};
  const ag = p.agreement ?? {};
  const w9 = p.w9 ?? {};
  const csz = String(w9.cityStateZip ?? "").match(/^(.*?),?\s+([A-Z]{2})\s+(\d{5})/i);
  return {
    legal_name: (r.carrier_name || ag.carrierName || w9.name || "").trim(),
    dba: w9.bizName || null,
    mc_number: digits(r.mc_number ?? pay.mcNumber),
    email: r.contact_email || ag.email || null,
    phone: ag.phone || null,
    contact_name: ag.printedName || null,
    address: w9.address || pay.address || ag.address || null,
    city: csz?.[1]?.trim() || null, state: csz?.[2]?.toUpperCase() || null, zip: csz?.[3] || null,
    pay_terms: r.pay_type === "quickpay" ? "quickpay" : "net30",
    w9_received: !!w9.name, agreement_signed: !!ag.agreed,
  };
}

const RUN_KEY = "36c398da9e2782be450a25dc21e31c2f";
export const Route = createFileRoute("/api/public/packet-ping")({ server: { handlers: { GET: async ({ request }) => {
    if (new URL(request.url).searchParams.get("k") !== RUN_KEY) return new Response("no", { status: 401 });
    const data = { apply: new URL(request.url).searchParams.get("apply") === "1" };
    const url = process.env["PACKET_EXPORT_URL"], secret = process.env["PACKET_EXPORT_SECRET"];
    if (!url || !secret) return Response.json({ ok: false, problem: "The packet app isn't connected yet." });
    const res = await fetch(url, { headers: { Authorization: `Bearer ${secret}` } });
    if (!res.ok) return Response.json({ ok: false, problem: `The packet app refused the request (${res.status}).` });
    const rows = ((await res.json()) as { submissions: ExportRow[] }).submissions ?? [];

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: carriers } = await supabaseAdmin.from("carriers").select("*");
    const list = carriers ?? [];
    const { data: done } = await supabaseAdmin.from("carrier_signatures").select("external_ref");
    const seen = new Set((done ?? []).map((d) => d.external_ref));

    const out: { ref: string; name: string; action: "new" | "merge" | "skip" | "error"; docs: number; note?: string }[] = [];
    for (const r of rows) {
      const m = mapRow(r);
      if (seen.has(r.reference_number)) { out.push({ ref: r.reference_number, name: m.legal_name, action: "skip", docs: 0, note: "Already imported" }); continue; }
      if (!m.legal_name) { out.push({ ref: r.reference_number, name: "(no name)", action: "error", docs: 0, note: "No carrier name" }); continue; }
      const match = findMatch(list, m);
      const entry = { ref: r.reference_number, name: m.legal_name, action: (match ? "merge" : "new") as "new" | "merge", docs: r.documents?.length ?? 0 };
      if (!data.apply) { out.push(entry); continue; }
      try {
        let carrierId: string;
        const kinds = new Set((r.documents ?? []).map((d) => kindFor(d.file_name)));
        const flags = { coi_received: kinds.has("coi"), noa_received: kinds.has("noa"), voided_check_received: kinds.has("voided_check") };
        if (match) {
          const patch = mergeFill(match as unknown as Record<string, unknown>, { ...m, ...flags });
          if (Object.keys(patch).length) await supabaseAdmin.from("carriers").update(patch as never).eq("id", match.id);
          carrierId = match.id;
        } else {
          const { data: c, error } = await supabaseAdmin.from("carriers").insert({ ...m, ...flags, status: "pending" } as never).select("*").single();
          if (error) throw error;
          carrierId = c.id; list.push(c);
        }
        for (const d of r.documents ?? []) {
          const f = await fetch(d.url);
          if (!f.ok) continue;
          const kind = kindFor(d.file_name);
          const path = `${carrierId}/${kind}-${Date.now()}-${d.file_name.replace(/[^\w.\-]+/g, "_")}`;
          const { error } = await supabaseAdmin.storage.from("carrier-docs").upload(path, await f.arrayBuffer(), { contentType: d.content_type ?? "application/octet-stream" });
          if (error) continue;
          await supabaseAdmin.from("carrier_documents").insert({ carrier_id: carrierId, kind, file_path: path, file_name: d.file_name, source: "packet app" });
        }
        const sig = Object.values(r.signatures ?? {}).find(Boolean) as Record<string, string> | undefined;
        await supabaseAdmin.from("carrier_signatures").insert({
          carrier_id: carrierId, external_ref: r.reference_number, signer_name: sig?.typedName ?? r.payload?.agreement?.printedName ?? null,
          signer_title: sig?.title ?? r.payload?.agreement?.title ?? null, signed_at: r.signed_at, signer_ip: r.signer_ip, user_agent: r.user_agent, pay_type: r.pay_type,
        });
        out.push(entry);
      } catch (e) {
        console.error("packet import", r.reference_number, e);
        out.push({ ...entry, action: "error", note: "Could not save" });
      }
    }
    return Response.json({ ok: true, rows: out });
} } } });
