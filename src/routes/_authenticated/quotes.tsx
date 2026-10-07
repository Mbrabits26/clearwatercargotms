import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { FileDown, FileUp, Mail, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { companiesQuery, loadsQuery } from "@/lib/queries";
import { EQUIPMENT, usd } from "@/lib/tms";
import { buildQuotePdf, type Quote } from "@/lib/quote";
import { composeEmail } from "@/lib/email";
import { getMarketRates } from "@/lib/market.functions";
import { RateView, laneStats } from "@/components/RateView";
import { EntityCombobox } from "@/components/EntityCombobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
    <div className="p-5">
      <h1 className="mb-3 font-display text-3xl font-bold uppercase tracking-wider text-gold">Quotes & RFPs</h1>
      <Tabs defaultValue="quotes">
        <TabsList><TabsTrigger value="quotes">Spot / contract quotes</TabsTrigger><TabsTrigger value="rfp">RFP lanes</TabsTrigger></TabsList>
        <TabsContent value="quotes"><QuoteBuilder /></TabsContent>
        <TabsContent value="rfp"><RfpTool /></TabsContent>
      </Tabs>
    </div>
  );
}

function QuoteBuilder() {
  const qc = useQueryClient();
  const { data: loads = [] } = useQuery(loadsQuery);
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
    toast.success("Quote saved");
    setF(blank);
    qc.invalidateQueries({ queryKey: ["quotes"] });
    qc.invalidateQueries({ queryKey: ["companies"] });
  };

  const setStatus = async (q: Quote, status: string) => {
    let lost_reason = q.lost_reason;
    if (status === "lost") lost_reason = prompt("Why was it lost? (price, service, timing…)") ?? null;
    let load_id = q.load_id;
    if (status === "won" && !load_id) {
      const { data, error } = await supabase.from("loads").insert({
        customer_id: q.customer_id, origin_city: q.origin_city, origin_state: q.origin_state, dest_city: q.dest_city, dest_state: q.dest_state,
        equipment: q.equipment, miles: q.miles, customer_rate: q.rate, carrier_rate: q.target_carrier_rate ?? 0, accessorials: q.accessorials,
        pickup_at: q.pickup_date ? `${q.pickup_date}T08:00` : null,
      }).select("id, load_number").single();
      if (error) return toast.error(error.message);
      load_id = data.id;
      toast.success(`Load ${data.load_number} created on the Dispatch Board`);
      qc.invalidateQueries({ queryKey: ["loads"] });
    }
    await supabase.from("quotes").update({ status, lost_reason, load_id }).eq("id", q.id);
    qc.invalidateQueries({ queryKey: ["quotes"] });
  };

  const pdf = async (q: Quote) => (await buildQuotePdf(q, logo.url)).save(`Quote-${q.quote_number}.pdf`);
  const email = async (q: Quote) => {
    await pdf(q);
    composeEmail(q.customer_email ?? "", `Clearwater Cargo quote ${q.quote_number}: ${q.origin_city}, ${q.origin_state} → ${q.dest_city}, ${q.dest_state}`,
      `Hello,\n\nThank you for the opportunity. Our ${q.kind} rate for ${q.origin_city}, ${q.origin_state} → ${q.dest_city}, ${q.dest_state} (${q.equipment}) is ${usd(Number(q.rate))} all-in.\n\nThe quote PDF is attached (downloaded to your computer — please attach it). Valid for 24 hours.\n\nClearwater Cargo LLC · 252-497-7916`);
    if (q.status === "draft") setStatus(q, "sent");
  };

  const lane = { origin_city: f.origin_city, origin_state: f.origin_state.toUpperCase(), dest_city: f.dest_city, dest_state: f.dest_state.toUpperCase(), equipment: f.equipment, miles: f.miles ? Number(f.miles) : null };

  return (
    <div className="grid gap-4 xl:grid-cols-2">
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
        <div className="grid grid-cols-2 gap-2">
          <Input placeholder="Customer email" value={f.customer_email} onChange={set("customer_email")} />
          <select value={f.kind} onChange={set("kind")} className="h-9 rounded border bg-background px-2 text-sm"><option value="spot">Spot</option><option value="contract">Contract</option></select>
          <Input placeholder="Origin city" value={f.origin_city} onChange={set("origin_city")} />
          <Input placeholder="ST" maxLength={2} value={f.origin_state} onChange={set("origin_state")} />
          <Input placeholder="Destination city" value={f.dest_city} onChange={set("dest_city")} />
          <Input placeholder="ST" maxLength={2} value={f.dest_state} onChange={set("dest_state")} />
          <select value={f.equipment} onChange={set("equipment")} className="h-9 rounded border bg-background px-2 text-sm">{EQUIPMENT.map((e) => <option key={e}>{e}</option>)}</select>
          <Input type="number" placeholder="Miles" value={f.miles} onChange={set("miles")} />
          <Input type="date" value={f.pickup_date} onChange={set("pickup_date")} />
          <Input type="number" placeholder="Quote rate $ (all-in)" value={f.rate} onChange={set("rate")} />
          <Input type="number" placeholder="Target carrier pay $" value={f.target_carrier_rate} onChange={set("target_carrier_rate")} />
          <Input placeholder="Notes" value={f.notes} onChange={set("notes")} />
        </div>
        {lane.origin_state.length === 2 && lane.dest_state.length === 2 && (
          <RateView loads={loads} lane={lane} onApply={(c, k) => setF((s) => ({ ...s, rate: String(c), target_carrier_rate: String(k) }))} />
        )}
        <Button onClick={save}><Plus className="mr-1 h-4 w-4" />Save quote</Button>
      </div>

      <div className="rounded-lg border p-4">
        <h2 className="mb-2 font-display text-lg font-bold uppercase tracking-wider text-gold">Quote history</h2>
        <div className="space-y-2">
          {quotes.length === 0 && <p className="text-sm text-muted-foreground">No quotes yet.</p>}
          {quotes.map((q) => {
            const expired = q.status === "sent" && new Date(q.expires_at) < new Date();
            return (
              <div key={q.id} className="flex flex-wrap items-center gap-2 rounded border p-2 text-sm">
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
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

type RfpLane = { origin_city: string; origin_state: string; dest_city: string; dest_state: string; equipment: string; miles: number | null; volume: string; hist: number | null; market: number | null; rate: string };

const pick = (row: Record<string, unknown>, names: string[]) => {
  const k = Object.keys(row).find((h) => names.some((n) => h.toLowerCase().replace(/[^a-z]/g, "").includes(n)));
  return k ? String(row[k] ?? "").trim() : "";
};

function RfpTool() {
  const { data: loads = [] } = useQuery(loadsQuery);
  const market = useServerFn(getMarketRates);
  const [lanes, setLanes] = useState<RfpLane[]>([]);
  const [busy, setBusy] = useState(false);
  const [margin, setMargin] = useState("12");

  const onFile = async (file: File) => {
    const wb = XLSX.read(await file.arrayBuffer());
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]!]!);
    const parsed = rows.map((r) => {
      const l = {
        origin_city: pick(r, ["origincity", "origin", "fromcity", "shipcity"]),
        origin_state: pick(r, ["originstate", "originst", "fromstate", "ost"]).toUpperCase().slice(0, 2),
        dest_city: pick(r, ["destcity", "destinationcity", "destination", "tocity", "consigneecity"]),
        dest_state: pick(r, ["deststate", "destinationstate", "destst", "tostate", "dst"]).toUpperCase().slice(0, 2),
        equipment: pick(r, ["equipment", "equip", "mode", "trailer"]) || "Dry Van",
        miles: Number(pick(r, ["miles", "distance"])) || null,
        volume: pick(r, ["volume", "loads", "frequency", "annual"]),
      };
      const s = laneStats(loads, { ...l }, false);
      const w = s.d365 ?? s.d90;
      const hist = w?.revCpm && l.miles ? w.revCpm * l.miles : w?.rev ?? null;
      return { ...l, hist, market: null, rate: hist ? String(Math.round(hist)) : "" };
    }).filter((l) => l.origin_state && l.dest_state);
    setLanes(parsed);
    toast.success(`${parsed.length} lanes loaded`);
  };

  const fillMarket = async () => {
    setBusy(true);
    const m = 1 / (1 - (Number(margin) || 0) / 100);
    const out = [...lanes];
    for (let i = 0; i < out.length; i++) {
      const l = out[i]!;
      try {
        const r = await market({ data: { origin_state: l.origin_state, dest_state: l.dest_state, equipment: l.equipment } });
        if (r.error) { toast.error(r.error); break; }
        const cpm = r.result?.contract_rpm ?? r.result?.spot_rpm;
        if (cpm && l.miles) {
          out[i] = { ...l, market: cpm * l.miles, rate: l.rate || String(Math.round(cpm * l.miles * m)) };
          setLanes([...out]);
        }
      } catch (e) { toast.error((e as Error).message); break; }
    }
    setBusy(false);
  };

  const exportX = () => {
    const ws = XLSX.utils.json_to_sheet(lanes.map((l) => ({
      "Origin City": l.origin_city, "Origin State": l.origin_state, "Dest City": l.dest_city, "Dest State": l.dest_state,
      Equipment: l.equipment, Miles: l.miles ?? "", Volume: l.volume, "Rate (USD all-in)": Number(l.rate) || "",
      "Rate per Mile": l.miles && Number(l.rate) ? Number((Number(l.rate) / l.miles).toFixed(2)) : "",
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Clearwater Bid");
    XLSX.writeFile(wb, "Clearwater-Cargo-RFP-Bid.xlsx");
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex cursor-pointer items-center rounded border px-3 py-1.5 text-sm hover:bg-muted">
          <FileUp className="mr-1 h-4 w-4" />Upload RFP spreadsheet
          <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
        <span className="text-sm text-muted-foreground">Target margin</span>
        <Input className="h-8 w-16" type="number" value={margin} onChange={(e) => setMargin(e.target.value)} />%
        <Button size="sm" variant="outline" disabled={!lanes.length || busy} onClick={fillMarket}>{busy ? "Checking market…" : "Add public market rates"}</Button>
        <Button size="sm" disabled={!lanes.length} onClick={exportX}><FileDown className="mr-1 h-4 w-4" />Export bid (.xlsx)</Button>
      </div>
      <p className="text-xs text-muted-foreground">Columns are matched by heading (origin city/state, destination city/state, equipment, miles, volume). Market numbers are public estimates, not live paid data.</p>
      {lanes.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted-foreground">
            <tr><th>Lane</th><th>Equip</th><th>Miles</th><th>Vol</th><th className="text-right">Our history</th><th className="text-right">Market</th><th className="text-right">Bid rate</th><th className="text-right">$/mi</th></tr>
          </thead>
          <tbody>
            {lanes.map((l, i) => (
              <tr key={i} className="border-t">
                <td>{l.origin_city}, {l.origin_state} → {l.dest_city}, {l.dest_state}</td>
                <td>{l.equipment}</td>
                <td>{l.miles ?? "—"}</td>
                <td>{l.volume}</td>
                <td className="text-right">{l.hist ? usd(l.hist) : "—"}</td>
                <td className="text-right">{l.market ? usd(l.market) : "—"}</td>
                <td className="text-right"><Input className="ml-auto h-7 w-24 text-right" value={l.rate} onChange={(e) => setLanes((s) => s.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))} /></td>
                <td className="text-right">{l.miles && Number(l.rate) ? `$${(Number(l.rate) / l.miles).toFixed(2)}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
