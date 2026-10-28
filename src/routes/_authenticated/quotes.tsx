import { ConfirmDelete } from "@/components/ConfirmDelete";
import { BulkActionBar, SelectAllBox, useSelection, deleteAction, exportAction, type BulkAction } from "@/components/BulkActionBar";
import { Checkbox } from "@/components/ui/checkbox";
import { useBlobViewer } from "@/components/DocPreview";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { FileDown, Mail, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { companiesQuery, laneHistoryQuery } from "@/lib/queries";
import { EQUIPMENT, usd } from "@/lib/tms";
import { buildQuotePdf, type Quote } from "@/lib/quote";
import { composeEmail } from "@/lib/email";
import { RateView } from "@/components/RateView";
import { BuyBox } from "@/components/BuyBox";
import { postLowMarginNotice } from "@/lib/buyBox";
import { EntityCombobox } from "@/components/EntityCombobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/DatePicker";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import logo from "@/assets/clearwater-logo.jpg.asset.json";

export const Route = createFileRoute("/_authenticated/quotes")({
  head: () => ({
    meta: [
      { title: "Quotes & RFPs — Clearwater Cargo TMS" },
      { name: "description", content: "Price spot quotes and RFP lanes with Clearwater history and public market rates." },
      { property: "og:title", content: "Quotes & RFPs — Clearwater Cargo TMS" },
      { property: "og:description", content: "Price spot quotes and RFP lanes with Clearwater history and public market rates." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: QuotesPage,
});

const STATUS = ["draft", "sent", "won", "lost", "expired"];
const blank = { customer_name: "", customer_email: "", customer_id: null as string | null, kind: "spot", origin_city: "", origin_state: "", dest_city: "", dest_state: "", equipment: "Dry Van", miles: "", pickup_date: "", rate: "", target_carrier_rate: "", notes: "" };

function QuotesPage() {
  return (
    <div className="p-3 sm:p-5">
      <h1 className="mb-3 font-display text-3xl font-bold uppercase tracking-wider text-gold">Quotes & RFPs</h1>
      <Tabs defaultValue="quotes">
        <TabsList className="grid w-full grid-cols-2 sm:w-auto"><TabsTrigger value="quotes">Spot / contract quotes</TabsTrigger><TabsTrigger value="rfp">RFP lanes</TabsTrigger></TabsList>
        <TabsContent value="quotes"><QuoteBuilder /></TabsContent>
        <TabsContent value="rfp"><RfpMoved /></TabsContent>
      </Tabs>
    </div>
  );
}

function QuoteBuilder() {
  const qc = useQueryClient();
  const { data: loads = [] } = useQuery(laneHistoryQuery());
  const { data: companies = [] } = useQuery(companiesQuery);
  const { data: quotes = [] } = useQuery({ queryKey: ["quotes"], queryFn: async () => (await supabase.from("quotes").select("*").order("created_at", { ascending: false })).data ?? [] });
  const [f, setF] = useState(blank);
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const customers = companies.filter((c) => c.kind === "customer");

  const save = async () => {
    if (!f.customer_name || !f.origin_city || f.origin_state.length !== 2 || !f.dest_city || f.dest_state.length !== 2) return toast.error("Customer, origin and destination (2-letter states) are required");
    let customer_id = f.customer_id;
    if (!customer_id) {
      const { data: u } = await supabase.auth.getUser();
      const { data } = await supabase.from("companies").insert({ kind: "customer", name: f.customer_name, email: f.customer_email || null, created_by: u.user?.id }).select("id").single();
      customer_id = data?.id ?? null;
    }
    const { error } = await supabase.from("quotes").insert({
      customer_id, customer_name: f.customer_name, customer_email: f.customer_email || null, kind: f.kind,
      origin_city: f.origin_city, origin_state: f.origin_state.toUpperCase(), dest_city: f.dest_city, dest_state: f.dest_state.toUpperCase(),
      equipment: f.equipment, miles: f.miles ? Number(f.miles) : null, pickup_date: f.pickup_date || null,
      rate: Number(f.rate || 0), target_carrier_rate: f.target_carrier_rate ? Number(f.target_carrier_rate) : null, notes: f.notes || null,
    });
    if (error) return toast.error(error.message);
    if (f.target_carrier_rate) {
      const { data: me } = await supabase.auth.getUser();
      void postLowMarginNotice({ kind: "Quote", label: f.customer_name, lane: `${f.origin_city}, ${f.origin_state.toUpperCase()} → ${f.dest_city}, ${f.dest_state.toUpperCase()}`, customer: Number(f.rate || 0), carrier: Number(f.target_carrier_rate), who: (me.user?.user_metadata?.full_name as string) || me.user?.email || "a user" }).catch(() => {});
    }
    toast.success("Quote saved");
    setF(blank);
    qc.invalidateQueries({ queryKey: ["quotes"] });
    qc.invalidateQueries({ queryKey: ["companies"] });
  };

  const setStatus = async (q: Quote, status: string, reason?: string): Promise<string | null> => {
    let lost_reason = q.lost_reason;
    if (status === "lost") lost_reason = reason ?? prompt("Why was it lost? (price, service, timing…)") ?? null;
    let load_id = q.load_id;
    if (status === "won" && !load_id) {
      const { data, error } = await supabase.from("loads").insert({
        customer_id: q.customer_id, origin_city: q.origin_city, origin_state: q.origin_state, dest_city: q.dest_city, dest_state: q.dest_state,
        equipment: q.equipment, miles: q.miles, customer_rate: q.rate, carrier_rate: q.target_carrier_rate ?? 0, accessorials: q.accessorials,
        pickup_at: q.pickup_date ? `${q.pickup_date}T08:00` : null,
      }).select("id, load_number").single();
      if (error) { toast.error(error.message); return `${q.quote_number}: ${error.message}`; }
      load_id = data.id;
      toast.success(`Load ${data.load_number} created on the Dispatch Board`);
      qc.invalidateQueries({ queryKey: ["loads"] });
    }
    const { error: uerr } = await supabase.from("quotes").update({ status, lost_reason, load_id }).eq("id", q.id);
    qc.invalidateQueries({ queryKey: ["quotes"] });
    return uerr ? `${q.quote_number}: ${uerr.message}` : null;
  };
  const bulk = useSelection();
  const picked = quotes.filter((q) => bulk.has(q.id));
  const quoteActions: BulkAction<Quote>[] = [
    { value: "sent", label: "Mark sent", hint: "Marks the checked quotes as sent. No email goes out.", each: (q) => setStatus(q, "sent") },
    { value: "won", label: "Mark won (creates loads)", hint: "Marks the checked quotes won and puts a new load on the Dispatch board for each one that doesn't have a load yet.",
      points: (it) => [`${it.length} quotes will be marked won.`, `${it.filter((q) => !q.load_id).length} new loads will be created on the Dispatch board (quotes that already have a load don't get another).`], each: (q) => setStatus(q, "won") },
    { value: "lost", label: "Mark lost", hint: "Marks the checked quotes lost with the reason you pick.",
      param: { label: "Reason", options: ["Price", "Service", "Timing", "Capacity", "No response", "Other"].map((r) => ({ value: r, label: r })) },
      each: (q, r) => setStatus(q, "lost", r) },
    { value: "expired", label: "Mark expired", hint: "Marks the checked quotes expired.", each: (q) => setStatus(q, "expired") },
    { value: "draft", label: "Back to draft", hint: "Puts the checked quotes back to draft. Loads already created stay on the board.", each: (q) => setStatus(q, "draft") },
    exportAction<Quote>("Quotes", ["Quote #", "Type", "Customer", "Origin", "Destination", "Equipment", "Miles", "Rate", "Status", "Lost reason"],
      (q) => [q.quote_number, q.kind, q.customer_name, `${q.origin_city}, ${q.origin_state}`, `${q.dest_city}, ${q.dest_state}`, q.equipment, q.miles, Number(q.rate).toFixed(2), q.status, q.lost_reason]),
    deleteAction<Quote>("quotes", (q) => q.quote_number, "quotes"),
  ];

  const quoteViewer = useBlobViewer();
  const pdf = async (q: Quote) => quoteViewer.show((await buildQuotePdf(q, logo.url)).output("blob"), `Quote-${q.quote_number}.pdf`);
  const email = async (q: Quote) => {
    (await buildQuotePdf(q, logo.url)).save(`Quote-${q.quote_number}.pdf`);
    composeEmail(q.customer_email ?? "", `Clearwater Cargo quote ${q.quote_number}: ${q.origin_city}, ${q.origin_state} → ${q.dest_city}, ${q.dest_state}`,
      `Hello,\n\nThank you for the opportunity. Our ${q.kind} rate for ${q.origin_city}, ${q.origin_state} → ${q.dest_city}, ${q.dest_state} (${q.equipment}) is ${usd(Number(q.rate))} all-in.\n\nAccept or decline online in one click:\n${window.location.origin}/quote/${q.accept_token}\n\nThe quote PDF is attached (downloaded to your computer — please attach it). Valid for 24 hours.\n\nClearwater Cargo LLC · 252-497-7916`);
    if (q.status === "draft") setStatus(q, "sent");
  };

  const lane = { origin_city: f.origin_city, origin_state: f.origin_state.toUpperCase(), dest_city: f.dest_city, dest_state: f.dest_state.toUpperCase(), equipment: f.equipment, miles: f.miles ? Number(f.miles) : null };

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {quoteViewer.viewer}
      <div className="space-y-3 rounded-lg border p-4">
        <h2 className="font-display text-lg font-bold uppercase tracking-wider text-gold">New quote</h2>
        <EntityCombobox
          options={customers.map((c) => ({ id: c.id, label: c.name, sub: [c.city, c.state].filter(Boolean).join(", ") }))}
          value={{ id: f.customer_id, name: f.customer_name }}
          onChange={(v) => {
            const c = customers.find((x) => x.id === v.id);
            setF((s) => ({ ...s, customer_id: v.id, customer_name: v.name, customer_email: c?.email ?? s.customer_email }));
          }}
          placeholder="Customer (type to search or add new)"
          newLabel="new customer"
        />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Input placeholder="Customer email" value={f.customer_email} onChange={set("customer_email")} />
          <select value={f.kind} onChange={set("kind")} className="h-9 rounded border bg-background px-2 text-sm"><option value="spot">Spot</option><option value="contract">Contract</option></select>
          <Input placeholder="Origin city" value={f.origin_city} onChange={set("origin_city")} />
          <Input placeholder="ST" maxLength={2} value={f.origin_state} onChange={set("origin_state")} />
          <Input placeholder="Destination city" value={f.dest_city} onChange={set("dest_city")} />
          <Input placeholder="ST" maxLength={2} value={f.dest_state} onChange={set("dest_state")} />
          <select value={f.equipment} onChange={set("equipment")} className="h-9 rounded border bg-background px-2 text-sm">{EQUIPMENT.map((e) => <option key={e}>{e}</option>)}</select>
          <Input type="number" placeholder="Miles" value={f.miles} onChange={set("miles")} />
          <DatePicker placeholder="Pickup date" value={f.pickup_date ?? ""} onChange={(v) => set("pickup_date")({ target: { value: v } })} />
          <Input type="number" placeholder="Quote rate $ (all-in)" value={f.rate} onChange={set("rate")} />
          <Input type="number" placeholder="Target carrier pay $" value={f.target_carrier_rate} onChange={set("target_carrier_rate")} />
          <Input placeholder="Notes" value={f.notes} onChange={set("notes")} />
        </div>
        {lane.origin_state.length === 2 && lane.dest_state.length === 2 && (
          <RateView loads={loads} lane={lane} onApply={(c, k) => setF((s) => ({ ...s, rate: String(c), target_carrier_rate: String(k) }))} />
        )}
        <BuyBox customer={Number(f.rate || 0)} carrier={Number(f.target_carrier_rate || 0)} miles={Number(f.miles || 0)}
          onCarrier={(v) => setF((s) => ({ ...s, target_carrier_rate: String(v) }))} onCustomer={(v) => setF((s) => ({ ...s, rate: String(v) }))} />
        <Button onClick={save}><Plus className="mr-1 h-4 w-4" />Save quote</Button>
      </div>

      <div className="rounded-lg border p-4">
        <h2 className="mb-2 font-display text-lg font-bold uppercase tracking-wider text-gold">Quote history</h2>
        {quotes.length > 0 && <label className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"><SelectAllBox ids={quotes.map((q) => q.id)} sel={bulk} />Select all ({quotes.length})</label>}
        {picked.length > 0 && <div className="mb-2"><BulkActionBar items={picked} total={quotes.length} actions={quoteActions} onClear={bulk.clear} invalidate={["quotes", "loads"]} noun="quotes" /></div>}
        <div className="space-y-2">
          {quotes.length === 0 && <p className="text-sm text-muted-foreground">No quotes yet.</p>}
          {quotes.map((q) => {
            const expired = q.status === "sent" && new Date(q.expires_at) < new Date();
            return (
              <div key={q.id} className="flex flex-wrap items-center gap-2 rounded border p-2 text-sm">
                <Checkbox aria-label={`Select ${q.quote_number}`} checked={bulk.has(q.id)} onCheckedChange={(v) => bulk.toggle(q.id, v === true)} />
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-xs text-gold">{q.quote_number} · {q.kind}</div>
                  <div className="truncate">{q.customer_name} — {q.origin_city}, {q.origin_state} → {q.dest_city}, {q.dest_state}</div>
                  <div className="text-xs text-muted-foreground">{q.equipment} · {usd(Number(q.rate))}{q.miles ? ` · $${(Number(q.rate) / q.miles).toFixed(2)}/mi` : ""}{q.lost_reason ? ` · lost: ${q.lost_reason}` : ""}</div>
                </div>
                <select value={expired ? "expired" : q.status} onChange={(e) => setStatus(q, e.target.value)} className="h-8 rounded border bg-background px-1 text-xs capitalize">
                  {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <Button size="sm" variant="ghost" onClick={() => pdf(q)} aria-label="PDF"><FileDown className="h-4 w-4" /></Button>
                <Button size="sm" variant="ghost" onClick={() => email(q)} aria-label="Email"><Mail className="h-4 w-4" /></Button>
                <ConfirmDelete table="quotes" id={q.id} label={q.quote_number} what="Quote" invalidate={["quotes"]} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function RfpMoved() {
  return (
    <div className="rounded-lg border border-dashed p-6 text-sm">
      RFP spreadsheets, load tenders, fuel surcharge and won/lost tracking now live on the{" "}
      <Link to="/bids" search={{}} className="font-semibold text-gold underline">Bid Desk</Link>.
    </div>
  );
}
