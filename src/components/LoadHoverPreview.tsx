import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouteContext, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { companiesQuery, carriersQuery, profilesQuery } from "@/lib/queries";
import { hoverLoadNumber, loadHoverAllowed } from "@/lib/loadHover";
import { fmtDate, loadTotals, statusMeta, usd, type Load } from "@/lib/tms";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

/** One delegated preview covers load refs in tables, notices, chat and portalled windows. */
export function LoadHoverPreview() {
  const [target, setTarget] = useState<{ number: string; element: HTMLElement } | null>(null);
  const active = useRef<HTMLElement | null>(null);
  const timers = useRef<{ open?: ReturnType<typeof setTimeout>; close?: ReturnType<typeof setTimeout> }>({});
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => { setTarget(null); }, [pathname]);
  useEffect(() => {
    const clear = () => { clearTimeout(timers.current.open); clearTimeout(timers.current.close); };
    const close = () => { clearTimeout(timers.current.close); timers.current.close = setTimeout(() => setTarget(null), 220); };
    const enter = (event: PointerEvent | FocusEvent) => {
      const element = event.target;
      if (!(element instanceof HTMLElement)) return;
      if (element.closest("[data-load-hover-preview]")) { clear(); return; }
      if (!loadHoverAllowed(!!element.closest("[data-load-hover-exclude]"), !!element.closest("input,textarea,select,[contenteditable=true],[role=checkbox]"))) { clear(); close(); return; }
      // Use the smallest text-bearing element, not entire rows containing several refs.
      let anchor: HTMLElement | null = element;
      let number: string | null = null;
      for (let depth = 0; anchor && depth < 3; depth++, anchor = anchor.parentElement) {
        const text = anchor.textContent?.trim() ?? "";
        if (text.length > 180) break;
        number = hoverLoadNumber(text);
        if (number) break;
      }
      clear();
      if (!anchor || !number) { close(); return; }
      const next = { number, element: anchor };
      active.current = anchor;
      timers.current.open = setTimeout(() => setTarget(next), 250);
    };
    const leave = (event: PointerEvent) => {
      const source = event.target;
      const destination = event.relatedTarget;
      if (!(source instanceof HTMLElement) || (!active.current?.contains(source) && !source.closest("[data-load-hover-preview]"))) return;
      if (destination instanceof HTMLElement && (active.current?.contains(destination) || destination.closest("[data-load-hover-preview]"))) return;
      close();
    };
    const click = () => { clear(); setTarget(null); };
    document.addEventListener("pointerover", enter);
    document.addEventListener("focusin", enter);
    document.addEventListener("pointerout", leave);
    document.addEventListener("click", click);
    return () => { clear(); document.removeEventListener("pointerover", enter); document.removeEventListener("focusin", enter); document.removeEventListener("pointerout", leave); document.removeEventListener("click", click); };
  }, []);
  return <Popover open={!!target} onOpenChange={(open) => { if (!open) setTarget(null); }}>
    <PopoverAnchor virtualRef={{ current: { getBoundingClientRect: () => target?.element.getBoundingClientRect() ?? new DOMRect() } }} />
    {target && <PopoverContent data-load-hover-preview aria-label={`Quick load details ${target.number}`} side="right" align="start" collisionPadding={12} className="z-[80] max-h-[80dvh] w-[26rem] max-w-[calc(100vw-1.5rem)] overflow-y-auto" onOpenAutoFocus={(e) => e.preventDefault()} onCloseAutoFocus={(e) => e.preventDefault()} onPointerEnter={() => { clearTimeout(timers.current.open); clearTimeout(timers.current.close); }} onPointerLeave={() => { timers.current.close = setTimeout(() => setTarget(null), 220); }}>
      <LoadHoverDetails number={target.number} onClose={() => setTarget(null)} />
    </PopoverContent>}
  </Popover>;
}

function LoadHoverDetails({ number, onClose }: { number: string; onClose: () => void }) {
  const { isFinance } = useRouteContext({ from: "/_authenticated" });
  const navigate = useNavigate();
  const { data: load, error } = useQuery({ queryKey: ["hover-load", number], staleTime: 30_000, queryFn: async () => {
    const { data, error } = await supabase.from("loads").select("*").ilike("load_number", number).maybeSingle();
    if (error) throw error;
    return data as Load | null;
  } });
  const { data: companies = [] } = useQuery(companiesQuery);
  const { data: carriers = [] } = useQuery(carriersQuery);
  const { data: profiles = [] } = useQuery(profilesQuery);
  const { data: invoices = [], error: invoiceError } = useQuery({ queryKey: ["hover-invoices", load?.id], enabled: !!load, staleTime: 30_000, queryFn: async () => {
    const { data, error } = await supabase.from("qb_sync").select("invoice_number,status,kind").eq("load_id", load?.id ?? "").neq("kind", "bill");
    if (error) throw error;
    return data ?? [];
  } });
  if (error) return <p role="alert" className="text-sm text-destructive">Load details could not be read.</p>;
  if (load === undefined) return <p className="text-sm text-muted-foreground">Loading {number}…</p>;
  if (!load) return <p className="text-sm text-muted-foreground">Load unavailable.</p>;
  const totals = loadTotals(load);
  const carrier = carriers.find((c) => c.id === load.carrier_id);
  const fields = [
    ["Customer", companies.find((c) => c.id === load.customer_id)?.name ?? "—"],
    ["Customer ref #", load.customer_ref || "—"],
    ["Invoice #", invoiceError ? "Unavailable" : invoices.map((i) => i.invoice_number).filter(Boolean).join(", ") || "Not created"],
    ["QuickBooks", invoiceError ? "Unavailable" : invoices.map((i) => i.status).join(", ") || "Not sent"],
    ["Shipper PO", load.ship_ref || "—"], ["Destination ref", load.dest_ref || "—"],
    ["Pickup", fmtDate(load.pickup_at)], ["Delivery", fmtDate(load.delivery_at)],
    ["Broker", profiles.find((p) => p.id === load.broker_id)?.full_name ?? "Unassigned"],
    ["Carrier", carrier?.legal_name ?? "Not assigned"], ["Equipment", load.equipment],
    ["POD", load.pod_received ? "Signed POD on file" : "Not received"],
    ["Customer amount", usd(totals.revenue)],
    ...(isFinance ? [["Carrier pay", usd(totals.cost)]] : []),
  ];
  return <div className="space-y-3">
    <div className="flex items-center justify-between gap-2"><strong className="font-mono text-gold">{load.load_number}</strong><span className="text-xs text-muted-foreground">{statusMeta(load.status).label}</span></div>
    <div className="text-sm font-medium">{load.origin_city}, {load.origin_state} → {load.dest_city}, {load.dest_state}</div>
    <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">{fields.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="break-words">{value}</dd></div>)}</dl>
    {carrier?.phone && <div className="text-sm"><span className="text-muted-foreground">Carrier phone: </span><a href={`tel:${carrier.phone}`} className="text-gold">{carrier.phone}</a></div>}
    <Button size="sm" className="w-full" onClick={() => { onClose(); navigate({ to: "/dispatch", search: { load: load.id } }); }}>Open load<ArrowRight className="ml-2 h-4 w-4" /></Button>
  </div>;
}