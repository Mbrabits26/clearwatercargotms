import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, FileDown, FileUp, Globe, Handshake, MapPin, Send, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getMarketRates } from "@/lib/market.functions";
import { drivingMiles } from "@/lib/places.functions";
import { companiesQuery, laneHistoryQuery } from "@/lib/queries";
import { EQUIPMENT, usd } from "@/lib/tms";
import { accList, counterList, estimateCarrierCost, guessMapping, laneTotals, offerRpm, OUT_FIELDS, rpmMargin, type BidKind, type Ladder, type OutField, type SheetTable } from "@/lib/bidDesk";
import { bidFiles, bidLanesQuery, bidQuery, bidTables, downloadBlob, historyFor, ladderFor, laneLabel, laneToLoad, laneToQuote, myName, noticeLowLanes, placeText, priceOne, refreshBidStatus, saveCounters, type Bid, type BidLane } from "@/lib/bids";
import { composeEmailWithFiles } from "@/lib/email";
import { EntityCombobox } from "@/components/EntityCombobox";
import { DatePicker } from "@/components/DatePicker";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { BulkActionBar, SelectAllBox, useSelection, exportAction, type BulkAction } from "@/components/BulkActionBar";
import { useConfirm, Hint } from "@/components/ActionGuard";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { BidImport } from "./BidImport";
import { AccButton } from "./AccEditor";
import { HEALTH_TONE } from "./QuickLaneCheck";

const rpm = (n: number | null | undefined) => (n ? `$${n.toFixed(2)}` : "—");
const STATUS_TONE: Record<string, string> = { pending: "", won: "text-success", lost: "text-destructive" };
const VERDICT: Record<Ladder["verdict"], { label: string; tone: string }> = {
  take: { label: "Take it", tone: "text-success" },
  counter: { label: "Counter", tone: "text-gold" },
  walk: { label: "Walk away", tone: "text-destructive" },
  needcost: { label: "Need cost", tone: "text-muted-foreground" },
};

