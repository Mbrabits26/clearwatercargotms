import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, FileDown, FileUp, Globe, MapPin, Send, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getMarketRates } from "@/lib/market.functions";
import { drivingMiles } from "@/lib/places.functions";
import { companiesQuery, laneHistoryQuery } from "@/lib/queries";
import { usd } from "@/lib/tms";
import { accList, estimateCarrierCost, guessMapping, laneTotals, OUT_FIELDS, type BidKind, type OutField } from "@/lib/bidDesk";
import { bidLanesQuery, bidQuery, bidSheetBlob, downloadBlob, historyFor, laneLabel, laneToLoad, laneToQuote, myName, noticeLowLanes, placeText, priceOne, refreshBidStatus, type Bid, type BidLane } from "@/lib/bids";
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

  const fillMiles = async (only?: BidLane[]) => {
    const todo = (only ?? lanes).filter((l) => !(Number(l.miles) > 0));
    if (!todo.length) return toast.info("Every lane already has miles.");
    setBusy(`Miles 0/${todo.length}`);
    let done = 0, miss = 0, i = 0;
    const worker = async () => {
      while (i < todo.length) {
        const l = todo[i++]!;
        try {
          const r = await miles$({ data: { origin: placeText(l.origin_city, l.origin_state, l.origin_zip) || l.origin_state, dest: placeText(l.dest_city, l.dest_state, l.dest_zip) || l.dest_state } });
          if (r.miles) await supabase.from("bid_lanes").update({ miles: r.miles }).eq("id", l.id); else miss++;
        } catch { miss++; }
        setBusy(`Miles ${++done}/${todo.length}`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, todo.length) }, worker));
    setBusy("");
    refresh();
    if (miss) toast.error(`${miss} lanes need miles typed in`); else toast.success("Miles added");
  };

  const fillMarket = async (only?: BidLane[], force = false) => {
    const todo = (only ?? lanes).filter((l) => force || (l.market_spot_rpm == null && l.market_contract_rpm == null));
    const keys = [...new Set(todo.map((l) => `${l.equipment}|${l.origin_state}|${l.dest_state}`))];
    if (!keys.length) return toast.info("Market rates are already filled in. Tick lanes and use “Refresh market rates” to check again.");
    let done = 0;
    setBusy(`Market 0/${keys.length}`);
    for (const k of keys) {
      const [equipment, os, ds] = k.split("|") as [string, string, string];
      try {
        const r = await market$({ data: { origin_state: os, dest_state: ds, equipment, refresh: force } });
        if (r.error) { toast.error(r.error); break; }
        if (r.result) {
          const ids = todo.filter((l) => l.equipment === equipment && l.origin_state === os && l.dest_state === ds).map((l) => l.id);
          await supabase.from("bid_lanes").update({ market_spot_rpm: r.result.spot_rpm, market_contract_rpm: r.result.contract_rpm, market_note: `${r.result.scope}${r.fetched_at ? ` · ${new Date(r.fetched_at).toLocaleDateString()}` : ""}` }).in("id", ids);
        }
      } catch (e) { toast.error((e as Error).message); break; }
      setBusy(`Market ${++done}/${keys.length}`);
      qc.invalidateQueries({ queryKey: ["bid-lanes", bidId] });
    }
    setBusy("");
  };

  const priceAll = async (overwrite: boolean, only?: BidLane[], margin = Number(bid.target_margin)) => {
    const todo = only ?? lanes;
    if (overwrite && !(await ask({ title: `Re-price ${todo.length} lanes at ${margin}%?`, points: ["Carrier cost and linehaul are recalculated from our lane history, else the market rate.", "Rates you typed by hand on these lanes are replaced."], confirmLabel: "Re-price" }))) return;
    setBusy("Pricing…");
    const errs: string[] = [];
    for (const l of todo) { const e = await priceOne(l, bid, loads, margin, overwrite); if (e) errs.push(e); }
    setBusy("");
    refresh();
    if (errs.length) toast.error(`${errs.length} lanes couldn't be priced`, { description: errs.slice(0, 4).join("\n") });
    else toast.success("Lanes priced");
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
    { value: "market", label: "Refresh market rates", hint: "Checks public market rates again for the checked lanes (uses the AI web search).", all: (items) => void fillMarket(items, true) },
    { value: "miles", label: "Look up missing miles", hint: "Looks up driving miles for checked lanes that have none.", all: (items) => void fillMiles(items) },
    { value: "quote", label: "Save as quotes", hint: "Creates a quote for each checked, priced lane (all-in rate; the linehaul/FSC breakdown goes in the notes). Lanes that already have a quote are skipped.",
      points: (it) => [`${it.filter((l) => !l.quote_id).length} quotes will be created on the Quotes page.`, "Any lane below 8% margin posts one Team chat notice."],
      each: async (l) => laneToQuote(l, bid) },
    { value: "load", label: "Create loads (won lanes)", hint: "Puts a new load on the Dispatch board for each checked lane and marks it won. Lanes that already made a load are skipped.",
      points: (it) => [`${it.filter((l) => !l.load_id).length} new loads will be created on the Dispatch board.`, "Customer rate = the lane's all-in; carrier pay = its carrier cost."],
      each: async (l) => { const e = await laneToLoad(l, bid); await after(); return e; } },
    exportAction<BidLane>(`${bid.bid_number} lanes`, ["Lane", "Equipment", "Miles", "Volume", "Carrier cost", "Linehaul", "FSC $/mi", "FSC", "Accessorials", "All-in", "$/mi", "Margin %", "Status"],
      (l) => { const t = laneTotals(l, fsc); return [laneLabel(l), l.equipment, l.miles, l.volume, t.carrier, t.linehaul, t.fscRpm.toFixed(2), t.fsc, t.acc, t.allIn, t.allInRpm?.toFixed(2), t.health === "none" ? "" : t.pct.toFixed(1), l.status]; }),
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
        <label className="text-xs text-muted-foreground sm:col-span-2">Notes<Input defaultValue={bid.notes ?? ""} onBlur={(e) => e.target.value !== (bid.notes ?? "") && saveBid({ notes: e.target.value || null })} /></label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setImportOpen(true)}><FileUp className="mr-1 h-4 w-4" />Add lanes</Button>
        <Hint text="Looks up driving miles for lanes that don't have them."><Button size="sm" variant="outline" disabled={!!busy || !lanes.length} onClick={() => fillMiles()}><MapPin className="mr-1 h-4 w-4" />Fill miles</Button></Hint>
        <Hint text="Checks public freight-market rate pages (AI web search) once per equipment + state pair. Results are saved for 24 hours."><Button size="sm" variant="outline" disabled={!!busy || !lanes.length} onClick={() => fillMarket()}><Globe className="mr-1 h-4 w-4" />Get market rates</Button></Hint>
        <Hint text={`Fills carrier cost and linehaul at ${bid.target_margin}% on lanes that aren't priced yet. Uses our own lane history first, then the ${bid.kind} market rate.`}><Button size="sm" variant="outline" disabled={!!busy || !lanes.length} onClick={() => priceAll(false)}><Sparkles className="mr-1 h-4 w-4" />Price open lanes</Button></Hint>
        <Hint text="Downloads the shipper's sheet with our linehaul, FSC and all-in filled in. Nothing changes."><Button size="sm" variant="outline" disabled={!lanes.length} onClick={() => { const f = bidSheetBlob(bid, lanes, guessMapping((bid.source_headers as string[]) ?? [])); downloadBlob(f.blob, f.filename); }}><FileDown className="mr-1 h-4 w-4" />Download bid sheet</Button></Hint>
        <Hint text="Saves each priced lane as a quote on the Quotes page."><Button size="sm" variant="outline" disabled={!!busy || !priced.length} onClick={runQuotes}>Save as quotes</Button></Hint>
        <Button size="sm" disabled={!priced.length} onClick={() => setSubmitOpen(true)}><Send className="mr-1 h-4 w-4" />Submit bid</Button>
        {busy && <span className="text-xs text-gold">{busy}</span>}
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
        <Stat label="Lanes" value={`${lanes.length} (${priced.length} priced)`} />
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
          <table className="w-full min-w-[1180px] text-sm">
            <thead className="bg-muted/40 text-left text-[11px] uppercase text-muted-foreground">
              <tr>
                <th className="w-8 p-2"><SelectAllBox ids={lanes.map((l) => l.id)} sel={sel} /></th>
                <th className="p-2">Lane</th><th className="p-2">Miles</th>{kind === "contract" && <th className="p-2">Loads/wk</th>}
                <th className="p-2 text-right">History $/mi</th><th className="p-2 text-right">Market $/mi</th>
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
                return (
                  <tr key={l.id} className={cn("border-t align-top", sel.has(l.id) && "bg-gold/5")}>
                    <td className="p-2"><Checkbox checked={sel.has(l.id)} onCheckedChange={(v) => sel.toggle(l.id, v === true)} aria-label="Select lane" /></td>
                    <td className="p-2">
                      <div className="font-medium">{laneLabel(l)}</div>
                      <div className="text-xs text-muted-foreground">{l.equipment}{l.volume ? ` · vol ${l.volume}` : ""}{l.pickup_date ? ` · PU ${l.pickup_date}` : ""}{l.quote_id ? " · quoted" : ""}{l.load_id ? " · load made" : ""}</div>
                    </td>
                    <td className="p-2"><Cell value={l.miles} onSave={(v) => patchLane(l.id, { miles: v })} w="w-16" /></td>
                    {kind === "contract" && <td className="p-2"><Cell value={l.loads_per_week} onSave={(v) => patchLane(l.id, { loads_per_week: v })} w="w-14" step="0.1" /></td>}
                    <td className="p-2 text-right text-xs">{h ? <span title={`${h.n} of our loads`}>{rpm(h.revRpm)} / {rpm(h.costRpm)}<div className="text-muted-foreground">sell / buy · {h.n}</div></span> : "—"}</td>
                    <td className="p-2 text-right text-xs" title={l.market_note ?? ""}>{l.market_spot_rpm || l.market_contract_rpm ? <>{rpm(l.market_spot_rpm)} / {rpm(l.market_contract_rpm)}<div className="text-muted-foreground">spot / contract</div></> : "—"}</td>
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
      <p className="text-xs text-muted-foreground">All-in = linehaul + fuel surcharge (per mile × miles) + accessorials. Carrier cost is what we expect to pay the carrier all-in; blank cells show our estimate in grey. History comes from all brokers' loads on the same states (Foust Farms loads left out). Market numbers are public estimates, not paid DAT data.</p>

      {importOpen && <BidImport bid={bid} startPos={lanes.length} open={importOpen} onOpenChange={setImportOpen} />}
      {submitOpen && <SubmitBid bid={bid} lanes={lanes} onClose={() => setSubmitOpen(false)} onQuotes={runQuotes} />}
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
  const priced = lanes.filter((l) => laneTotals(l, Number(bid.fsc_per_mile)).linehaul > 0);
  const fscNote = Number(bid.fsc_per_mile) ? ` Fuel surcharge is figured at $${Number(bid.fsc_per_mile).toFixed(2)} per mile and shown separately.` : "";
  const [to, setTo] = useState(bid.customer_email ?? "");
  const [subject, setSubject] = useState(`Clearwater Cargo ${bid.kind} bid ${bid.bid_number}${bid.customer_name ? ` — ${bid.customer_name}` : ""}`);
  const [body, setBody] = useState(`Hello,\n\nThank you for the opportunity to bid. Attached are Clearwater Cargo's ${bid.kind} rates for ${priced.length} lane${priced.length === 1 ? "" : "s"}, filled into your sheet with linehaul, fuel surcharge and all-in rates.${fscNote}\n\n${bid.kind === "contract" ? "Rates are valid for the term of the award, subject to the volume shown." : "Rates are valid for 24 hours, subject to capacity."}\n\nPlease let us know if you have any questions.\n\nClearwater Cargo LLC · Staley, NC · 252-497-7916`);
  const [sending, setSending] = useState(false);
  const markSubmitted = async () => {
    if (bid.status === "draft") await supabase.from("bids").update({ status: "submitted", submitted_at: new Date().toISOString() }).eq("id", bid.id);
    else if (!bid.submitted_at) await supabase.from("bids").update({ submitted_at: new Date().toISOString() }).eq("id", bid.id);
    qc.invalidateQueries({ queryKey: ["bids"] });
  };
  const file = () => bidSheetBlob(bid, priced, outMap);
  const send = async () => {
    if (!to.trim()) return toast.error("Add the customer's email.");
    setSending(true);
    const sent = await composeEmailWithFiles(to.trim(), subject, body, [file()]);
    setSending(false);
    toast.success(sent ? "Bid emailed from your Gmail" : "Draft opened — attach the downloaded bid sheet");
    await markSubmitted();
    onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-auto">
        <DialogHeader><DialogTitle>Submit {bid.bid_number} · {priced.length} priced lanes</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
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
            <Button size="sm" variant="outline" className="mt-2" onClick={async () => { const f = file(); downloadBlob(f.blob, f.filename); await markSubmitted(); toast.success("Bid sheet downloaded and bid marked submitted"); }}><FileDown className="mr-1 h-4 w-4" />Download sheet & mark submitted</Button>
          </div>
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
