import { createFileRoute, Link, useRouteContext } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, useEffect, type ReactNode } from "react";
import { CalendarClock, FileWarning, Receipt, ShieldAlert, Truck, Users, Calculator } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { carriersQuery, recentLoadsQuery } from "@/lib/queries";
import { loadWorkQuery } from "@/lib/loadWorkQuery";
import { needsWork } from "@/lib/loadWork";
import { carrierExpiry, statusMeta, type Load } from "@/lib/tms";
import { QuickOnboardButton } from "@/components/QuickOnboard";
import { LandingPicker } from "@/components/LandingPicker";

export const Route = createFileRoute("/_authenticated/home")({
  head: () => ({
    meta: [
      { title: "Home — Clearwater Cargo TMS" },
      { name: "description", content: "Today's pickups and deliveries, missing PODs, invoicing, carrier onboarding and follow-ups in one place." },
      { property: "og:title", content: "Home — Clearwater Cargo TMS" },
      { property: "og:description", content: "Daily operations cockpit for Clearwater Cargo." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Home,
});

const dayKey = (d: Date) => d.toLocaleDateString("en-CA");
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "");
const OPEN = ["available", "vetting", "booked", "dispatched", "rolling", "issue"];

function Home() {
  const { user, isAdmin, isAccountant } = useRouteContext({ from: "/_authenticated" });
  const all = isAdmin || isAccountant;
  const [today, setToday] = useState("");
  const [tomorrow, setTomorrow] = useState("");
  useEffect(() => { const n = new Date(); setToday(dayKey(n)); setTomorrow(dayKey(new Date(n.getTime() + 86400000))); }, []);
  const { data: loads = [] } = useQuery(recentLoadsQuery);
  const { data: work } = useQuery({ ...loadWorkQuery, refetchInterval: 30_000 });
  const { data: carriers = [] } = useQuery(carriersQuery);
  const { data: leads = [] } = useQuery({
    queryKey: ["home", "leads"],
    queryFn: async () => (await supabase.from("leads").select("id,company_name,next_follow_up,stage,outreach_status").neq("stage", "won").neq("stage", "lost").or(`next_follow_up.lte.${new Date().toLocaleDateString("en-CA")},outreach_status.eq.replied`).order("next_follow_up").limit(50)).data ?? [],
  });
  const { data: quotes = [] } = useQuery({
    queryKey: ["home", "quotes"],
    queryFn: async () => (await supabase.from("quotes").select("*").eq("status", "sent").order("created_at", { ascending: false }).limit(20)).data ?? [],
  });

  const mine = (l: { broker_id: string | null }) => all || l.broker_id === user.id;
  const on = (iso: string | null, d: string) => !!iso && dayKey(new Date(iso)) === d;
  const open = loads.filter((l) => mine(l) && OPEN.includes(l.status) && !l.closed_at);
  const pickToday = open.filter((l) => on(l.pickup_at, today));
  const delToday = open.filter((l) => on(l.delivery_at, today));
  const pickTomorrow = open.filter((l) => on(l.pickup_at, tomorrow));
  const wl = (work?.loads ?? []).filter(mine);
  const pod = wl.filter((l) => needsWork(l, "pod", work!.invoiceIds));
  const inv = wl.filter((l) => needsWork(l, "invoice", work!.invoiceIds));
  const busyCarriers = useMemo(() => new Set(open.map((l) => l.carrier_id).filter(Boolean)), [open]);
  const compliance = carriers.filter((c) => busyCarriers.has(c.id) && ["expired", "missing", "soon"].includes(carrierExpiry(c)));

  return (
    <div className="space-y-4 p-3 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold uppercase text-gold">Today's cockpit</h1>
          <p className="text-sm text-muted-foreground">{all ? "Company loads" : "Your loads"} · {today && new Date().toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2"><QuickOnboardButton /><LandingPicker /></div>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card icon={<CalendarClock className="h-4 w-4" />} title="Today & tomorrow">
          <Group label="Pickups today" rows={pickToday} at="pickup_at" />
          <Group label="Deliveries today" rows={delToday} at="delivery_at" />
          <Group label="Pickups tomorrow" rows={pickTomorrow} at="pickup_at" flagNoCarrier />
        </Card>
        <Card icon={<FileWarning className="h-4 w-4" />} title="Paperwork & invoicing">
          <WorkGroup label="Delivered — missing POD" rows={pod} work="pod" />
          <WorkGroup label="Need invoicing" rows={inv} work="invoice" note={(l) => (l.pod_received ? "POD in" : "no POD")} />
          {isAccountant || isAdmin ? <Link to="/quickbooks" className="mt-2 inline-flex items-center gap-1 text-xs text-gold underline"><Receipt className="h-3.5 w-3.5" />Open Accounting to sync QuickBooks</Link> : null}
        </Card>
        <Card icon={<Users className="h-4 w-4" />} title="To-do">
          <Section label={`Lead follow-ups & replies (${leads.length})`}>
            {leads.slice(0, 8).map((l) => <Link key={l.id} to="/leads" className="block truncate text-sm hover:underline">{l.outreach_status === "replied" ? "🔥 " : ""}{l.company_name}<span className="text-xs text-muted-foreground">{l.next_follow_up ? ` · ${l.next_follow_up}${l.next_follow_up < today ? " (overdue)" : ""}` : " · replied"}</span></Link>)}
            {!leads.length && <Empty />}
          </Section>
          <Section label={`Quotes waiting on shipper (${quotes.length})`}>
            {quotes.slice(0, 6).map((q) => <Link key={q.id} to="/quotes" className="flex items-center gap-1 truncate text-sm hover:underline"><Calculator className="h-3 w-3 text-gold" />{(q as Record<string, unknown>).quote_number as string ?? "Quote"}</Link>)}
            {!quotes.length && <Empty />}
          </Section>
          <Section label={`Carriers on open loads with insurance issues (${compliance.length})`}>
            {compliance.slice(0, 6).map((c) => <Link key={c.id} to="/carriers" className="flex items-center gap-1 truncate text-sm text-warning hover:underline"><ShieldAlert className="h-3 w-3" />{c.legal_name} · {carrierExpiry(c) === "soon" ? "expiring soon" : "expired/missing"}</Link>)}
            {!compliance.length && <Empty />}
          </Section>
        </Card>
      </div>
    </div>
  );
}

function Card({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return <div className="space-y-3 rounded border bg-card p-4"><h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-gold">{icon}{title}</h2>{children}</div>;
}
function Section({ label, children }: { label: string; children: ReactNode }) {
  return <div><div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{label}</div><div className="space-y-1">{children}</div></div>;
}
const Empty = () => <p className="text-xs text-muted-foreground">Nothing here.</p>;

function Group({ label, rows, at, flagNoCarrier }: { label: string; rows: Load[]; at: "pickup_at" | "delivery_at"; flagNoCarrier?: boolean }) {
  return (
    <Section label={`${label} (${rows.length})`}>
      {rows.slice(0, 10).map((l) => (
        <Link key={l.id} to="/dispatch" search={{ load: l.id }} className="flex items-center justify-between gap-2 text-sm hover:underline">
          <span className="truncate"><Truck className="mr-1 inline h-3 w-3 text-gold" />{l.load_number} · {l.origin_city} → {l.dest_city}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{flagNoCarrier && !l.carrier_id ? <span className="text-destructive">No carrier</span> : `${time(l[at])} · ${statusMeta(l.status)?.label ?? l.status}`}</span>
        </Link>
      ))}
      {!rows.length && <Empty />}
    </Section>
  );
}
function WorkGroup({ label, rows, work, note }: { label: string; rows: { id: string; load_number: string; origin_city: string; dest_city: string; pod_received: boolean }[]; work: "pod" | "invoice"; note?: (l: { pod_received: boolean }) => string }) {
  return (
    <Section label={`${label} (${rows.length})`}>
      {rows.slice(0, 8).map((l) => (
        <Link key={l.id} to="/dispatch" search={{ load: l.id }} className="flex justify-between gap-2 text-sm hover:underline">
          <span className="truncate">{l.load_number} · {l.origin_city} → {l.dest_city}</span>{note && <span className="text-xs text-muted-foreground">{note(l)}</span>}
        </Link>
      ))}
      {rows.length > 8 && <Link to="/dispatch" search={{ work }} className="text-xs text-gold underline">See all {rows.length}</Link>}
      {!rows.length && <Empty />}
    </Section>
  );
}
