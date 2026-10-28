import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { bidLaneSummaryQuery, bidsQuery, refreshBidStatus, type Bid } from "@/lib/bids";
import { laneTotals } from "@/lib/bidDesk";
import { companiesQuery } from "@/lib/queries";
import { usd } from "@/lib/tms";
import { BidDetail } from "@/components/bids/BidDetail";
import { QuickLaneCheck } from "@/components/bids/QuickLaneCheck";
import { BulkActionBar, SelectAllBox, useSelection, exportAction, type BulkAction } from "@/components/BulkActionBar";
import { EntityCombobox } from "@/components/EntityCombobox";
import { DatePicker } from "@/components/DatePicker";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/bids")({
  validateSearch: (s: Record<string, unknown>): { bid?: string } => ({ bid: typeof s.bid === "string" ? s.bid : undefined }),
  head: () => ({
    meta: [
      { title: "Bid Desk — Clearwater Cargo TMS" },
      { name: "description", content: "Upload shipper RFPs and tenders, price spot and contract lanes with fuel surcharge and accessorials, submit bids and track wins." },
      { property: "og:title", content: "Bid Desk — Clearwater Cargo TMS" },
      { property: "og:description", content: "Upload shipper RFPs and tenders, price spot and contract lanes with fuel surcharge and accessorials, submit bids and track wins." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BidsPage,
});

const STATUSES = ["draft", "submitted", "won", "partial", "lost"];

function BidsPage() {
  const { bid } = Route.useSearch();
  return (
    <div className="p-3 sm:p-5">
      <h1 className="mb-3 font-display text-3xl font-bold uppercase tracking-wider text-gold">Bid Desk</h1>
      {bid ? <BidDetail bidId={bid} /> : <BidList />}
    </div>
  );
}

function BidList() {
  const qc = useQueryClient();
  const { data: bids = [] } = useQuery(bidsQuery);
  const { data: lanes = [] } = useQuery(bidLaneSummaryQuery);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const sel = useSelection();

  const roll = new Map<string, { n: number; won: number; lost: number; priced: number; annRev: number }>();
  for (const l of lanes) {
    const b = bids.find((x) => x.id === l.bid_id);
    const r = roll.get(l.bid_id) ?? { n: 0, won: 0, lost: 0, priced: 0, annRev: 0 };
    const t = laneTotals(l, Number(b?.fsc_per_mile ?? 0));
    r.n++; if (l.status === "won") r.won++; if (l.status === "lost") r.lost++; if (t.linehaul > 0) r.priced++;
    if (l.status === "won") r.annRev += t.annualRevenue;
    roll.set(l.bid_id, r);
  }
  const shown = bids.filter((b) => (!status || b.status === status) && (!q || `${b.bid_number} ${b.name} ${b.customer_name ?? ""}`.toLowerCase().includes(q.toLowerCase())));
  const decided = lanes.filter((l) => l.status !== "pending");
  const winRate = decided.length ? (lanes.filter((l) => l.status === "won").length / decided.length) * 100 : null;
  const wonAnn = [...roll.values()].reduce((s, r) => s + r.annRev, 0);
  const open = bids.filter((b) => b.status === "draft" || b.status === "submitted").length;

  const setBidStatus = async (b: Bid, s: string) => {
    const patch: Partial<Bid> = { status: s };
    if (s === "submitted" && !b.submitted_at) patch.submitted_at = new Date().toISOString();
    const { error } = await supabase.from("bids").update(patch).eq("id", b.id);
    if (!error && (s === "won" || s === "lost")) await supabase.from("bid_lanes").update({ status: s }).eq("bid_id", b.id).eq("status", "pending");
    return error ? `${b.bid_number}: ${error.message}` : null;
  };
  const actions: BulkAction<Bid>[] = [
    { value: "submitted", label: "Mark submitted", hint: "Marks the checked bids as sent to the customer. No email goes out.", each: (b) => setBidStatus(b, "submitted") },
    { value: "won", label: "Mark won (all open lanes)", hint: "Marks the checked bids won and every pending lane on them won.", each: (b) => setBidStatus(b, "won") },
    { value: "lost", label: "Mark lost (all open lanes)", hint: "Marks the checked bids lost and every pending lane on them lost.", each: (b) => setBidStatus(b, "lost") },
    { value: "recalc", label: "Recheck status from lanes", hint: "Sets each bid's status from its lanes' won/lost results.", each: async (b) => { await refreshBidStatus(b.id); return null; } },
    { value: "draft", label: "Back to draft", hint: "Puts the checked bids back to draft. Lane results stay.", each: (b) => setBidStatus(b, "draft") },
    exportAction<Bid>("Bids", ["Bid #", "Name", "Customer", "Type", "Status", "Due", "Lanes", "Won", "Lost", "FSC $/mi"],
      (b) => { const r = roll.get(b.id); return [b.bid_number, b.name, b.customer_name, b.kind, b.status, b.due_date, r?.n ?? 0, r?.won ?? 0, r?.lost ?? 0, Number(b.fsc_per_mile).toFixed(2)]; }),
    { value: "delete", label: "Delete bids", danger: true, adminOnly: true, hint: "Permanently deletes the checked bids and their lanes. Quotes and loads already made stay. Each bid is saved in the deletion log.",
      each: async (b) => { const { error, count } = await supabase.from("bids").delete({ count: "exact" }).eq("id", b.id); return error ? `${b.bid_number}: ${error.message}` : !count ? `${b.bid_number}: not allowed` : null; } },
  ];
  const picked = shown.filter((b) => sel.has(b.id));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[1fr_1.1fr]">
        <QuickLaneCheck />
        <div className="space-y-3 rounded-lg border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg font-bold uppercase tracking-wider text-gold">Bids</h2>
            <Button size="sm" onClick={() => setNewOpen(true)}><Plus className="mr-1 h-4 w-4" />New bid / upload RFP</Button>
          </div>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div className="rounded border p-2"><div className="text-[11px] uppercase text-muted-foreground">Open bids</div><b>{open}</b></div>
            <div className="rounded border p-2"><div className="text-[11px] uppercase text-muted-foreground">Lane win rate</div><b>{winRate == null ? "—" : `${winRate.toFixed(0)}%`}</b></div>
            <div className="rounded border p-2"><div className="text-[11px] uppercase text-muted-foreground">Won annual revenue</div><b className="text-gold">{wonAnn ? usd(wonAnn) : "—"}</b></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Input className="h-8 w-48" placeholder="Search bids" value={q} onChange={(e) => setQ(e.target.value)} />
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-8 rounded border bg-background px-2 text-sm"><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s} className="capitalize">{s}</option>)}</select>
          </div>
          {picked.length > 0 && <BulkActionBar items={picked} total={shown.length} actions={actions} onClear={sel.clear} invalidate={["bids", "bid-lanes"]} noun="bids" />}
          {shown.length === 0 ? <p className="text-sm text-muted-foreground">No bids yet. Start one, or check a single lane on the left and save it as a bid.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="text-left text-[11px] uppercase text-muted-foreground">
                  <tr><th className="w-8 py-1"><SelectAllBox ids={shown.map((b) => b.id)} sel={sel} /></th><th>Bid</th><th>Customer</th><th>Type</th><th>Due</th><th>Lanes</th><th>Won/Lost</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {shown.map((b) => {
                    const r = roll.get(b.id);
                    const overdue = b.due_date && b.status === "draft" && b.due_date < new Date().toISOString().slice(0, 10);
                    return (
                      <tr key={b.id} className="border-t">
                        <td className="py-1.5"><Checkbox checked={sel.has(b.id)} onCheckedChange={(v) => sel.toggle(b.id, v === true)} aria-label={`Select ${b.bid_number}`} /></td>
                        <td><Link to="/bids" search={{ bid: b.id }} className="hover:text-gold"><span className="font-mono text-xs text-gold">{b.bid_number}</span> {b.name}</Link></td>
                        <td>{b.customer_name ?? "—"}</td>
                        <td className="capitalize">{b.kind}</td>
                        <td className={overdue ? "text-destructive" : ""}>{b.due_date ?? "—"}</td>
                        <td>{r ? `${r.priced}/${r.n} priced` : "0"}</td>
                        <td>{r ? `${r.won} / ${r.lost}` : "—"}</td>
                        <td className="capitalize">{b.status}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      {newOpen && <NewBid onClose={() => setNewOpen(false)} onCreated={() => qc.invalidateQueries({ queryKey: ["bids"] })} />}
    </div>
  );
}

function NewBid({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const navigate = useNavigate();
  const { data: companies = [] } = useQuery(companiesQuery);
  const customers = companies.filter((c) => c.kind === "customer");
  const [f, setF] = useState({ name: "", kind: "contract", customer_id: null as string | null, customer_name: "", customer_email: "", due_date: "", fsc: "0", margin: "15" });
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (!f.name.trim() && !f.customer_name.trim()) return toast.error("Give the bid a name or pick a customer.");
    setBusy(true);
    const { data, error } = await supabase.from("bids").insert({
      name: f.name.trim() || `${f.customer_name} ${f.kind} RFP`, kind: f.kind, customer_id: f.customer_id, customer_name: f.customer_name || null,
      customer_email: f.customer_email || null, due_date: f.due_date || null, fsc_per_mile: Number(f.fsc) || 0, target_margin: Number(f.margin) || 15,
    }).select("id").single();
    setBusy(false);
    if (error) return toast.error(error.message);
    onCreated();
    onClose();
    navigate({ to: "/bids", search: { bid: data.id } });
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New bid</DialogTitle></DialogHeader>
        <div className="grid gap-2 text-sm">
          <EntityCombobox options={customers.map((c) => ({ id: c.id, label: c.name, sub: [c.city, c.state].filter(Boolean).join(", ") }))}
            value={{ id: f.customer_id, name: f.customer_name }}
            onChange={(v) => { const c = customers.find((x) => x.id === v.id); setF((s) => ({ ...s, customer_id: v.id, customer_name: v.name, customer_email: c?.email ?? s.customer_email })); }}
            placeholder="Customer / shipper" newLabel="name only" />
          <Input placeholder="Bid name, e.g. 2027 Southeast RFP" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <Input placeholder="Customer email" value={f.customer_email} onChange={(e) => setF({ ...f, customer_email: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} className="h-9 rounded border bg-background px-2"><option value="contract">Contract</option><option value="spot">Spot</option></select>
            <DatePicker placeholder="Due date" value={f.due_date} onChange={(v) => setF({ ...f, due_date: v })} />
            <label className="text-xs text-muted-foreground">Fuel surcharge $/mi<Input type="number" step="0.01" value={f.fsc} onChange={(e) => setF({ ...f, fsc: e.target.value })} /></label>
            <label className="text-xs text-muted-foreground">Target margin %<Input type="number" value={f.margin} onChange={(e) => setF({ ...f, margin: e.target.value })} /></label>
          </div>
          <Button disabled={busy} onClick={create}>{busy ? "Creating…" : "Create and add lanes"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
