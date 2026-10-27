import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bell, Settings2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usd, loadTotals, type Load } from "@/lib/tms";
import { Checkbox } from "@/components/ui/checkbox";
import { LoadListBar } from "@/components/LoadListBar";
import { SelectAllBox, useSelection } from "@/components/BulkActionBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const KEY = "cw_due_reminder_days";
const load = () => {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? "{}"); return { ar: Number(v.ar) || 30, ap: Number(v.ap) || 30, qp: Number(v.qp) || 3 }; }
  catch { return { ar: 30, ap: 30, qp: 3 }; }
};

type Row = Load;
const chunks = <T,>(a: T[], n = 150) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/** Admin-only banner: customer invoices and carrier bills past their due window. */
export function DueReminders() {
  const [days, setDays] = useState(load);
  const [dismissed, setDismissed] = useState(false);
  const [view, setViewRaw] = useState<"ar" | "ap" | null>(null);
  const sel = useSelection();
  const setView = (v: "ar" | "ap" | null) => { sel.clear(); setViewRaw(v); };
  const { data } = useQuery({
    queryKey: ["due_reminders"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("loads").select("*").eq("status", "invoiced").is("closed_at", null).order("created_at").limit(1000);
      const rows = (data ?? []) as Row[];
      const ids = [...new Set(rows.map((r) => r.customer_id).filter((x): x is string => !!x))];
      const parts = await Promise.all(chunks(ids).map((c) => supabase.from("companies").select("id, name").in("id", c)));
      const names = new Map(parts.flatMap((r) => (r.data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
      return rows.map((r) => ({ ...r, _customer: names.get(r.customer_id ?? "") ?? "—" })) as (Row & { _customer: string })[];
    },
  });
  if (dismissed || !data) return null;
  const now = Date.now();
  const age = (r: Row) => (now - new Date(r.created_at).getTime()) / 86_400_000;
  const ar = data.filter((r) => r.status === "invoiced" && age(r) > days.ar);
  // Carrier pay is handled by the CarrierPayDue notice.
  if (!ar.length) return null;
  const saveDays = (d: typeof days) => { setDays(d); localStorage.setItem(KEY, JSON.stringify(d)); };

  return (
    <div className="mx-3 mt-2 flex items-center gap-2 rounded border border-warning/60 bg-warning/10 px-3 py-2 text-sm">
      <Bell className="h-4 w-4 shrink-0 text-warning" />
      <span className="min-w-0 flex-1">
        {ar.length > 0 && <><button type="button" className="font-bold underline" onClick={() => setView("ar")}>{ar.length} customer invoice{ar.length > 1 ? "s" : ""}</button> past {days.ar} days ({usd(ar.reduce((s, r) => s + loadTotals(r).revenue, 0))})</>}
        {" — "}<Link to="/quickbooks" className="text-gold underline">Open Accounting</Link>
      </span>
      <Dialog open={!!view} onOpenChange={(o) => !o && setView(null)}>
        <DialogContent className="flex max-h-[85dvh] w-[96vw] flex-col sm:max-w-4xl">
          <DialogHeader><DialogTitle className="font-display text-2xl uppercase">Customer invoices past due ({ar.length})</DialogTitle></DialogHeader>
          <LoadListBar loads={ar.filter((r) => sel.has(r.id))} total={ar.length} onClear={sel.clear} title="Customer invoices past due"
            actions={["paid", "closeout", "status", "export"]} customerName={(id) => ar.find((r) => r.customer_id === id)?._customer ?? ""} />
          {!sel.picked.size && <p className="text-xs text-muted-foreground">Check invoices (or the top box for all) to mark them paid, close them out or change their status together.</p>}
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card text-left text-xs uppercase text-muted-foreground"><tr><th className="w-8 p-2"><SelectAllBox ids={ar.map((r) => r.id)} sel={sel} /></th><th className="p-2">Load</th><th className="p-2">Customer</th><th className="p-2">Status</th><th className="p-2">Days</th><th className="p-2 text-right">Amount</th><th /></tr></thead>
              <tbody>
                {ar.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="p-2"><Checkbox aria-label={`Select ${r.load_number}`} checked={sel.has(r.id)} onCheckedChange={(v) => sel.toggle(r.id, v === true)} /></td>
                    <td className="p-2 font-semibold">{r.load_number}{r.customer_ref && <div className="text-[10px] font-normal text-muted-foreground">Ref {r.customer_ref}</div>}</td>
                    <td className="p-2">{r._customer}</td>
                    <td className="p-2 capitalize">{r.status}</td>
                    <td className="p-2">{Math.floor(age(r))}</td>
                    <td className="p-2 text-right">{usd(loadTotals(r).revenue)}</td>
                    <td className="p-2 text-right"><Link to="/dispatch" search={{ load: r.id }} onClick={() => setView(null)} className="text-gold underline">Open load</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>
      <Popover>
        <PopoverTrigger asChild><Button size="icon" variant="ghost" aria-label="Reminder timing"><Settings2 className="h-4 w-4" /></Button></PopoverTrigger>
        <PopoverContent className="w-64 space-y-2 text-sm">
          <p className="font-semibold">Remind me after</p>
          {([["ar", "Customer invoices (days)"]] as const).map(([k, label]) => (
            <label key={k} className="flex items-center justify-between gap-2 text-xs">
              {label}
              <Input type="number" min={1} className="h-8 w-20" value={days[k]} onChange={(e) => saveDays({ ...days, [k]: Number(e.target.value) || 1 })} />
            </label>
          ))}
        </PopoverContent>
      </Popover>
      <Button size="icon" variant="ghost" aria-label="Dismiss" onClick={() => setDismissed(true)}><X className="h-4 w-4" /></Button>
    </div>
  );
}
