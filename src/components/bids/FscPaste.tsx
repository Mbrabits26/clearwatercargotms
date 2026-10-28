import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fscRate } from "@/lib/bidDesk";
import { laneLabel, type Bid, type BidLane } from "@/lib/bids";
import { fscForPrice, fscFormula, linehaulKeepingAllIn, parseFscPaste, type FscRow } from "@/lib/fscPaste";
import { useConfirm } from "@/components/ActionGuard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const savedRows = (v: unknown): FscRow[] => (Array.isArray(v) ? (v as FscRow[]).filter((r) => r && Number(r.rpm) >= 0 && Number(r.min) > 0) : []);

/** Paste current fuel surcharge rates (one rate, one per lane, or the shipper's fuel table) and put them on the bid's lanes. */
export function FscPasteDialog({ bid, lanes, checked, onClose }: { bid: Bid; lanes: BidLane[]; checked: BidLane[]; onClose: () => void }) {
  const qc = useQueryClient();
  const ask = useConfirm();
  const saved = savedRows(bid.fsc_schedule);
  const [mode, setMode] = useState<"paste" | "formula">("paste");
  const [text, setText] = useState("");
  const [price, setPrice] = useState("");
  const [base, setBase] = useState("1.25");
  const [mpg, setMpg] = useState("6");
  const [target, setTarget] = useState<"all" | "checked">(checked.length ? "checked" : "all");
  const [keepAllIn, setKeepAllIn] = useState(false);
  const [note, setNote] = useState(bid.fsc_note ?? "");
  const [busy, setBusy] = useState(false);

  const parsed = useMemo(() => parseFscPaste(text), [text]);
  // An empty box reuses the fuel table pasted last time, so only the diesel price needs updating.
  const rows = parsed.kind === "schedule" ? parsed.rows : parsed.kind === "empty" ? saved : [];
  const todo = target === "checked" ? checked : lanes;
  const p = Number(price);

  const result = useMemo((): { rpm?: number; list?: number[]; info: string; error?: string } => {
    if (mode === "formula") {
      if (!(p > 0)) return { info: "", error: "Type the current diesel price." };
      const r = fscFormula(p, Number(base), Number(mpg));
      return { rpm: r, info: `($${p.toFixed(3)} − $${Number(base).toFixed(2)}) ÷ ${mpg} MPG = $${r.toFixed(3)}/mi` };
    }
    if (parsed.kind === "error") return { info: "", error: parsed.message };
    if (parsed.kind === "single") return { rpm: parsed.rpm, info: `$${parsed.rpm.toFixed(3)}/mi on ${todo.length} lanes` };
    if (parsed.kind === "list") {
      if (parsed.rates.length !== todo.length) return { info: "", error: `You pasted ${parsed.rates.length} rates but ${todo.length} lanes are picked. Paste one rate per lane, in the same order as the table.` };
      return { list: parsed.rates, info: `One rate per lane, top to bottom (${parsed.rates.length} lanes)` };
    }
    if (!rows.length) return { info: "", error: "Paste a rate or the fuel table first." };
    if (!(p > 0)) return { info: `Fuel table read: ${rows.length} rows. Type the current diesel price.`, error: "" };
    const f = fscForPrice(rows, p);
    return { rpm: f.rpm, info: `${f.note} → $${f.rpm.toFixed(3)}/mi` };
  }, [mode, parsed, rows, p, base, mpg, todo.length]);

  const canApply = !busy && todo.length > 0 && !result.error && (result.rpm != null || !!result.list);

  const apply = async () => {
    const rateFor = (i: number) => (result.list ? result.list[i]! : result.rpm!);
    const sample = result.list ? `${result.list.length} lane rates` : `$${result.rpm!.toFixed(3)}/mi`;
    if (!(await ask({
      title: `Put ${sample} fuel surcharge on ${todo.length} lanes?`,
      points: [
        keepAllIn ? "Each lane's all-in stays the same — the linehaul goes down (or up) by the fuel change." : "Linehaul stays as is, so each lane's all-in goes up (or down) by the fuel change.",
        target === "all" && !result.list ? "This also becomes the bid's default fuel surcharge; per-lane fuel overrides are cleared." : "Only the lanes listed get the new fuel rate; the bid default stays.",
        "Counteroffers you typed aren't changed.",
      ],
      confirmLabel: "Apply fuel surcharge",
    }))) return;
    setBusy(true);
    const errs: string[] = [];
    const bidFsc = Number(bid.fsc_per_mile);
    const useDefault = target === "all" && !result.list;
    const patches = todo.map((l, i) => {
      const next = rateFor(i);
      const patch: Partial<BidLane> = { fsc_per_mile: useDefault ? null : next };
      if (keepAllIn) patch.linehaul = linehaulKeepingAllIn(Number(l.linehaul) || 0, Number(l.miles) || 0, fscRate(l, bidFsc), next);
      return { l, patch };
    });
    // Fast path: everything inherits the new bid default and linehaul doesn't move.
    if (useDefault && !keepAllIn) {
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
    const bidPatch: Partial<Bid> = { fsc_note: note.trim() || null };
    if (useDefault) bidPatch.fsc_per_mile = result.rpm!;
    if (mode === "paste" && parsed.kind === "schedule") bidPatch.fsc_schedule = parsed.rows as never;
    const { error } = await supabase.from("bids").update(bidPatch as never).eq("id", bid.id);
    if (error) errs.push(error.message);
    setBusy(false);
    qc.invalidateQueries({ queryKey: ["bid-lanes"] });
    qc.invalidateQueries({ queryKey: ["bids"] });
    if (errs.length) toast.error(`${errs.length} lanes didn't update`, { description: errs.slice(0, 4).join("\n") });
    else { toast.success(`Fuel surcharge put on ${todo.length} lanes`); onClose(); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-xl overflow-auto">
        <DialogHeader><DialogTitle>Paste current fuel surcharge</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="flex gap-1">
            {(["paste", "formula"] as const).map((m) => (
              <Button key={m} size="sm" variant={mode === m ? "default" : "outline"} onClick={() => setMode(m)}>{m === "paste" ? "Paste rates or fuel table" : "Figure from diesel price"}</Button>
            ))}
          </div>

          {mode === "paste" ? (
            <div className="space-y-2">
              <Textarea rows={7} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-xs"
                placeholder={"Paste any of these (copy straight from Excel, a PDF or an email):\n0.62                      ← one $/mi for every lane\n0.55 / 0.60 / 0.58 …      ← one per line, one per lane in table order\n3.50 - 3.599   0.45       ← the shipper's fuel table:\n3.60 - 3.699   0.47          diesel price range, then $/mi"} />
              {(parsed.kind === "schedule" || (parsed.kind === "empty" && saved.length > 0)) && (
                <div className="rounded border p-2">
                  {parsed.kind === "empty" && <div className="mb-1 text-xs text-muted-foreground">Using the fuel table saved on this bid ({saved.length} rows). Paste a new one to replace it.</div>}
                  <label className="text-xs text-muted-foreground">Current diesel price $/gal (DOE / EIA weekly average)
                    <Input type="number" step="0.001" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. 3.729" className="mt-0.5 w-40" />
                  </label>
                  <details className="mt-1 text-xs text-muted-foreground">
                    <summary className="cursor-pointer text-gold">See the table I read</summary>
                    <table className="mt-1 w-full text-xs">
                      <thead><tr><th className="text-left">Diesel from</th><th className="text-left">to</th><th className="text-right">FSC $/mi</th></tr></thead>
                      <tbody>{rows.map((r, i) => <tr key={i} className={cn(result.rpm === r.rpm && p >= r.min && (r.max == null || p <= r.max + 0.0005) && "text-gold")}><td>${r.min.toFixed(3)}</td><td>{r.max != null ? `$${r.max.toFixed(3)}` : "and up"}</td><td className="text-right">${r.rpm.toFixed(3)}</td></tr>)}</tbody>
                    </table>
                  </details>
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <label className="text-xs text-muted-foreground">Current diesel $/gal<Input type="number" step="0.001" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. 3.729" /></label>
              <label className="text-xs text-muted-foreground">Base price $/gal<Input type="number" step="0.01" value={base} onChange={(e) => setBase(e.target.value)} /></label>
              <label className="text-xs text-muted-foreground">Truck MPG<Input type="number" step="0.1" value={mpg} onChange={(e) => setMpg(e.target.value)} /></label>
              <p className="col-span-3 text-xs text-muted-foreground">Use the base price and MPG from the shipper's fuel program if they give one.</p>
            </div>
          )}

          {(result.info || result.error) && <div className={cn("rounded border px-2 py-1.5 text-xs", result.error ? "border-destructive/50 text-destructive" : "border-gold/50 text-gold")}>{result.error || result.info}</div>}

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
          <label className="block text-xs text-muted-foreground">Note (shows on the bid)<Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={`e.g. DOE $${price || "3.729"} week of ${new Date().toLocaleDateString()}`} /></label>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" disabled={!canApply} onClick={apply}>{busy ? "Applying…" : `Apply to ${todo.length} lanes`}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
