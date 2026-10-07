import { useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { carriersQuery, companiesQuery } from "@/lib/queries";
import { fmtDate, loadTotals, statusMeta, usd, type Load } from "@/lib/tms";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Clickable load number that opens a quick-look panel with an "Open load" jump to the dispatch cockpit. */
export function LoadQuickLook({ load, className, children }: { load: Load; className?: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={cn("font-mono text-gold underline-offset-2 hover:underline", className)}
      >
        {children ?? load.load_number}
      </button>
      <LoadQuickLookDialog load={load} open={open} onOpenChange={setOpen} />
    </>
  );
}

export function LoadQuickLookDialog({ load, open, onOpenChange }: { load: Load; open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  const { data: companies } = useSuspenseQuery(companiesQuery);
  const { data: carriers } = useSuspenseQuery(carriersQuery);
  const t = loadTotals(load);
  const m = statusMeta(load.status);
  const customer = companies.find((c) => c.id === load.customer_id)?.name ?? "—";
  const carrier = carriers.find((c) => c.id === load.carrier_id)?.legal_name ?? "—";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-mono text-gold">{load.load_number}</span>
            <span className={cn("rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider", m.cls)}>{m.label}</span>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <div className="font-medium">
            {load.origin_city}, {load.origin_state} → {load.dest_city}, {load.dest_state}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            <Row k="Customer" v={customer} />
            <Row k="Carrier" v={carrier} />
            <Row k="Pickup" v={fmtDate(load.pickup_at)} />
            <Row k="Delivery" v={fmtDate(load.delivery_at)} />
            <Row k="Equipment" v={load.equipment} />
            <Row k="Commodity" v={load.commodity ?? "—"} />
            <Row k="Customer amount" v={usd(t.revenue)} />
            <Row k="Carrier cost" v={usd(t.cost)} />
            <Row k="Margin" v={`${usd(t.margin)} (${t.pct.toFixed(1)}%)`} />
          </div>
        </div>
        <Button
          className="mt-2 w-full"
          onClick={() => {
            onOpenChange(false);
            navigate({ to: "/dispatch", search: { load: load.id } });
          }}
        >
          Open load <ArrowRight className="ml-1 h-4 w-4" />
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</div>
      <div className="truncate">{v}</div>
    </div>
  );
}
