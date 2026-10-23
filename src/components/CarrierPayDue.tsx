import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Banknote, Eye, EyeOff, Pencil, Settings2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { carrierPayDue, maskAccount, owesCarrier, payTo, shouldNotify } from "@/lib/carrierPay";
import { usd, type Carrier, type Load } from "@/lib/tms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DocLink, type DocItem } from "@/components/DocPreview";
import { ReportExport } from "@/components/ReportExport";
import type { ReportSpec } from "@/lib/reportExport";

const LEAD_KEY = "cw_pay_lead_days";
const day = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const dueText = (n: number) => (n < 0 ? `${-n} day${n === -1 ? "" : "s"} late` : n === 0 ? "due today" : `in ${n} day${n === 1 ? "" : "s"}`);

type Item = { l: Load; c: Carrier | undefined; d: ReturnType<typeof carrierPayDue>; bill?: { status: string; qb_ref: string | null } };
type Group = { carrier: Carrier | undefined; id: string; items: Item[]; net: number; newest: number; soonest: number; quickPay: boolean };

/** Admin/accountant notice: carriers whose pay is due (Quick Pay as soon as the POD is in, Net 30 near its due date). */
export function CarrierPayDue() {
  const [lead, setLead] = useState(3);
  useEffect(() => { const v = Number(localStorage.getItem(LEAD_KEY)); if (v > 0) setLead(v); }, []);
  const [dismissed, setDismissed] = useState(false);
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<"due" | "all">("due");
  const [sel, setSel] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["carrier_pay_due"],
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const statuses = ["delivered", "invoiced", "paid"] as const;
      // 1) POD in or marked Invoiced; 2) any load with a customer invoice (older loads cleaned up without a POD).
      const [a, b] = await Promise.all([
        supabase.from("loads").select("*").or("pod_received.eq.true,status.eq.invoiced").is("carrier_paid_at", null)
          .not("carrier_id", "is", null).in("status", [...statuses]).order("pod_received_at", { ascending: false, nullsFirst: false }).limit(1000),
        supabase.from("loads").select("*, qb_sync!inner(kind)").in("qb_sync.kind", ["invoice", "fleet_invoice"]).is("carrier_paid_at", null)
          .not("carrier_id", "is", null).in("status", [...statuses]).limit(1000),
      ]);
      if (a.error) throw a.error;
      if (b.error) throw b.error;
      const invoiced = new Set((b.data ?? []).map((l) => l.id));
      const byId = new Map<string, Load>();
      for (const row of [...(a.data ?? []), ...(b.data ?? [])]) {
        const { qb_sync: _x, ...l } = row as Load & { qb_sync?: unknown };
        if (!byId.has(l.id)) byId.set(l.id, l as Load);
      }
      const owed = [...byId.values()].filter((l) => owesCarrier(l, invoiced.has(l.id)));
      const ids = [...new Set(owed.map((l) => l.carrier_id!))];
      const [cs, bills] = await Promise.all([
        ids.length ? supabase.from("carriers").select("*").in("id", ids) : Promise.resolve({ data: [] as Carrier[] }),
        owed.length ? supabase.from("qb_sync").select("load_id, status, qb_ref").eq("kind", "bill").in("load_id", owed.map((l) => l.id)) : Promise.resolve({ data: [] }),
      ]);
      return { loads: owed, carriers: (cs.data ?? []) as Carrier[], bills: (bills.data ?? []) as { load_id: string; status: string; qb_ref: string | null }[] };
    },
  });

  const { groups, dueGroups } = useMemo(() => {
    if (!data) return { groups: [] as Group[], dueGroups: [] as Group[] };
    const items: Item[] = data.loads.map((l) => {
      const c = data.carriers.find((x) => x.id === l.carrier_id);
      return { l, c, d: carrierPayDue(l, c), bill: data.bills.find((b) => b.load_id === l.id) };
    });
    const group = (list: Item[]) => {
      const m = new Map<string, Item[]>();
      for (const it of list) m.set(it.l.carrier_id!, [...(m.get(it.l.carrier_id!) ?? []), it]);
      return [...m.entries()].map(([id, its]) => {
        const sorted = [...its].sort((a, b) => b.d.podAt - a.d.podAt); // newest to oldest
        return { id, carrier: sorted[0]!.c, items: sorted, net: sorted.reduce((t, x) => t + x.d.net, 0), newest: sorted[0]!.d.podAt, soonest: Math.min(...sorted.map((x) => x.d.due)), quickPay: sorted.some((x) => x.d.quickPay) };
      }).sort((a, b) => b.newest - a.newest);
    };
    return { groups: group(items), dueGroups: group(items.filter((x) => shouldNotify(x.d, lead))) };
  }, [data, lead]);

  if (dismissed || !dueGroups.length) return null;
  const dueLoads = dueGroups.reduce((t, g) => t + g.items.length, 0);
  const dueNet = dueGroups.reduce((t, g) => t + g.net, 0);
  const qpCount = dueGroups.filter((g) => g.quickPay).length;
  const list = scope === "due" ? dueGroups : groups;
  const current = list.find((g) => g.id === sel) ?? groups.find((g) => g.id === sel);
  const saveLead = (n: number) => { setLead(n); localStorage.setItem(LEAD_KEY, String(n)); };

  return (
    <div className="mx-3 mt-2 flex items-center gap-2 rounded border border-gold/50 bg-gold/10 px-3 py-2 text-sm">
      <Banknote className="h-4 w-4 shrink-0 text-gold" />
      <span className="min-w-0 flex-1">
        <button type="button" className="font-bold underline" onClick={() => { setSel(null); setScope("due"); setOpen(true); }}>
          {dueGroups.length} carrier{dueGroups.length > 1 ? "s" : ""} due to be paid
        </button>{" "}
        ({dueLoads} load{dueLoads > 1 ? "s" : ""} · {usd(dueNet)}){qpCount > 0 && <> · <b className="text-gold">{qpCount} Quick Pay</b></>}
      </span>
      <Popover>
        <PopoverTrigger asChild><Button size="icon" variant="ghost" aria-label="Pay notice timing"><Settings2 className="h-4 w-4" /></Button></PopoverTrigger>
        <PopoverContent className="w-64 space-y-2 text-sm">
          <p className="font-semibold">Net 30 heads-up</p>
          <label className="flex items-center justify-between gap-2 text-xs">Days before due<Input type="number" min={0} className="h-8 w-20" value={lead} onChange={(e) => saveLead(Math.max(0, Number(e.target.value) || 0))} /></label>
          <p className="text-xs text-muted-foreground">Quick Pay carriers always show as soon as the POD is in.</p>
        </PopoverContent>
      </Popover>
      <Button size="icon" variant="ghost" aria-label="Dismiss" onClick={() => setDismissed(true)}><X className="h-4 w-4" /></Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[88dvh] w-[96vw] flex-col gap-3 sm:max-w-5xl">
          <DialogHeader className="shrink-0">
            <DialogTitle className="font-display text-2xl uppercase">{current ? current.carrier?.legal_name ?? "Carrier" : "Carriers to pay"}</DialogTitle>
            <DialogDescription>{current ? "Pay details, payment account and the loads waiting on payment." : "Newest first. Click a carrier to see what to pay and where to send it."}</DialogDescription>
          </DialogHeader>
          {current ? (
            <PayDetail group={current} onBack={() => setSel(null)} onLeave={() => setOpen(false)} />
          ) : (
            <>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button size="sm" variant={scope === "due" ? "default" : "outline"} onClick={() => setScope("due")}>Due now ({dueGroups.length})</Button>
                <Button size="sm" variant={scope === "all" ? "default" : "outline"} onClick={() => setScope("all")}>All unpaid ({groups.length})</Button>
                <ReportExport className="ml-auto" build={(): ReportSpec => {
                  const loadsN = list.reduce((t, g) => t + g.items.length, 0), net = list.reduce((t, g) => t + g.net, 0);
                  return {
                    title: scope === "due" ? "Carriers due to be paid" : "All unpaid carriers",
                    summary: [["Carriers", String(list.length)], ["Loads", String(loadsN)], ["Net to pay", usd(net)], ["Quick Pay carriers", String(list.filter((g) => g.quickPay).length)]],
                    head: ["Carrier", "Pay to", "Terms", "Load #s", "Loads", "Newest", "Next due", "Carrier pay", "Quick Pay fee", "Net to pay"], right: [4, 7, 8, 9],
                    rows: list.map((g) => {
                      const left = Math.ceil((g.soonest - Date.now()) / 86_400_000);
                      return [g.carrier?.legal_name ?? "Unknown carrier", payTo(g.carrier).name, [...new Set(g.items.map((x) => x.d.pt.terms))].join(" / "), g.items.map((x) => x.l.load_number).join(", "), String(g.items.length),
                        day(g.newest), `${day(g.soonest)} (${dueText(left)})`, usd(g.items.reduce((t, x) => t + x.d.gross, 0)), usd(g.items.reduce((t, x) => t + x.d.fee, 0)), usd(g.net)];
                    }),
                    total: ["Total", "", "", "", String(loadsN), "", "", usd(list.reduce((t, g) => t + g.items.reduce((a, x) => a + x.d.gross, 0), 0)), usd(list.reduce((t, g) => t + g.items.reduce((a, x) => a + x.d.fee, 0), 0)), usd(net)],
                  };
                }} />
              </div>
              <div className="min-h-0 flex-1 overflow-auto rounded border">
                <table className="w-full min-w-[700px] text-sm">
                  <thead className="sticky top-0 bg-card text-left text-xs uppercase text-muted-foreground">
                    <tr><th className="p-2">Carrier</th><th className="p-2">Pay to</th><th className="p-2">Terms</th><th className="p-2">Loads</th><th className="p-2">Newest</th><th className="p-2">Next due</th><th className="p-2 text-right">Net to pay</th></tr>
                  </thead>
                  <tbody>
                    {list.map((g) => {
                      const left = Math.ceil((g.soonest - Date.now()) / 86_400_000);
                      return (
                        <tr key={g.id} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => setSel(g.id)}>
                          <td className="p-2 font-semibold text-gold underline">{g.carrier?.legal_name ?? "Unknown carrier"}</td>
                          <td className="p-2">{payTo(g.carrier).name}</td>
                          <td className="p-2">{[...new Set(g.items.map((x) => x.d.pt.terms))].join(" / ")}</td>
                          <td className="p-2">{g.items.length}</td>
                          <td className="p-2">{day(g.newest)}</td>
                          <td className={left < 0 ? "p-2 font-semibold text-destructive" : "p-2"}>{day(g.soonest)} <span className="text-xs">({dueText(left)})</span></td>
                          <td className="p-2 text-right font-semibold">{usd(g.net)}</td>
                        </tr>
                      );
                    })}
                    {!list.length && <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">Nothing waiting.</td></tr>}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

type Account = { method: string; bank_name: string | null; account_name: string | null; routing_number: string | null; account_number: string | null; account_type: string | null; remit_email: string | null; notes: string | null };
const EMPTY: Account = { method: "ach", bank_name: "", account_name: "", routing_number: "", account_number: "", account_type: "checking", remit_email: "", notes: "" };

function PayDetail({ group, onBack, onLeave }: { group: Group; onBack: () => void; onLeave: () => void }) {
  const qc = useQueryClient();
  const c = group.carrier;
  const to = payTo(c);
  const [picked, setPicked] = useState<string[]>(group.items.map((x) => x.l.id));
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [edit, setEdit] = useState<Account | null>(null);

  const { data: acct } = useQuery({
    queryKey: ["carrier_payment_account", group.id],
    queryFn: async () => (await supabase.from("carrier_payment_accounts").select("*").eq("carrier_id", group.id).maybeSingle()).data as Account | null,
  });
  const { data: docs = [] } = useQuery({
    queryKey: ["carrier_pay_docs", group.id],
    queryFn: async () => (await supabase.from("carrier_documents").select("kind, file_path, file_name").eq("carrier_id", group.id).in("kind", ["w9", "voided_check", "noa"]).order("uploaded_at", { ascending: false })).data ?? [],
  });
  const docItems: DocItem[] = docs.map((d) => ({ name: `${({ w9: "W-9", voided_check: "Voided check", noa: "NOA" } as Record<string, string>)[d.kind] ?? d.kind} — ${d.file_name}`, bucket: "carrier-docs", path: d.file_path }));

  const chosen = group.items.filter((x) => picked.includes(x.l.id));
  const total = chosen.reduce((t, x) => t + x.d.net, 0);

  const saveAcct = async () => {
    if (!edit) return;
    const { error } = await supabase.from("carrier_payment_accounts").upsert({ carrier_id: group.id, ...edit });
    if (error) return toast.error(error.message);
    toast.success("Payment account saved");
    setEdit(null);
    qc.invalidateQueries({ queryKey: ["carrier_payment_account", group.id] });
  };
  const markPaid = async () => {
    if (!chosen.length) return toast.info("Tick the loads you paid.");
    if (!confirm(`Mark ${chosen.length} load(s) paid to ${to.name} for ${usd(total)}?`)) return;
    setBusy(true);
    const { error } = await supabase.from("loads").update({ carrier_paid_at: new Date().toISOString(), carrier_paid_ref: ref.trim() || null }).in("id", chosen.map((x) => x.l.id));
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Marked ${chosen.length} load(s) paid`);
    qc.invalidateQueries({ queryKey: ["carrier_pay_due"] });
    qc.invalidateQueries({ queryKey: ["loads"] });
    onBack();
  };
  const field = (k: keyof Account, label: string, type = "text") => (
    <label className="text-xs text-muted-foreground">{label}
      <Input type={type} className="mt-1 h-9" value={edit?.[k] ?? ""} onChange={(e) => setEdit((p) => ({ ...(p ?? EMPTY), [k]: e.target.value }))} />
    </label>
  );

  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-auto">
      <Button size="sm" variant="ghost" onClick={onBack}><ArrowLeft className="mr-1 h-4 w-4" />All carriers</Button>
      <div className="grid gap-3 md:grid-cols-3">
        <section className="rounded border p-3 text-sm">
          <h3 className="mb-1 text-xs font-bold uppercase text-gold">Pay to</h3>
          <p className="font-semibold">{to.name}</p>
          {to.factored && <p className="text-xs text-muted-foreground">Factoring company for {to.forCarrier}</p>}
          <p className="whitespace-pre-line">{to.address || <span className="text-muted-foreground">No remit-to address on file</span>}</p>
          {to.noaMissing && <p className="mt-1 text-xs font-semibold text-destructive">NOA not on file — confirm before paying the factoring company.</p>}
          <p className="mt-2 text-xs text-muted-foreground">Terms: {[...new Set(group.items.map((x) => x.d.pt.terms))].join(" / ")}</p>
        </section>
        <section className="rounded border p-3 text-sm">
          <h3 className="mb-1 text-xs font-bold uppercase text-gold">Carrier contact</h3>
          <p>{c?.contact_name || "—"}</p>
          <p>{c?.phone || "—"}</p>
          <p className="break-all">{c?.email || "—"}</p>
          <p className="mt-1 text-xs text-muted-foreground">MC {c?.mc_number || "—"} · DOT {c?.dot_number || "—"}</p>
          <div className="mt-2 space-y-0.5 text-xs">
            {docItems.map((d, i) => <div key={d.path}><DocLink items={docItems} index={i}>{d.name}</DocLink></div>)}
            {!docItems.length && <p className="text-muted-foreground">No W-9, voided check or NOA uploaded.</p>}
          </div>
        </section>
        <section className="rounded border p-3 text-sm">
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase text-gold">Payment account</h3>
            <div className="flex">
              {acct?.account_number && <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={reveal ? "Hide numbers" : "Show numbers"} onClick={() => setReveal(!reveal)}>{reveal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</Button>}
              <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Edit payment account" onClick={() => setEdit(edit ? null : { ...EMPTY, ...(acct ?? {}) })}><Pencil className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
          {edit ? (
            <div className="grid gap-2">
              <label className="text-xs text-muted-foreground">Method
                <select className="mt-1 h-9 w-full rounded border bg-background px-2 text-sm" value={edit.method} onChange={(e) => setEdit({ ...edit, method: e.target.value })}>
                  <option value="ach">ACH / direct deposit</option><option value="check">Check</option><option value="wire">Wire</option><option value="other">Other</option>
                </select>
              </label>
              {field("bank_name", "Bank")}
              {field("account_name", "Name on account")}
              {field("routing_number", "Routing #")}
              {field("account_number", "Account #")}
              <label className="text-xs text-muted-foreground">Account type
                <select className="mt-1 h-9 w-full rounded border bg-background px-2 text-sm" value={edit.account_type ?? "checking"} onChange={(e) => setEdit({ ...edit, account_type: e.target.value })}>
                  <option value="checking">Checking</option><option value="savings">Savings</option>
                </select>
              </label>
              {field("remit_email", "Remittance email", "email")}
              {field("notes", "Notes")}
              <div className="flex gap-2"><Button size="sm" onClick={saveAcct}>Save</Button><Button size="sm" variant="outline" onClick={() => setEdit(null)}>Cancel</Button></div>
            </div>
          ) : acct ? (
            <div className="space-y-0.5">
              <p className="uppercase">{acct.method}</p>
              <p>{acct.bank_name || "—"}{acct.account_type ? ` · ${acct.account_type}` : ""}</p>
              <p>{acct.account_name || "—"}</p>
              <p>Routing {reveal ? acct.routing_number || "—" : maskAccount(acct.routing_number)}</p>
              <p>Account {reveal ? acct.account_number || "—" : maskAccount(acct.account_number)}</p>
              {acct.remit_email && <p className="break-all">Remit: {acct.remit_email}</p>}
              {acct.notes && <p className="text-xs text-muted-foreground">{acct.notes}</p>}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No bank details saved. Click the pencil to add them (only admins and accountants can see these).</p>
          )}
        </section>
      </div>

      <div className="overflow-auto rounded border">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="sticky top-0 bg-card text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="p-2"><Checkbox checked={picked.length === group.items.length} onCheckedChange={(v) => setPicked(v ? group.items.map((x) => x.l.id) : [])} aria-label="Select all" /></th>
              <th className="p-2">Load</th><th className="p-2">Clock from</th><th className="p-2">Due</th><th className="p-2">Terms</th>
              <th className="p-2 text-right">Carrier pay</th><th className="p-2 text-right">Quick Pay fee</th><th className="p-2 text-right">Net to pay</th><th className="p-2">QuickBooks bill</th><th />
            </tr>
          </thead>
          <tbody>
            {group.items.map(({ l, d, bill }) => (
              <tr key={l.id} className="border-t">
                <td className="p-2"><Checkbox checked={picked.includes(l.id)} onCheckedChange={(v) => setPicked((p) => (v ? [...p, l.id] : p.filter((x) => x !== l.id)))} aria-label={`Select ${l.load_number}`} /></td>
                <td className="p-2 font-semibold">{l.load_number}<div className="text-xs font-normal text-muted-foreground">{l.origin_city}, {l.origin_state} → {l.dest_city}, {l.dest_state}</div></td>
                <td className="p-2">{day(d.podAt)}<div className="text-xs text-muted-foreground">{d.fromPod ? "POD in" : <span className="text-warning">Delivery · no POD</span>}</div></td>
                <td className={d.daysLeft < 0 ? "p-2 font-semibold text-destructive" : "p-2"}>{day(d.due)}<div className="text-xs">{dueText(d.daysLeft)}</div></td>
                <td className="p-2">{d.pt.terms}</td>
                <td className="p-2 text-right">{usd(d.gross)}</td>
                <td className="p-2 text-right">{d.fee ? `−${usd(d.fee)}` : "—"}</td>
                <td className="p-2 text-right font-semibold">{usd(d.net)}</td>
                <td className="p-2 text-xs capitalize">{bill ? (bill.qb_ref ? "In QuickBooks" : bill.status) : "Not sent"}</td>
                <td className="p-2 text-right"><Link to="/dispatch" search={{ load: l.id }} onClick={onLeave} className="text-gold underline">Open load</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded border p-3">
        <div className="mr-auto text-sm">Selected: <b>{chosen.length}</b> load(s) · <b className="text-gold">{usd(total)}</b></div>
        {/* Pay sheet: pay-to + loads. Bank numbers are never printed or exported. */}
        <ReportExport build={(): ReportSpec => {
          const its = chosen.length ? chosen : group.items;
          return {
            title: `Carrier pay — ${c?.legal_name ?? "Carrier"}`,
            subtitle: `Pay to: ${to.name}${to.factored ? ` (factoring company for ${to.forCarrier})` : ""}${to.address ? ` · ${to.address.replace(/\n/g, ", ")}` : ""}`,
            filters: [`MC ${c?.mc_number || "—"} · DOT ${c?.dot_number || "—"}`, `Terms: ${[...new Set(its.map((x) => x.d.pt.terms))].join(" / ")}`, chosen.length && chosen.length < group.items.length ? `${chosen.length} of ${group.items.length} loads selected` : `All ${group.items.length} unpaid loads`, ...(to.noaMissing ? ["NOA not on file — confirm before paying the factoring company"] : [])],
            summary: [["Loads", String(its.length)], ["Carrier pay", usd(its.reduce((t, x) => t + x.d.gross, 0))], ["Quick Pay fee", usd(its.reduce((t, x) => t + x.d.fee, 0))], ["Net to pay", usd(its.reduce((t, x) => t + x.d.net, 0))]],
            head: ["Load", "Lane", "Clock from", "Due", "Terms", "Carrier pay", "Quick Pay fee", "Net to pay", "QuickBooks bill"], right: [5, 6, 7],
            rows: its.map(({ l, d, bill }) => [l.load_number, `${l.origin_city}, ${l.origin_state} → ${l.dest_city}, ${l.dest_state}`, `${day(d.podAt)} (${d.fromPod ? "POD in" : "delivery, no POD"})`, `${day(d.due)} (${dueText(d.daysLeft)})`, d.pt.terms, usd(d.gross), d.fee ? usd(d.fee) : "", usd(d.net), bill ? (bill.qb_ref ? "In QuickBooks" : bill.status) : "Not sent"]),
            total: ["Total", `${its.length} loads`, "", "", "", usd(its.reduce((t, x) => t + x.d.gross, 0)), usd(its.reduce((t, x) => t + x.d.fee, 0)), usd(its.reduce((t, x) => t + x.d.net, 0)), ""],
          };
        }} />
        <label className="text-xs text-muted-foreground">Check # / ACH ref (optional)<Input className="mt-1 h-9 w-48" value={ref} onChange={(e) => setRef(e.target.value)} /></label>
        <Button variant="outline" asChild><Link to="/quickbooks" onClick={onLeave}>Open Accounting</Link></Button>
        <Button disabled={busy} onClick={markPaid}>{busy ? "Saving…" : "Mark paid"}</Button>
      </div>
    </div>
  );
}
