import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useRouteContext } from "@tanstack/react-router";
import { ClipboardList } from "lucide-react";
import { loadWorkQuery } from "@/lib/loadWorkQuery";
import { companiesQuery } from "@/lib/queries";
import { batchEligible, needsWork, type WorkFilter, type WorkLoad } from "@/lib/loadWork";
import { fmtDate } from "@/lib/tms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BatchLoadActionDialog } from "@/components/BatchLoadActionDialog";

const ITEMS = [["delivery", "delivery overdue"], ["invoice", "need invoicing"], ["closeout", "ready for closeout"]] as const;

export function LoadWorkNotice() {
  const { user, isAdmin, isAccountant } = useRouteContext({ from: "/_authenticated" });
  const { data, error } = useQuery({ ...loadWorkQuery, refetchInterval: 60_000 });
  const [openFilter, setOpenFilter] = useState<WorkFilter | null>(null);
  if (error) return <div role="alert" className="border-b px-4 py-2 text-xs text-warning">Unfinished-load notices could not load. Refresh to retry.</div>;
  if (!data) return null;
  const loads = data.loads.filter((load) => isAdmin || isAccountant || load.broker_id === user.id);
  const items = ITEMS.map(([filter, label]) => ({ filter, label, list: loads.filter((load) => needsWork(load, filter, data.invoiceIds)) })).filter((item) => item.list.length);
  if (!items.length) return null;
  const current = items.find((i) => i.filter === openFilter);
  return <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-warning/10 px-4 py-2 text-xs">
    <span className="flex items-center gap-2 font-semibold text-warning"><ClipboardList className="h-4 w-4" />{isAdmin || isAccountant ? "Company loads" : "Your loads"}</span>
    {items.map((item) => <button type="button" key={item.filter} onClick={() => setOpenFilter(item.filter)} className="text-gold underline">{item.list.length} {item.label}</button>)}
    {current && <WorkListDialog filter={current.filter} label={current.label} loads={current.list} onClose={() => setOpenFilter(null)} owner={isAdmin || isAccountant ? undefined : user.id} />}
  </div>;
}

function WorkListDialog({ filter, label, loads, onClose, owner }: { filter: WorkFilter; label: string; loads: WorkLoad[]; onClose: () => void; owner?: string }) {
  const { data: companies } = useQuery(companiesQuery);
  const names = useMemo(() => new Map((companies ?? []).map((c) => [c.id, c.name])), [companies]);
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<"delivered" | "closeout" | null>(null);
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = [...loads].sort((a, b) => (b.delivery_at ?? "").localeCompare(a.delivery_at ?? ""));
    if (!t) return list;
    return list.filter((l) => [l.load_number, l.status, names.get(l.customer_id ?? ""), l.customer_ref, l.origin_city, l.dest_city].some((v) => v?.toLowerCase().includes(t)));
  }, [loads, q, names]);
  const batch = filter === "delivery" ? "delivered" : filter === "closeout" ? "closeout" : null;
  const picked = loads.filter((l) => pick.has(l.id));
  const allOn = rows.length > 0 && rows.every((r) => pick.has(r.id));
  const toggleAll = () => setPick((p) => { const n = new Set(p); rows.forEach((r) => allOn ? n.delete(r.id) : n.add(r.id)); return n; });
  return <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
    <DialogContent className="flex max-h-[90dvh] w-[96vw] max-w-5xl flex-col sm:max-w-5xl">
      <DialogHeader><DialogTitle>{loads.length} loads {label}</DialogTitle></DialogHeader>
      <div className="flex flex-wrap items-center gap-2">
        <Input className="max-w-xs" placeholder="Search load #, customer, ref, city" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="text-xs text-muted-foreground">{pick.size} selected</span>
        <div className="ml-auto flex gap-2">
          {batch && <Button size="sm" disabled={!picked.some((l) => batchEligible(l, batch))} onClick={() => setAction(batch)}>{batch === "delivered" ? "Mark selected delivered" : "Close out selected"}</Button>}
          <Button size="sm" variant="outline" asChild><Link to="/dispatch" search={{ work: filter, owner }} onClick={onClose}>View on Dispatch board</Link></Button>
        </div>
      </div>
      {filter === "invoice" && <p className="text-xs text-muted-foreground">Open a load to create its invoice, or invoice several from the Dispatch board.</p>}
      <div className="min-h-0 flex-1 overflow-auto rounded border text-xs">
        <table className="w-full">
          <thead className="sticky top-0 bg-card text-left text-muted-foreground"><tr>
            {batch && <th className="p-2"><input type="checkbox" aria-label="Select all" checked={allOn} onChange={toggleAll} className="accent-gold" /></th>}
            <th className="p-2">Load</th><th className="p-2">Status</th><th className="p-2">Customer</th><th className="p-2">Cust ref #</th><th className="p-2">Lane</th><th className="p-2">Delivery</th><th className="p-2"></th>
          </tr></thead>
          <tbody className="divide-y">{rows.map((l) => <tr key={l.id}>
            {batch && <td className="p-2"><input type="checkbox" aria-label={`Select ${l.load_number}`} checked={pick.has(l.id)} onChange={() => setPick((p) => { const n = new Set(p); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n; })} className="accent-gold" /></td>}
            <td className="p-2 font-mono text-gold">{l.load_number}{l.source === "its" ? " · ITS" : ""}</td>
            <td className="p-2 capitalize">{l.status}</td>
            <td className="p-2">{names.get(l.customer_id ?? "") ?? "—"}</td>
            <td className="p-2">{l.customer_ref ?? "—"}</td>
            <td className="p-2">{[l.origin_city, l.dest_city].filter(Boolean).join(" → ") || "—"}</td>
            <td className="p-2">{l.delivery_at ? fmtDate(l.delivery_at) : "—"}</td>
            <td className="p-2"><Link to="/dispatch" search={{ load: l.id }} onClick={onClose} className="text-gold underline">Open</Link></td>
          </tr>)}</tbody>
        </table>
      </div>
      {action && <BatchLoadActionDialog action={action} loads={picked} onClose={() => setAction(null)} onDone={(ids) => setPick((p) => { const n = new Set(p); ids.forEach((id) => n.delete(id)); return n; })} />}
    </DialogContent>
  </Dialog>;
}
