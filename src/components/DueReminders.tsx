import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bell, Settings2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { payTermsOf, usd } from "@/lib/tms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const KEY = "cw_due_reminder_days";
const load = () => {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? "{}"); return { ar: Number(v.ar) || 30, ap: Number(v.ap) || 30, qp: Number(v.qp) || 3 }; }
  catch { return { ar: 30, ap: 30, qp: 3 }; }
};

type Row = { id: string; load_number: string; status: string; customer_rate: number; carrier_rate: number; created_at: string; carrier_id: string | null; pod_received: boolean; pay_terms: string | null };

/** Admin-only banner: customer invoices and carrier bills past their due window. */
export function DueReminders() {
  const [days, setDays] = useState(load);
  const [dismissed, setDismissed] = useState(false);
  const [view, setView] = useState<"ar" | "ap" | null>(null);
  const { data } = useQuery({
    queryKey: ["due_reminders"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("loads").select("id, load_number, status, customer_rate, carrier_rate, created_at, carrier_id, pod_received, pay_terms")
        .in("status", ["invoiced", "delivered"]).order("created_at");
      return (data ?? []) as Row[];
    },
  });
  if (dismissed || !data) return null;
  const now = Date.now();
  const age = (r: Row) => (now - new Date(r.created_at).getTime()) / 86_400_000;
  const ar = data.filter((r) => r.status === "invoiced" && age(r) > days.ar);
  const ap = data.filter((r) => r.carrier_id && r.pod_received && age(r) > (payTermsOf(r.pay_terms).value === "quickpay" || payTermsOf(r.pay_terms).value === "factored_quickpay" ? days.qp : days.ap));
  if (!ar.length && !ap.length) return null;
  const saveDays = (d: typeof days) => { setDays(d); localStorage.setItem(KEY, JSON.stringify(d)); };

  return (
    <div className="mx-3 mt-2 flex items-center gap-2 rounded border border-warning/60 bg-warning/10 px-3 py-2 text-sm">
      <Bell className="h-4 w-4 shrink-0 text-warning" />
      <span className="min-w-0 flex-1">
        {ar.length > 0 && <><button type="button" className="font-bold underline" onClick={() => setView("ar")}>{ar.length} customer invoice{ar.length > 1 ? "s" : ""}</button> past {days.ar} days ({usd(ar.reduce((s, r) => s + Number(r.customer_rate), 0))})</>}
        {ar.length > 0 && ap.length > 0 && " · "}
        {ap.length > 0 && <><button type="button" className="font-bold underline" onClick={() => setView("ap")}>{ap.length} carrier bill{ap.length > 1 ? "s" : ""}</button> due ({usd(ap.reduce((s, r) => s + Number(r.carrier_rate), 0))})</>}
        {" — "}<Link to="/quickbooks" className="text-gold underline">Open Accounting</Link>
      </span>
      <Dialog open={!!view} onOpenChange={(o) => !o && setView(null)}>
        <DialogContent className="flex max-h-[85dvh] w-[96vw] flex-col sm:max-w-2xl">
          <DialogHeader><DialogTitle className="font-display text-2xl uppercase">{view === "ar" ? "Customer invoices past due" : "Carrier bills due"}</DialogTitle></DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card text-left text-xs uppercase text-muted-foreground"><tr><th className="p-2">Load</th><th className="p-2">Status</th><th className="p-2">Days</th><th className="p-2 text-right">Amount</th><th /></tr></thead>
              <tbody>
                {(view === "ar" ? ar : ap).map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="p-2 font-semibold">{r.load_number}</td>
                    <td className="p-2 capitalize">{r.status}</td>
                    <td className="p-2">{Math.floor(age(r))}</td>
                    <td className="p-2 text-right">{usd(Number(view === "ar" ? r.customer_rate : r.carrier_rate))}</td>
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
          {([["ar", "Customer invoices (days)"], ["ap", "Carrier bills (days)"], ["qp", "Quick Pay bills (days)"]] as const).map(([k, label]) => (
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