export function BidDetail({ bidId }: { bidId: string }) {
  const qc = useQueryClient();
  const ask = useConfirm();
  const { data: bid } = useQuery(bidQuery(bidId));
  const { data: lanes = [] } = useQuery(bidLanesQuery(bidId));
  const { data: loads = [] } = useQuery(laneHistoryQuery());
  const { data: companies = [] } = useQuery(companiesQuery);
  const market$ = useServerFn(getMarketRates);
  const miles$ = useServerFn(drivingMiles);
  const [importOpen, setImportOpen] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const sel = useSelection();
  const hist = useMemo(() => new Map(lanes.map((l) => [l.id, historyFor(loads, l)])), [lanes, loads]);

  if (!bid) return <div className="p-5 text-sm text-muted-foreground">Loading bid…</div>;
  const fsc = Number(bid.fsc_per_mile);
  const kind = bid.kind as BidKind;
  const refresh = () => { qc.invalidateQueries({ queryKey: ["bid-lanes"] }); qc.invalidateQueries({ queryKey: ["bids"] }); };

  const saveBid = async (patch: Partial<Bid>) => {
    qc.setQueryData(bidQuery(bidId).queryKey, { ...bid, ...patch });
    const { error } = await supabase.from("bids").update(patch).eq("id", bidId);
    if (error) toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["bids"] });
  };
  const patchLane = async (id: string, patch: Partial<BidLane>) => {
    qc.setQueryData(bidLanesQuery(bidId).queryKey, (old) => old?.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    const { error } = await supabase.from("bid_lanes").update(patch as never).eq("id", id);
    if (error) { toast.error(error.message); refresh(); }
    if ("status" in patch) { await refreshBidStatus(bidId); qc.invalidateQueries({ queryKey: ["bids"] }); }
  };

  // Each step returns its problem lanes; `quiet` lets Auto-price show one summary instead of a toast per step.
  const fillMiles = async (only?: BidLane[], quiet = false): Promise<string[]> => {
    const todo = (only ?? lanes).filter((l) => !(Number(l.miles) > 0));
    if (!todo.length) { if (!quiet) toast.info("Every lane already has miles."); return []; }
    setBusy(`Miles 0/${todo.length}`);
    const errs: string[] = [];
    let done = 0, i = 0;
    const worker = async () => {
      while (i < todo.length) {
        const l = todo[i++]!;
        try {
          const origin = placeText(l.origin_city, l.origin_state, l.origin_zip);
          const dest = placeText(l.dest_city, l.dest_state, l.dest_zip);
          if (!dest || dest.length < 3 || !origin || origin.length < 3) errs.push(`${laneLabel(l)}: type the miles in (no destination to look up)`);
          else {
            const r = await miles$({ data: { origin, dest } });
            if (r.miles) await supabase.from("bid_lanes").update({ miles: r.miles }).eq("id", l.id);
            else errs.push(`${laneLabel(l)}: no driving route found — type the miles in`);
          }
        } catch (e) { errs.push(`${laneLabel(l)}: ${(e as Error).message}`); }
        setBusy(`Miles ${++done}/${todo.length}`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, todo.length) }, worker));
    setBusy("");
    refresh();
    if (!quiet) { if (errs.length) toast.error(`${errs.length} lanes need miles typed in`, { description: errs.slice(0, 4).join("\n") }); else toast.success("Miles added"); }
    return errs;
  };

  // One national market lookup per trailer type (the sources only publish national rates), applied to every lane of that type.
  const fillMarket = async (only?: BidLane[], force = false, quiet = false): Promise<string[]> => {
    const todo = (only ?? lanes).filter((l) => force || (l.market_spot_rpm == null && l.market_contract_rpm == null));
    const types = [...new Set(todo.map((l) => l.equipment || "Dry Van"))];
    if (!types.length) { if (!quiet) toast.info("Market rates are already filled in. Tick lanes and use “Refresh market rates” to check again."); return []; }
    const errs: string[] = [];
    let done = 0;
    setBusy(`Market 0/${types.length}`);
    for (const equipment of types) {
      const ids = todo.filter((l) => (l.equipment || "Dry Van") === equipment).map((l) => l.id);
      const o = (todo.find((l) => (l.equipment || "Dry Van") === equipment)?.origin_state ?? "").trim().toUpperCase();
      const os = o.length === 2 ? o : "NC";
      try {
        const r = await market$({ data: { origin_state: os, dest_state: os, equipment, refresh: force, national: true } });
        const m = r.result;
        if (r.error || !m || !(Number(m.spot_rpm) > 0 || Number(m.contract_rpm) > 0)) errs.push(`${equipment} (${ids.length} lanes): ${r.error ?? "no published market rate found — type a carrier cost"}`);
        else {
          for (let k = 0; k < ids.length; k += 200) {
            await supabase.from("bid_lanes").update({ market_spot_rpm: m.spot_rpm, market_contract_rpm: m.contract_rpm, market_note: `${m.scope}${r.fetched_at ? ` · ${new Date(r.fetched_at).toLocaleDateString()}` : ""}` }).in("id", ids.slice(k, k + 200));
          }
        }
      } catch (e) { errs.push(`${equipment}: ${(e as Error).message}`); }
      setBusy(`Market ${++done}/${types.length}`);
      qc.invalidateQueries({ queryKey: ["bid-lanes", bidId] });
    }
    setBusy("");
    if (!quiet) { if (errs.length) toast.error("Some market rates couldn't be found", { description: errs.slice(0, 4).join("\n") }); else toast.success("Market rates added"); }
    return errs;
  };

  const priceAll = async (overwrite: boolean, only?: BidLane[], margin = Number(bid.target_margin), quiet = false): Promise<string[]> => {
    const todo = only ?? lanes;
    if (overwrite && !(await ask({ title: `Re-price ${todo.length} lanes at ${margin}%?`, points: ["Carrier cost and linehaul are recalculated from our lane history, else the market rate.", "Rates you typed by hand on these lanes are replaced."], confirmLabel: "Re-price" }))) return [];
    setBusy("Pricing…");
    const errs: string[] = [];
    for (const l of todo) { const e = await priceOne(l, bid, loads, margin, overwrite); if (e) errs.push(e); }
    setBusy("");
    refresh();
    if (!quiet) { if (errs.length) toast.error(`${errs.length} lanes couldn't be priced`, { description: errs.slice(0, 4).join("\n") }); else toast.success("Lanes priced"); }
    return errs;
  };

  const buildCounters = async (overwrite: boolean, only?: BidLane[], quiet = false): Promise<string[]> => {
    const todo = only ?? lanes;
    if (overwrite && !(await ask({ title: `Rebuild counteroffers on ${todo.length} lanes?`, points: [`Counters run from your ${bid.target_margin}% target down to the 8% floor, using the shipper's offer${bid.offer_below_pct ? ` and their likely budget (offer ÷ ${(1 - Number(bid.offer_below_pct) / 100).toFixed(2)})` : ""}.`, "Counters and linehaul you typed on these lanes are replaced."], confirmLabel: "Rebuild" }))) return [];
    setBusy("Building counters…");
    const errs: string[] = [];
    for (const l of todo) { const e = await saveCounters(l, bid, loads, overwrite); if (e) errs.push(e); }
    setBusy("");
    refresh();
    if (!quiet) { if (errs.length) toast.error(`${errs.length} lanes need a carrier cost first`, { description: errs.slice(0, 4).join("\n") }); else toast.success("Counteroffers ready"); }
    return errs;
  };

  // One click: miles → market rates → counters → pricing, re-reading lanes between steps so nothing is skipped.
  const autoAll = async (only?: BidLane[]) => {
    const ids = new Set((only ?? lanes).map((l) => l.id));
    // Read straight from the database each step (not the screen's cached copy) so later steps see the miles/rates just saved.
    const fresh = async () => (await bidLanesQuery(bidId).queryFn!({} as never) as BidLane[]).filter((l) => ids.has(l.id));
    let cur = await fresh();
    const problems: string[] = [];
    if (cur.some((l) => !(Number(l.miles) > 0))) { problems.push(...await fillMiles(cur, true)); cur = await fresh(); }
    const needMarket = cur.filter((l) => l.market_spot_rpm == null && l.market_contract_rpm == null && !(Number(l.carrier_cost) > 0));
    if (needMarket.length) { problems.push(...await fillMarket(needMarket, false, true)); cur = await fresh(); }
    await buildCounters(false, cur, true);
    cur = await fresh();
    await priceAll(false, cur, Number(bid.target_margin), true);
    cur = await fresh();
    const open = cur.filter((l) => !(Number(l.linehaul) > 0) || !counterList(l.counters).some(Boolean));
    if (!open.length) return toast.success(`All ${cur.length} lanes priced with counteroffers`);
    const why = [...new Set(problems)].slice(0, 3);
    toast.warning(`${cur.length - open.length} of ${cur.length} lanes priced — ${open.length} still need something`, {
      description: (why.length ? why : open.slice(0, 3).map((l) => `${laneLabel(l)}: ${!(Number(l.miles) > 0) ? "needs miles" : "needs a carrier cost"}`)).join("\n"),
      duration: 12000,
    });
  };

  const setEquipment = async (items: BidLane[], equipment: string) => {
    const { error } = await supabase.from("bid_lanes").update({ equipment, market_spot_rpm: null, market_contract_rpm: null, market_note: null }).in("id", items.map((l) => l.id));
    if (error) toast.error(error.message); else toast.success(`${items.length} lane${items.length === 1 ? "" : "s"} set to ${equipment} — get market rates again for the new trailer type.`);
    refresh();
  };

  const picked = lanes.filter((l) => sel.has(l.id));
  const setStatus = async (l: BidLane, status: string, reason?: string) => {
    const { error } = await supabase.from("bid_lanes").update({ status, lost_reason: status === "lost" ? reason ?? null : null }).eq("id", l.id);
    return error ? `${laneLabel(l)}: ${error.message}` : null;
  };
  const after = async () => { await refreshBidStatus(bidId); refresh(); };
  const laneActions: BulkAction<BidLane>[] = [
    { value: "won", label: "Mark won", hint: "Marks the checked lanes as awarded to us.", each: async (l) => { const e = await setStatus(l, "won"); await after(); return e; } },
    { value: "lost", label: "Mark lost", hint: "Marks the checked lanes lost with the reason you pick.", param: { label: "Reason", options: ["Price", "Service", "Capacity", "Incumbent kept", "No response", "Other"].map((r) => ({ value: r, label: r })) },
      each: async (l, r) => { const e = await setStatus(l, "lost", r); await after(); return e; } },
    { value: "pending", label: "Back to pending", hint: "Clears the won/lost result on the checked lanes.", each: async (l) => { const e = await setStatus(l, "pending"); await after(); return e; } },
    { value: "equipment", label: "Change equipment", hint: "Sets the trailer type on the checked lanes. Their market rates are cleared so they can be looked up for the new type.",
      param: { label: "Equipment", options: EQUIPMENT.map((e) => ({ value: e, label: e })) }, all: (items, e) => void setEquipment(items, e || "Dry Van") },
    { value: "auto", label: "Auto-price + counter", hint: "Fills miles, market rates, counteroffers and pricing on the checked lanes that are missing them.", all: (items) => void autoAll(items) },
    { value: "fsc", label: "Set fuel surcharge $/mi", hint: "Sets a per-mile fuel surcharge on the checked lanes (blank uses the bid default). Linehaul stays as is.", input: { label: "FSC $/mi, e.g. 0.55 (blank = bid default)", optional: true },
      each: async (l, v) => { const { error } = await supabase.from("bid_lanes").update({ fsc_per_mile: v.trim() === "" ? null : Number(v) }).eq("id", l.id); return error ? error.message : null; } },
    { value: "acc", label: "Add accessorial", hint: "Adds the same extra charge to each checked lane, e.g. “Tarp 75”.", input: { label: "Name and amount, e.g. Stop-off 100" },
      each: async (l, v) => {
        const m = v.trim().match(/^(.*?)[\s:$]+(\d+(?:\.\d+)?)$/);
        if (!m) return "Write it as a name then an amount, e.g. Tarp 75";
        const { error } = await supabase.from("bid_lanes").update({ accessorials: [...accList(l.accessorials), { type: m[1]!.trim() || "Other", amount: Number(m[2]) }] as never }).eq("id", l.id);
        return error ? error.message : null;
      } },
    { value: "price", label: "Re-price at margin", hint: "Recalculates carrier cost (our history first, then market) and the linehaul that hits the margin you pick. Replaces typed rates on the checked lanes.",
      param: { label: "Margin", options: [8, 10, 12, 15, 18, 20, 25].map((m) => ({ value: String(m), label: `${m}%` })) },
      each: async (l, m) => priceOne(l, bid, loads, Number(m), true) },
    { value: "counters", label: "Rebuild counteroffers", hint: "Works out counter 1, 2 and a walk-away for the checked lanes from carrier cost, your target margin and the shipper's offer. Replaces typed counters.", all: (items) => void buildCounters(true, items) },
    { value: "agree", label: "Set agreed = last counter", hint: "Copies each checked lane's last counteroffer into its agreed rate (goes in the shipper's Final column).",
      each: async (l) => { const c = counterList(l.counters).filter(Boolean).pop(); if (!c) return `${laneLabel(l)}: no counters yet`; const { error } = await supabase.from("bid_lanes").update({ agreed_rpm: c }).eq("id", l.id); return error ? error.message : null; } },
    { value: "market", label: "Refresh market rates", hint: "Checks public market rates again for the checked lanes (uses the AI web search).", all: (items) => void fillMarket(items, true) },
    { value: "miles", label: "Look up missing miles", hint: "Looks up driving miles for checked lanes that have none.", all: (items) => void fillMiles(items) },
    { value: "quote", label: "Save as quotes", hint: "Creates a quote for each checked, priced lane (all-in rate; the linehaul/FSC breakdown goes in the notes). Lanes that already have a quote are skipped.",
      points: (it) => [`${it.filter((l) => !l.quote_id).length} quotes will be created on the Quotes page.`, "Any lane below 8% margin posts one Team chat notice."],
      each: async (l) => laneToQuote(l, bid) },
    { value: "load", label: "Create loads (won lanes)", hint: "Puts a new load on the Dispatch board for each checked lane and marks it won. Lanes that already made a load are skipped.",
      points: (it) => [`${it.filter((l) => !l.load_id).length} new loads will be created on the Dispatch board.`, "Customer rate = the lane's all-in; carrier pay = its carrier cost."],
      each: async (l) => { const e = await laneToLoad(l, bid); await after(); return e; } },
    exportAction<BidLane>(`${bid.bid_number} lanes`, ["Lane", "Equipment", "Miles", "Volume", "Shipper offer $/mi", "Counter 1", "Counter 2", "Counter 3", "Agreed $/mi", "Carrier cost", "Linehaul", "FSC $/mi", "FSC", "Accessorials", "All-in", "$/mi", "Margin %", "Status"],
      (l) => { const t = laneTotals(l, fsc); const c = counterList(l.counters); const o = offerRpm(l); return [laneLabel(l), l.equipment, l.miles, l.volume, o?.toFixed(2), c[0]?.toFixed(2), c[1]?.toFixed(2), c[2]?.toFixed(2), l.agreed_rpm, t.carrier, t.linehaul, t.fscRpm.toFixed(2), t.fsc, t.acc, t.allIn, t.allInRpm?.toFixed(2), t.health === "none" ? "" : t.pct.toFixed(1), l.status]; }),
    { value: "delete", label: "Delete lanes", danger: true, adminOnly: true, hint: "Removes the checked lanes from this bid. Quotes and loads already made stay.",
      each: async (l) => { const { error } = await supabase.from("bid_lanes").delete().eq("id", l.id); return error ? error.message : null; } },
  ];

  // after "Save as quotes" a single low-margin notice goes out for the batch
  const runQuotes = async () => {
    const todo = lanes.filter((l) => !l.quote_id && laneTotals(l, fsc).linehaul > 0);
    if (!todo.length) return toast.info("No priced lanes without a quote.");
    if (!(await ask({ title: `Save ${todo.length} lanes as quotes?`, points: [`${todo.length} quotes will be created on the Quotes page at each lane's all-in rate.`, "Lanes below 8% margin post one Team chat notice."], confirmLabel: "Save quotes" }))) return;
    setBusy("Saving quotes…");
    const errs: string[] = [];
    for (const l of todo) { const e = await laneToQuote(l, bid); if (e) errs.push(e); }
    await noticeLowLanes(todo, bid, await myName()).catch(() => {});
    setBusy("");
    refresh();
    qc.invalidateQueries({ queryKey: ["quotes"] });
    if (errs.length) toast.error(`${errs.length} lanes skipped`, { description: errs.slice(0, 4).join("\n") }); else toast.success(`${todo.length} quotes saved`);
  };

  const totals = lanes.map((l) => laneTotals(l, fsc));
  const priced = totals.filter((t) => t.health !== "none");
  const avgPct = priced.length ? priced.reduce((s, t) => s + t.pct, 0) / priced.length : 0;
  const won = lanes.filter((l) => l.status === "won").length, lost = lanes.filter((l) => l.status === "lost").length;
  const annRev = totals.reduce((s, t) => s + t.annualRevenue, 0), annProfit = totals.reduce((s, t) => s + t.annualProfit, 0);
  const customers = companies.filter((c) => c.kind === "customer");
  const plans = new Map(lanes.map((l) => [l.id, ladderFor(l, bid, hist.get(l.id)?.costRpm ?? null)]));
  const offered = lanes.filter((l) => offerRpm(l) != null);
  const vcount = (v: Ladder["verdict"]) => offered.filter((l) => plans.get(l.id)!.ladder.verdict === v).length;
  const ready = lanes.filter((l) => laneTotals(l, fsc).linehaul > 0 || counterList(l.counters).some(Boolean));
  const download = async () => {
    setBusy("Building sheet…");
    try { for (const f of await bidFiles(bid, lanes, guessMapping((bid.source_headers as string[]) ?? []))) downloadBlob(f.blob, f.filename); }
    catch (e) { toast.error((e as Error).message); }
    setBusy("");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/bids" search={{}} className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="mr-1 h-4 w-4" />All bids</Link>
        <span className="font-mono text-sm text-gold">{bid.bid_number}</span>
        <span className="rounded border px-2 py-0.5 text-xs uppercase tracking-wider">{bid.status}</span>
        {bid.submitted_at && <span className="text-xs text-muted-foreground">submitted {new Date(bid.submitted_at).toLocaleDateString()}</span>}
      </div>

      <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs text-muted-foreground">Bid name<Input defaultValue={bid.name} onBlur={(e) => e.target.value.trim() && e.target.value !== bid.name && saveBid({ name: e.target.value.trim() })} /></label>
        <div className="text-xs text-muted-foreground">Customer
          <EntityCombobox options={customers.map((c) => ({ id: c.id, label: c.name, sub: [c.city, c.state].filter(Boolean).join(", ") }))}
            value={{ id: bid.customer_id, name: bid.customer_name ?? "" }}
            onChange={(v) => { const c = customers.find((x) => x.id === v.id); saveBid({ customer_id: v.id, customer_name: v.name || null, customer_email: c?.email ?? bid.customer_email }); }}
            placeholder="Customer" newLabel="name only" />
        </div>
        <label className="text-xs text-muted-foreground">Customer email<Input key={bid.customer_email ?? ""} defaultValue={bid.customer_email ?? ""} onBlur={(e) => e.target.value !== (bid.customer_email ?? "") && saveBid({ customer_email: e.target.value.trim() || null })} /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-muted-foreground">Type
            <select value={bid.kind} onChange={(e) => saveBid({ kind: e.target.value })} className="h-9 w-full rounded border bg-background px-2 text-sm text-foreground"><option value="spot">Spot</option><option value="contract">Contract</option></select>
          </label>
          <div className="text-xs text-muted-foreground">Due date<DatePicker value={bid.due_date ?? ""} onChange={(v) => saveBid({ due_date: v || null })} placeholder="Due" /></div>
        </div>
        <label className="text-xs text-muted-foreground">Default fuel surcharge $/mi<Input type="number" step="0.01" defaultValue={String(bid.fsc_per_mile)} onBlur={(e) => Number(e.target.value || 0) !== fsc && saveBid({ fsc_per_mile: Number(e.target.value || 0) })} /></label>
        <label className="text-xs text-muted-foreground">Target margin %<Input type="number" defaultValue={String(bid.target_margin)} onBlur={(e) => Number(e.target.value || 0) !== Number(bid.target_margin) && saveBid({ target_margin: Number(e.target.value || 0) })} /></label>
        <label className="text-xs text-muted-foreground">Shipper's opening offer is % below budget
          <Input type="number" placeholder="Blank if unknown" key={String(bid.offer_below_pct ?? "")} defaultValue={bid.offer_below_pct == null ? "" : String(bid.offer_below_pct)}
            onBlur={(e) => { const v = e.target.value.trim() === "" ? null : Number(e.target.value); if (v !== (bid.offer_below_pct == null ? null : Number(bid.offer_below_pct))) saveBid({ offer_below_pct: v }); }} />
        </label>
        <label className="text-xs text-muted-foreground">Notes<Input defaultValue={bid.notes ?? ""} onBlur={(e) => e.target.value !== (bid.notes ?? "") && saveBid({ notes: e.target.value || null })} /></label>
        {bid.sheet_notes && (
          <details className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-4">
            <summary className="cursor-pointer text-gold">Notes from the customer's sheet</summary>
            <p className="mt-1 whitespace-pre-wrap">{bid.sheet_notes}</p>
          </details>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setImportOpen(true)}><FileUp className="mr-1 h-4 w-4" />Add lanes</Button>
        <Hint text="Looks up driving miles for lanes that don't have them."><Button size="sm" variant="outline" disabled={!!busy || !lanes.length} onClick={() => fillMiles()}><MapPin className="mr-1 h-4 w-4" />Fill miles</Button></Hint>
        <Hint text="Checks public freight-market rate pages (AI web search) once per trailer type (national rate) and fills every lane of that type. Results are saved for 24 hours."><Button size="sm" variant="outline" disabled={!!busy || !lanes.length} onClick={() => fillMarket()}><Globe className="mr-1 h-4 w-4" />Get market rates</Button></Hint>
        <Hint text={`Fills carrier cost and linehaul at ${bid.target_margin}% on lanes that aren't priced yet. Uses our own lane history first, then the ${bid.kind} market rate.`}><Button size="sm" variant="outline" disabled={!!busy || !lanes.length} onClick={() => priceAll(false)}><Sparkles className="mr-1 h-4 w-4" />Price open lanes</Button></Hint>
        <Hint text={`Builds counter 1, counter 2 and a walk-away $/mi on lanes that don't have counters yet: from your ${bid.target_margin}% target down to the 8% floor, against the shipper's offer. Lanes with miles also get priced at counter 1.`}><Button size="sm" variant="outline" disabled={!!busy || !lanes.length} onClick={() => buildCounters(false)}><Handshake className="mr-1 h-4 w-4" />Build counteroffers</Button></Hint>
        <Hint text="Does it all for every lane: looks up missing miles, market rates for each lane's trailer type, then builds counteroffers and prices open lanes. Lanes you already typed are kept."><Button size="sm" disabled={!!busy || !lanes.length} onClick={() => autoAll()}><Sparkles className="mr-1 h-4 w-4" />Auto-price all lanes</Button></Hint>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">Equipment (all lanes)
          <select value="" onChange={(e) => e.target.value && setEquipment(lanes, e.target.value)} disabled={!lanes.length || !!busy} className="h-8 rounded border bg-background px-1 text-sm text-foreground">
            <option value="">Change…</option>{EQUIPMENT.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <Hint text="Downloads the customer's own workbook with our counteroffers and rates filled into their cells (all sheets kept). Nothing changes here."><Button size="sm" variant="outline" disabled={!lanes.length || !!busy} onClick={download}><FileDown className="mr-1 h-4 w-4" />Download bid sheet</Button></Hint>
        <Hint text="Saves each priced lane as a quote on the Quotes page."><Button size="sm" variant="outline" disabled={!!busy || !priced.length} onClick={runQuotes}>Save as quotes</Button></Hint>
        <Button size="sm" disabled={!ready.length} onClick={() => setSubmitOpen(true)}><Send className="mr-1 h-4 w-4" />Submit bid</Button>
        {busy && <span className="text-xs text-gold">{busy}</span>}
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-6">
        <Stat label="Lanes" value={`${lanes.length} (${priced.length} priced)`} />
        <Stat label="Shipper offers" value={offered.length ? `${vcount("take")} take · ${vcount("counter")} counter · ${vcount("walk")} walk` : "—"} />
        <Stat label="Avg margin" value={priced.length ? `${avgPct.toFixed(1)}%` : "—"} />
        <Stat label="Won / lost" value={`${won} / ${lost}`} />
        <Stat label="Est. annual revenue" value={annRev ? usd(annRev) : "—"} />
        <Stat label="Est. annual profit" value={annProfit ? usd(annProfit) : "—"} gold />
      </div>

      {picked.length > 0 && <BulkActionBar items={picked} total={lanes.length} actions={laneActions} onClear={sel.clear} invalidate={["bid-lanes", "bids", "quotes", "loads"]} noun="lanes" />}

      {lanes.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No lanes yet. <button className="text-gold underline" onClick={() => setImportOpen(true)}>Upload an RFP spreadsheet, a load tender, or type a lane.</button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[1600px] text-sm">
            <thead className="bg-muted/40 text-left text-[11px] uppercase text-muted-foreground">
              <tr>
                <th className="w-8 p-2"><SelectAllBox ids={lanes.map((l) => l.id)} sel={sel} /></th>
                <th className="p-2">Lane</th><th className="p-2">Miles</th>{kind === "contract" && <th className="p-2">Loads/wk</th>}
                <th className="p-2 text-right">History $/mi</th><th className="p-2 text-right">Market $/mi</th>
                <th className="p-2 text-right">Shipper offer $/mi</th><th className="p-2">Counteroffers $/mi</th><th className="p-2 text-right">Agreed $/mi</th>
                <th className="p-2 text-right">Carrier cost</th><th className="p-2 text-right">Linehaul</th><th className="p-2 text-right">FSC $/mi</th>
                <th className="p-2 text-right">Acc.</th><th className="p-2 text-right">All-in</th><th className="p-2 text-right">$/mi</th><th className="p-2 text-right">Margin</th>
                <th className="p-2">Result</th><th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {lanes.map((l) => {
                const t = laneTotals(l, fsc);
                const h = hist.get(l.id);
                const est = estimateCarrierCost(l, kind, h?.costRpm ?? null);
                const plan = plans.get(l.id)!;
                const offer = offerRpm(l);
                const saved = counterList(l.counters);
                return (
                  <tr key={l.id} className={cn("border-t align-top", sel.has(l.id) && "bg-gold/5")}>
                    <td className="p-2"><Checkbox checked={sel.has(l.id)} onCheckedChange={(v) => sel.toggle(l.id, v === true)} aria-label="Select lane" /></td>
                    <td className="p-2">
                      <div className="font-medium">{laneLabel(l)}</div>
                      <div className="text-xs text-muted-foreground"><select value={EQUIPMENT.includes(l.equipment) ? l.equipment : ""} onChange={(e) => setEquipment([l], e.target.value)} className="mr-1 h-6 rounded border bg-background px-1 text-xs text-foreground">{!EQUIPMENT.includes(l.equipment) && <option value="">{l.equipment}</option>}{EQUIPMENT.map((x) => <option key={x} value={x}>{x}</option>)}</select>{l.mileage_band ? ` · band ${l.mileage_band}` : ""}{l.volume ? ` · vol ${l.volume}` : ""}{l.pickup_date ? ` · PU ${l.pickup_date}` : ""}{l.quote_id ? " · quoted" : ""}{l.load_id ? " · load made" : ""}</div>
                    </td>
                    <td className="p-2"><Cell value={l.miles} onSave={(v) => patchLane(l.id, { miles: v })} w="w-16" /></td>
                    {kind === "contract" && <td className="p-2"><Cell value={l.loads_per_week} onSave={(v) => patchLane(l.id, { loads_per_week: v })} w="w-14" step="0.1" /></td>}
                    <td className="p-2 text-right text-xs">{h ? <span title={`${h.n} of our loads`}>{rpm(h.revRpm)} / {rpm(h.costRpm)}<div className="text-muted-foreground">sell / buy · {h.n}</div></span> : "—"}</td>
                    <td className="p-2 text-right text-xs" title={l.market_note ?? ""}>{l.market_spot_rpm || l.market_contract_rpm ? <>{rpm(l.market_spot_rpm)} / {rpm(l.market_contract_rpm)}<div className="text-muted-foreground">spot / contract</div></> : "—"}</td>
                    <td className="p-2 text-right">
                      <Cell value={l.offer_rpm} step="0.01" w="w-24" placeholder={offer ? offer.toFixed(2) : ""} onSave={(v) => patchLane(l.id, { offer_rpm: v })} />
                      {l.offer_flat ? <div className="text-[11px] text-muted-foreground">{usd(Number(l.offer_flat))} flat</div> : null}
                      {plan.ladder.budget ? <div className="text-[11px] text-muted-foreground" title="Their offer ÷ (1 − the % below budget)">budget ≈ {rpm(plan.ladder.budget)}</div> : null}
                    </td>
                    <td className="p-2">
                      <div className="flex gap-1">
                        {[0, 1, 2].map((i) => (
                          <Cell key={i} value={saved[i] ?? null} step="0.01" w="w-20" placeholder={plan.ladder.counters[i]?.toFixed(2) ?? ""}
                            onSave={(v) => { const next = [0, 1, 2].map((j) => (j === i ? v : saved[j] ?? null)); while (next.length && next[next.length - 1] == null) next.pop(); patchLane(l.id, { counters: next as never }); }} />
                        ))}
                      </div>
                      <div className="mt-0.5 text-[11px]" title={plan.ladder.note}>
                        <span className={VERDICT[plan.ladder.verdict].tone}>{offer || plan.ladder.verdict === "needcost" ? VERDICT[plan.ladder.verdict].label : "Plan"}</span>
                        {plan.cost.rpm ? <span className="text-muted-foreground"> · cost {rpm(plan.cost.rpm)} ({plan.cost.source})</span> : null}
                        {saved[0] ? <span className="text-muted-foreground"> · C1 {rpmMargin(saved[0], plan.cost.rpm)?.toFixed(0) ?? "—"}%</span> : null}
                      </div>
                    </td>
                    <td className="p-2 text-right"><Cell value={l.agreed_rpm} step="0.01" w="w-20" onSave={(v) => patchLane(l.id, { agreed_rpm: v })} /></td>
                    <td className="p-2 text-right"><Cell value={l.carrier_cost} placeholder={est.cost ? String(est.cost) : ""} onSave={(v) => patchLane(l.id, { carrier_cost: v })} /></td>
                    <td className="p-2 text-right"><Cell value={l.linehaul} onSave={(v) => patchLane(l.id, { linehaul: v })} /></td>
                    <td className="p-2 text-right"><Cell value={l.fsc_per_mile} placeholder={fsc.toFixed(2)} step="0.01" w="w-20" onSave={(v) => patchLane(l.id, { fsc_per_mile: v })} /><div className="text-[11px] text-muted-foreground">{t.fsc ? usd(t.fsc) : ""}</div></td>
                    <td className="p-2 text-right"><AccButton value={accList(l.accessorials)} onChange={(v) => patchLane(l.id, { accessorials: v as never })} /></td>
                    <td className="p-2 text-right font-semibold text-gold">{t.linehaul > 0 ? usd(t.allIn) : "—"}</td>
                    <td className="p-2 text-right text-xs">{t.linehaul > 0 ? rpm(t.allInRpm) : "—"}</td>
                    <td className={cn("p-2 text-right text-xs", HEALTH_TONE[t.health])}>{t.health === "none" ? "—" : <>{t.pct.toFixed(1)}%<div>{usd(t.margin)}</div>{kind === "contract" && t.annualProfit ? <div className="text-muted-foreground">{usd(t.annualProfit)}/yr</div> : null}</>}</td>
                    <td className="p-2">
                      <select value={l.status} onChange={(e) => patchLane(l.id, { status: e.target.value, lost_reason: e.target.value === "lost" ? l.lost_reason : null })} className={cn("h-7 rounded border bg-background px-1 text-xs", STATUS_TONE[l.status])}>
                        <option value="pending">Pending</option><option value="won">Won</option><option value="lost">Lost</option>
                      </select>
                      {l.status === "lost" && <Input className="mt-1 h-7 w-24 text-xs" placeholder="Why?" defaultValue={l.lost_reason ?? ""} onBlur={(e) => e.target.value !== (l.lost_reason ?? "") && patchLane(l.id, { lost_reason: e.target.value || null })} />}
                    </td>
                    <td className="p-2"><ConfirmDelete table="bid_lanes" id={l.id} label={laneLabel(l)} what="Lane" invalidate={["bid-lanes"]} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground"><b>Counteroffers</b> (all-in $/mi): grey numbers are the suggestion — type over any of them. Counter 1 opens at your target margin (or the shipper's likely budget if that's lower), the last counter is your walk-away (the 8% floor, or their offer if it already clears it), and counter 2 splits the difference. “Take it” means their offer already beats your target; “Walk away” means even their likely budget is under your floor. Flat-rate tables get the counters back as dollars.</p>
      <p className="text-xs text-muted-foreground">All-in = linehaul + fuel surcharge (per mile × miles) + accessorials. Carrier cost is what we expect to pay the carrier all-in; blank cells show our estimate in grey. History comes from all brokers' loads on the same states (Foust Farms loads left out). Market numbers are public estimates, not paid DAT data.</p>

      {importOpen && <BidImport bid={bid} startPos={lanes.length} open={importOpen} onOpenChange={setImportOpen} />}
      {submitOpen && <SubmitBid bid={bid} lanes={ready} onClose={() => setSubmitOpen(false)} onQuotes={runQuotes} />}
    </div>
  );
}

function Stat({ label, value, gold }: { label: string; value: string; gold?: boolean }) {
  return <div className="rounded border p-2"><div className="text-[11px] uppercase text-muted-foreground">{label}</div><div className={cn("font-semibold", gold && "text-gold")}>{value}</div></div>;
}

/** Number cell that saves when you leave it. */
function Cell({ value, onSave, placeholder, w = "w-20", step }: { value: number | null; onSave: (v: number | null) => void; placeholder?: string; w?: string; step?: string }) {
  return (
    <Input key={String(value ?? "")} type="number" step={step} className={cn("ml-auto h-7 text-right text-xs", w)} defaultValue={value == null ? "" : String(value)} placeholder={placeholder}
      onBlur={(e) => { const v = e.target.value.trim() === "" ? null : Number(e.target.value); if (v !== (value == null ? null : Number(value))) onSave(v); }} />
  );
}

function SubmitBid({ bid, lanes, onClose, onQuotes }: { bid: Bid; lanes: BidLane[]; onClose: () => void; onQuotes: () => Promise<unknown> }) {
  const qc = useQueryClient();
  const headers = Array.isArray(bid.source_headers) ? (bid.source_headers as string[]) : [];
  const [outMap, setOutMap] = useState<Partial<Record<OutField, string>>>(() => {
    const g = guessMapping(headers);
    return Object.fromEntries((Object.keys(OUT_FIELDS) as OutField[]).filter((k) => g[k]).map((k) => [k, g[k]]));
  });
  const priced = lanes;
  const tables = bidTables(bid);
  const fscNote = Number(bid.fsc_per_mile) ? ` Fuel surcharge is figured at $${Number(bid.fsc_per_mile).toFixed(2)} per mile and shown separately.` : "";
  const [to, setTo] = useState(bid.customer_email ?? "");
  const [subject, setSubject] = useState(`Clearwater Cargo ${bid.kind} bid ${bid.bid_number}${bid.customer_name ? ` — ${bid.customer_name}` : ""}`);
  const [body, setBody] = useState(`Hello,\n\nThank you for the opportunity to bid. Attached are Clearwater Cargo's ${bid.kind} rates for ${priced.length} lane${priced.length === 1 ? "" : "s"}, filled into your sheet${tables.length ? "" : " with linehaul, fuel surcharge and all-in rates"}.${fscNote}\n\n${bid.kind === "contract" ? "Rates are valid for the term of the award, subject to the volume shown." : "Rates are valid for 24 hours, subject to capacity."}\n\nPlease let us know if you have any questions.\n\nClearwater Cargo LLC · Staley, NC · 252-497-7916`);
  const [sending, setSending] = useState(false);
  const markSubmitted = async () => {
    if (bid.status === "draft") await supabase.from("bids").update({ status: "submitted", submitted_at: new Date().toISOString() }).eq("id", bid.id);
    else if (!bid.submitted_at) await supabase.from("bids").update({ submitted_at: new Date().toISOString() }).eq("id", bid.id);
    qc.invalidateQueries({ queryKey: ["bids"] });
  };
  const files = () => bidFiles(bid, priced, outMap);
  const setTableOut = async (key: string, k: OutField, v: string) => {
    const next: SheetTable[] = tables.map((t) => (t.key === key ? { ...t, out: { ...t.out, [k]: v || undefined } } : t));
    qc.setQueryData(bidQuery(bid.id).queryKey, { ...bid, source_tables: next as never });
    const { error } = await supabase.from("bids").update({ source_tables: next as never }).eq("id", bid.id);
    if (error) toast.error(error.message);
  };
  const send = async () => {
    if (!to.trim()) return toast.error("Add the customer's email.");
    setSending(true);
    const sent = await composeEmailWithFiles(to.trim(), subject, body, await files());
    setSending(false);
    toast.success(sent ? "Bid emailed from your Gmail" : "Draft opened — attach the downloaded bid sheet");
    await markSubmitted();
    onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-auto">
        <DialogHeader><DialogTitle>Submit {bid.bid_number} · {priced.length} lanes</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          {tables.length > 0 ? (
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase text-muted-foreground">Our numbers go into the customer's own workbook</div>
              {tables.map((t) => (
                <div key={t.key} className="rounded border p-2">
                  <div className="mb-1 text-xs font-medium">{t.label}</div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {(["counter1", "counter2", "counter3", "final", "rpm", "all_in", "linehaul", "fsc_rpm"] as OutField[]).map((k) => (
                      <label key={k} className="text-[11px] text-muted-foreground">{OUT_FIELDS[k]}
                        <select className="mt-0.5 h-7 w-full rounded border bg-background px-1 text-xs text-foreground" value={t.out[k] ?? ""} onChange={(e) => void setTableOut(t.key, k, e.target.value)}>
                          <option value="">— leave out —</option>
                          {t.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={async () => { for (const f of await files()) downloadBlob(f.blob, f.filename); await markSubmitted(); toast.success("Bid sheet downloaded and bid marked submitted"); }}><FileDown className="mr-1 h-4 w-4" />Download sheet & mark submitted</Button>
            </div>
          ) : (
          <div>
            <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Where our numbers go in the sheet</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {(Object.keys(OUT_FIELDS) as OutField[]).map((k) => (
                <label key={k} className="text-xs text-muted-foreground">{OUT_FIELDS[k]}
                  <select className="mt-0.5 h-8 w-full rounded border bg-background px-1 text-sm text-foreground" value={outMap[k] ?? ""} onChange={(e) => setOutMap((m) => ({ ...m, [k]: e.target.value || undefined }))}>
                    <option value="">New column at the end</option>
                    {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </label>
              ))}
            </div>
            {!headers.length && <p className="mt-1 text-xs text-muted-foreground">No shipper sheet was uploaded, so a clean Clearwater sheet is made.</p>}
            <Button size="sm" variant="outline" className="mt-2" onClick={async () => { for (const f of await files()) downloadBlob(f.blob, f.filename); await markSubmitted(); toast.success("Bid sheet downloaded and bid marked submitted"); }}><FileDown className="mr-1 h-4 w-4" />Download sheet & mark submitted</Button>
          </div>
          )}
          <div className="space-y-2 border-t pt-3">
            <div className="text-xs font-semibold uppercase text-muted-foreground">Email the bid (from your Gmail, sheet attached)</div>
            <Input placeholder="To" value={to} onChange={(e) => setTo(e.target.value)} />
            <Input placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
            <Textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
            <Button disabled={sending} onClick={send}><Send className="mr-1 h-4 w-4" />{sending ? "Sending…" : "Email bid"}</Button>
          </div>
          <div className="border-t pt-3">
            <Button variant="outline" size="sm" onClick={() => void onQuotes()}>Also save priced lanes as quotes</Button>
            <span className="ml-2 text-xs text-muted-foreground">Each lane gets a quote with its own accept link on the Quotes page.</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
