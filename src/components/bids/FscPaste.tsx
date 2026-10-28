import { useMemo, useState } from "react";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fscRate } from "@/lib/bidDesk";
import { laneLabel, type Bid, type BidLane } from "@/lib/bids";
import {
  entryForLane, fscForPrice, fscFormula, linehaulKeepingAllIn, parseFscPaste, parseFuelPosting, REGION_NAMES,
  type FscRow, type FuelEntry, type FuelPosting,
} from "@/lib/fscPaste";
import { useConfirm } from "@/components/ActionGuard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const savedRows = (v: unknown): FscRow[] => (Array.isArray(v) ? (v as FscRow[]).filter((r) => r && Number(r.rpm) >= 0 && Number(r.min) > 0) : []);

/** Latest weekly fuel post (shared by every bid). */
export const latestFuelPostQuery = queryOptions({
  queryKey: ["fuel-postings", "latest"],
  queryFn: async () => {
    const { data, error } = await supabase.from("fuel_postings").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return data;
  },
});

const fmtWeek = (d: string | null | undefined) => (d ? new Date(`${d}T12:00`).toLocaleDateString() : null);

type Result = { rates?: (number | null)[]; rpm?: number; info: string; error?: string; groups?: { label: string; rpm: number; n: number }[]; skipped?: BidLane[] };

/** Paste current fuel surcharge (weekly post by region/option, one rate, one per lane, or the shipper's fuel table) and put it on the bid's lanes. */
export function FscPasteDialog({ bid, lanes, checked, onClose }: { bid: Bid; lanes: BidLane[]; checked: BidLane[]; onClose: () => void }) {
  const qc = useQueryClient();
  const ask = useConfirm();
  const { data: lastPost } = useQuery(latestFuelPostQuery);
  const saved = savedRows(bid.fsc_schedule);
  const [mode, setMode] = useState<"weekly" | "paste" | "formula">("weekly");
  const [text, setText] = useState("");
  const [postText, setPostText] = useState("");
  const [tableText, setTableText] = useState("");
  const [by, setBy] = useState<"region" | "equipment" | "one">("region");
  const [side, setSide] = useState<"pickup" | "delivery">("pickup");
  const [oneIdx, setOneIdx] = useState(0);
  const [convert, setConvert] = useState<"table" | "formula">(saved.length ? "table" : "formula");
  const [price, setPrice] = useState("");
  const [base, setBase] = useState("1.25");
  const [mpg, setMpg] = useState("6");
  const [target, setTarget] = useState<"all" | "checked">(checked.length ? "checked" : "all");
  const [keepAllIn, setKeepAllIn] = useState(false);
  const [note, setNote] = useState(bid.fsc_note ?? "");
  const [busy, setBusy] = useState(false);

  const todo = target === "checked" ? checked : lanes;
  const p = Number(price);

  // ---- weekly post ----
  const pastedPost = useMemo(() => (postText.trim() ? parseFuelPosting(postText) : null), [postText]);
  const savedPost: FuelPosting | null = lastPost ? { kind: lastPost.kind as "diesel" | "fsc", entries: (lastPost.entries as unknown as FuelEntry[]) ?? [], weekOf: lastPost.week_of } : null;
  const post: FuelPosting | null = pastedPost && !("error" in pastedPost) ? pastedPost : postText.trim() ? null : savedPost;
  const hasEquip = !!post?.entries.some((e) => e.equipment);
  const hasRegion = !!post?.entries.some((e) => e.region);
  const pastedTable = useMemo(() => (tableText.trim() ? parseFscPaste(tableText) : null), [tableText]);
  const tableRows = pastedTable?.kind === "schedule" ? pastedTable.rows : saved;

  const result = useMemo((): Result => {
    if (mode === "weekly") {
      if (pastedPost && "error" in pastedPost) return { info: "", error: pastedPost.error };
      if (!post || !post.entries.length) return { info: "", error: "Paste this week's fuel post." };
      const how = by === "equipment" && !hasEquip ? "one" : by === "region" && !hasRegion ? "one" : by;
      const toRpm = (v: number) => {
        if (post.kind === "fsc") return v;
        if (convert === "table" && tableRows.length) return fscForPrice(tableRows, v).rpm;
        return fscFormula(v, Number(base), Number(mpg));
      };
      if (post.kind === "diesel" && convert === "table" && !tableRows.length) return { info: "", error: "Paste the shipper's fuel table, or switch to the base price / MPG formula." };
      const rates: (number | null)[] = [];
      const groups = new Map<string, { label: string; rpm: number; n: number }>();
      const skipped: BidLane[] = [];
      for (const l of todo) {
        const e = how === "one" ? post.entries[Math.min(oneIdx, post.entries.length - 1)]! : entryForLane(post.entries, l, how, side);
        if (!e) { rates.push(null); skipped.push(l); continue; }
        const r = toRpm(e.value);
        rates.push(r);
        const k = `${e.label}|${r}`;
        groups.set(k, { label: post.kind === "diesel" ? `${e.label} $${e.value.toFixed(3)}/gal` : e.label, rpm: r, n: (groups.get(k)?.n ?? 0) + 1 });
      }
      if (!rates.some((r) => r != null)) return { info: "", error: how === "equipment" ? "None of these lanes' trailer types are in the post." : "No lane matched a posted region." };
      const uniform = how === "one" ? rates[0]! : null;
      return { rates, rpm: uniform ?? undefined, groups: [...groups.values()].sort((a, b) => b.n - a.n), skipped, info: "" };
    }
    if (mode === "formula") {
      if (!(p > 0)) return { info: "", error: "Type the current diesel price." };
      const r = fscFormula(p, Number(base), Number(mpg));
      return { rpm: r, info: `($${p.toFixed(3)} − $${Number(base).toFixed(2)}) ÷ ${mpg} MPG = $${r.toFixed(3)}/mi` };
    }
    const parsed = parseFscPaste(text);
    const rows = parsed.kind === "schedule" ? parsed.rows : parsed.kind === "empty" ? saved : [];
    if (parsed.kind === "error") return { info: "", error: parsed.message };
    if (parsed.kind === "single") return { rpm: parsed.rpm, info: `$${parsed.rpm.toFixed(3)}/mi on ${todo.length} lanes` };
    if (parsed.kind === "list") {
      if (parsed.rates.length !== todo.length) return { info: "", error: `You pasted ${parsed.rates.length} rates but ${todo.length} lanes are picked. Paste one rate per lane, in the same order as the table.` };
      return { rates: parsed.rates, info: `One rate per lane, top to bottom (${parsed.rates.length} lanes)` };
    }
    if (!rows.length) return { info: "", error: "Paste a rate or the fuel table first." };
    if (!(p > 0)) return { info: `Fuel table read: ${rows.length} rows. Type the current diesel price.`, error: "" };
    const f = fscForPrice(rows, p);
    return { rpm: f.rpm, info: `${f.note} → $${f.rpm.toFixed(3)}/mi` };
  }, [mode, pastedPost, post, by, side, hasEquip, hasRegion, convert, tableRows, base, mpg, todo, oneIdx, p, text, saved]);

  const pasteRows = mode === "paste" ? (() => { const x = parseFscPaste(text); return x.kind === "schedule" ? x.rows : x.kind === "empty" ? saved : []; })() : [];
  const canApply = !busy && todo.length > 0 && !result.error && (result.rpm != null || !!result.rates);

  const savePost = async (quiet = false) => {
    if (!pastedPost || "error" in pastedPost) return true;
    const { error } = await supabase.from("fuel_postings").insert({ week_of: pastedPost.weekOf, kind: pastedPost.kind, entries: pastedPost.entries as never, raw: postText });
    if (error) { toast.error(error.message); return false; }
    qc.invalidateQueries({ queryKey: ["fuel-postings"] });
    if (!quiet) { toast.success("This week's fuel post is saved for every bid"); setPostText(""); }
    return true;
  };

  const apply = async () => {
    const useDefault = target === "all" && result.rpm != null;
    const n = result.rates ? result.rates.filter((r) => r != null).length : todo.length;
    const sample = result.rpm != null ? `$${result.rpm.toFixed(3)}/mi` : "the matched";
    if (!(await ask({
      title: `Put ${sample} fuel surcharge on ${n} lanes?`,
      points: [
        keepAllIn ? "Each lane's all-in stays the same — the linehaul goes down (or up) by the fuel change." : "Linehaul stays as is, so each lane's all-in goes up (or down) by the fuel change.",
        useDefault ? "This also becomes the bid's default fuel surcharge; per-lane fuel overrides are cleared." : "Each lane gets its own fuel rate; the bid default stays.",
        ...(result.skipped?.length ? [`${result.skipped.length} lanes had no match and are left as they are.`] : []),
        "Counteroffers you typed aren't changed.",
      ],
      confirmLabel: "Apply fuel surcharge",
    }))) return;
    setBusy(true);
    if (mode === "weekly" && !(await savePost(true))) { setBusy(false); return; }
    const errs: string[] = [];
    const bidFsc = Number(bid.fsc_per_mile);
    const patches = todo.flatMap((l, i) => {
      const next = result.rates ? result.rates[i] : result.rpm!;
      if (next == null) return [];
      const patch: Partial<BidLane> = { fsc_per_mile: useDefault ? null : next };
      if (keepAllIn) patch.linehaul = linehaulKeepingAllIn(Number(l.linehaul) || 0, Number(l.miles) || 0, fscRate(l, bidFsc), next);
      return [{ l, patch }];
    });
    if (useDefault && !keepAllIn) {
      // Every lane just inherits the new bid default.
      const { error } = await supabase.from("bid_lanes").update({ fsc_per_mile: null }).eq("bid_id", bid.id);
      if (error) errs.push(error.message);
    } else {
      let i = 0;
      const worker = async () => {
        while (i < patches.length) {
          const { l, patch } = patches[i++]!;
          const { error } = await supabase.from("bid_lanes").update(patch as never).eq("id", l.id);
          if (error) errs.push(`${laneLabel(l)}: ${error.message}`);
        }
      };
      await Promise.all(Array.from({ length: Math.min(6, patches.length) }, worker));
    }
    const bidPatch: Partial<Bid> = { fsc_note: note.trim() || (mode === "weekly" && post ? defaultNote : null) };
    if (useDefault) bidPatch.fsc_per_mile = result.rpm!;
    if (mode === "paste") { const x = parseFscPaste(text); if (x.kind === "schedule") bidPatch.fsc_schedule = x.rows as never; }
    if (mode === "weekly" && pastedTable?.kind === "schedule") bidPatch.fsc_schedule = pastedTable.rows as never;
    const { error } = await supabase.from("bids").update(bidPatch as never).eq("id", bid.id);
    if (error) errs.push(error.message);
    setBusy(false);
    qc.invalidateQueries({ queryKey: ["bid-lanes"] });
    qc.invalidateQueries({ queryKey: ["bids"] });
    if (errs.length) toast.error(`${errs.length} lanes didn't update`, { description: errs.slice(0, 4).join("\n") });
    else { toast.success(`Fuel surcharge put on ${patches.length} lanes`); onClose(); }
  };

  const weekLabel = post?.weekOf ? `week of ${fmtWeek(post.weekOf)}` : lastPost && post === savedPost ? `posted ${new Date(lastPost.created_at).toLocaleDateString()}` : "";
  const defaultNote = mode === "weekly" && post
    ? `Fuel post ${weekLabel}${by === "region" && hasRegion ? ` · by ${side} region` : by === "equipment" && hasEquip ? " · by trailer type" : ""}${post.kind === "diesel" ? (convert === "table" && tableRows.length ? " · shipper fuel table" : ` · (diesel − $${base}) ÷ ${mpg} MPG`) : ""}`
    : `e.g. DOE $${price || "3.729"} week of ${new Date().toLocaleDateString()}`;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-auto">
        <DialogHeader><DialogTitle>Current fuel surcharge</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-1">
            {([["weekly", "Weekly fuel post"], ["paste", "Paste rates or fuel table"], ["formula", "Figure from diesel price"]] as const).map(([m, label]) => (
              <Button key={m} size="sm" variant={mode === m ? "default" : "outline"} onClick={() => setMode(m)}>{label}</Button>
            ))}
          </div>

          {mode === "weekly" && (
            <div className="space-y-2">
              {savedPost && !postText.trim() && (
                <div className="rounded border border-gold/40 p-2 text-xs">
                  <div className="text-gold">Using the last saved post{lastPost?.week_of ? ` — week of ${fmtWeek(lastPost.week_of)}` : ` — saved ${new Date(lastPost!.created_at).toLocaleDateString()}`} ({savedPost.entries.length} lines). Paste below to replace it with this week's.</div>
                </div>
              )}
              <Textarea rows={6} value={postText} onChange={(e) => setPostText(e.target.value)} className="font-mono text-xs"
                placeholder={"Paste this week's post as-is — split by region or by another option, e.g.\n            10/20/26  10/27/26\nU.S.          3.665     3.705\nLower Atlantic (PADD 1C)  3.640  3.701\nMidwest (PADD 2)          3.580  3.611\n…or $/mi by trailer: Dry Van 0.52 / Reefer 0.58 / Flatbed 0.61"} />
              {post && (
                <>
                  <div className="overflow-x-auto rounded border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/40 text-left text-[11px] uppercase text-muted-foreground"><tr><th className="p-1.5">Line read</th><th className="p-1.5">Matches</th><th className="p-1.5 text-right">{post.kind === "diesel" ? "Diesel $/gal" : "FSC $/mi"}</th>{post.kind === "diesel" && <th className="p-1.5 text-right">= FSC $/mi</th>}</tr></thead>
                      <tbody>
                        {post.entries.map((e, i) => {
                          const r = post.kind === "fsc" ? e.value : convert === "table" && tableRows.length ? fscForPrice(tableRows, e.value).rpm : fscFormula(e.value, Number(base), Number(mpg));
                          return (
                            <tr key={i} className="border-t">
                              <td className="p-1.5">{e.label}</td>
                              <td className="p-1.5 text-muted-foreground">{[e.region ? REGION_NAMES[e.region] : null, e.equipment].filter(Boolean).join(" · ") || "—"}</td>
                              <td className="p-1.5 text-right">${e.value.toFixed(3)}</td>
                              {post.kind === "diesel" && <td className="p-1.5 text-right text-gold">{convert === "table" && !tableRows.length ? "—" : `$${r.toFixed(3)}`}</td>}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {weekLabel && <div className="text-[11px] text-muted-foreground">Read as {post.kind === "diesel" ? "diesel prices" : "fuel surcharge $/mi"}, {weekLabel}.</div>}
                  <div className="text-xs text-muted-foreground">Match each lane
                    <div className="mt-1 flex flex-wrap gap-3">
                      <label className={cn("flex items-center gap-1.5 text-foreground", !hasRegion && "opacity-50")}><input type="radio" disabled={!hasRegion} checked={by === "region" && hasRegion} onChange={() => setBy("region")} />By region</label>
                      <label className={cn("flex items-center gap-1.5 text-foreground", !hasEquip && "opacity-50")}><input type="radio" disabled={!hasEquip} checked={by === "equipment" && hasEquip} onChange={() => setBy("equipment")} />By trailer type</label>
                      <label className="flex items-center gap-1.5 text-foreground"><input type="radio" checked={by === "one" || (by === "region" && !hasRegion) || (by === "equipment" && !hasEquip)} onChange={() => setBy("one")} />One line for all:
                        <select value={oneIdx} onChange={(e) => { setOneIdx(Number(e.target.value)); setBy("one"); }} className="h-7 rounded border bg-background px-1 text-xs">{post.entries.map((e, i) => <option key={i} value={i}>{e.label}</option>)}</select>
                      </label>
                    </div>
                    {by === "region" && hasRegion && (
                      <div className="mt-2 inline-flex rounded-md border p-0.5" role="group" aria-label="Region side">
                        {(["pickup", "delivery"] as const).map((s) => (
                          <button key={s} type="button" onClick={() => setSide(s)}
                            className={cn("rounded px-3 py-1 text-xs font-medium", side === s ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted")}>
                            {s === "pickup" ? "Pickup region" : "Delivery region"}
                          </button>
                        ))}
                      </div>
                    )}
                    {by === "region" && hasRegion && <p className="mt-1 text-[11px]">Uses the lane's {side} state ({side === "pickup" ? "delivery" : "pickup"} state if it's missing). If its region isn't posted, the broader region is used (e.g. East Coast), then the U.S. average.</p>}
                  </div>
                  {post.kind === "diesel" && (
                    <div className="rounded border p-2 text-xs text-muted-foreground">Turn diesel $/gal into $/mi with
                      <div className="mt-1 flex flex-wrap gap-3">
                        <label className="flex items-center gap-1.5 text-foreground"><input type="radio" checked={convert === "table"} onChange={() => setConvert("table")} />The shipper's fuel table{saved.length && !pastedTable ? ` (saved, ${saved.length} rows)` : ""}</label>
                        <label className="flex items-center gap-1.5 text-foreground"><input type="radio" checked={convert === "formula"} onChange={() => setConvert("formula")} />Base price & MPG</label>
                      </div>
                      {convert === "table" ? (
                        <Textarea rows={3} value={tableText} onChange={(e) => setTableText(e.target.value)} className="mt-1 font-mono text-xs" placeholder={saved.length ? "Using the fuel table saved on this bid — paste a new one to replace it" : "Paste the shipper's fuel table: diesel price range, then $/mi\n3.50 - 3.599   0.45\n3.60 - 3.699   0.47"} />
                      ) : (
                        <div className="mt-1 flex gap-2">
                          <label>Base $/gal<Input type="number" step="0.01" value={base} onChange={(e) => setBase(e.target.value)} className="h-8 w-24" /></label>
                          <label>Truck MPG<Input type="number" step="0.1" value={mpg} onChange={(e) => setMpg(e.target.value)} className="h-8 w-24" /></label>
                        </div>
                      )}
                      {pastedTable?.kind === "error" && <div className="mt-1 text-destructive">{pastedTable.message}</div>}
                    </div>
                  )}
                  {pastedPost && !("error" in pastedPost) && <Button size="sm" variant="outline" onClick={() => void savePost()}>Save this week's post for every bid</Button>}
                </>
              )}
            </div>
          )}

          {mode === "paste" && (
            <div className="space-y-2">
              <Textarea rows={7} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-xs"
                placeholder={"Paste any of these (copy straight from Excel, a PDF or an email):\n0.62                      ← one $/mi for every lane\n0.55 / 0.60 / 0.58 …      ← one per line, one per lane in table order\n3.50 - 3.599   0.45       ← the shipper's fuel table:\n3.60 - 3.699   0.47          diesel price range, then $/mi"} />
              {pasteRows.length > 0 && (
                <div className="rounded border p-2">
                  {!text.trim() && <div className="mb-1 text-xs text-muted-foreground">Using the fuel table saved on this bid ({saved.length} rows). Paste a new one to replace it.</div>}
                  <label className="text-xs text-muted-foreground">Current diesel price $/gal (DOE / EIA weekly average)
                    <Input type="number" step="0.001" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. 3.729" className="mt-0.5 w-40" />
                  </label>
                  <details className="mt-1 text-xs text-muted-foreground">
                    <summary className="cursor-pointer text-gold">See the table I read</summary>
                    <table className="mt-1 w-full text-xs">
                      <thead><tr><th className="text-left">Diesel from</th><th className="text-left">to</th><th className="text-right">FSC $/mi</th></tr></thead>
                      <tbody>{pasteRows.map((r, i) => <tr key={i} className={cn(p >= r.min && (r.max == null || p <= r.max + 0.0005) && "text-gold")}><td>${r.min.toFixed(3)}</td><td>{r.max != null ? `$${r.max.toFixed(3)}` : "and up"}</td><td className="text-right">${r.rpm.toFixed(3)}</td></tr>)}</tbody>
                    </table>
                  </details>
                </div>
              )}
            </div>
          )}

          {mode === "formula" && (
            <div className="grid grid-cols-3 gap-2">
              <label className="text-xs text-muted-foreground">Current diesel $/gal<Input type="number" step="0.001" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. 3.729" /></label>
              <label className="text-xs text-muted-foreground">Base price $/gal<Input type="number" step="0.01" value={base} onChange={(e) => setBase(e.target.value)} /></label>
              <label className="text-xs text-muted-foreground">Truck MPG<Input type="number" step="0.1" value={mpg} onChange={(e) => setMpg(e.target.value)} /></label>
              <p className="col-span-3 text-xs text-muted-foreground">Use the base price and MPG from the shipper's fuel program if they give one.</p>
            </div>
          )}

          {(result.info || result.error) && <div className={cn("rounded border px-2 py-1.5 text-xs", result.error ? "border-destructive/50 text-destructive" : "border-gold/50 text-gold")}>{result.error || result.info}</div>}
          {!result.error && result.groups && (
            <div className="rounded border border-gold/50 px-2 py-1.5 text-xs">
              {result.groups.map((g) => <div key={`${g.label}${g.rpm}`} className="flex justify-between gap-2"><span>{g.label}</span><span className="text-gold">${g.rpm.toFixed(3)}/mi · {g.n} lane{g.n === 1 ? "" : "s"}</span></div>)}
              {result.skipped && result.skipped.length > 0 && <div className="mt-1 text-muted-foreground">{result.skipped.length} lanes have no match and stay as they are (e.g. {result.skipped.slice(0, 2).map(laneLabel).join("; ")}).</div>}
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="text-xs text-muted-foreground">Put it on
              <div className="mt-1 flex flex-col gap-1">
                <label className="flex items-center gap-1.5 text-foreground"><input type="radio" checked={target === "all"} onChange={() => setTarget("all")} />All {lanes.length} lanes</label>
                <label className={cn("flex items-center gap-1.5 text-foreground", !checked.length && "opacity-50")}><input type="radio" disabled={!checked.length} checked={target === "checked"} onChange={() => setTarget("checked")} />Checked lanes only ({checked.length})</label>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">Linehaul
              <div className="mt-1 flex flex-col gap-1">
                <label className="flex items-center gap-1.5 text-foreground"><input type="radio" checked={!keepAllIn} onChange={() => setKeepAllIn(false)} />Keep linehaul — fuel adds on top</label>
                <label className="flex items-center gap-1.5 text-foreground"><input type="radio" checked={keepAllIn} onChange={() => setKeepAllIn(true)} />Keep all-in the same — linehaul adjusts</label>
              </div>
            </div>
          </div>
          <label className="block text-xs text-muted-foreground">Note (shows on the bid)
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={defaultNote} onFocus={() => !note && mode === "weekly" && post && setNote(defaultNote)} />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" disabled={!canApply} onClick={() => void apply()}>{busy ? "Applying…" : `Apply to ${result.rates ? result.rates.filter((r) => r != null).length : todo.length} lanes`}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
