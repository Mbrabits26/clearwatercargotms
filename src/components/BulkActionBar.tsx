import { useState, type ReactNode } from "react";
import { useRouteContext } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useConfirm, Hint } from "@/components/ActionGuard";
import { downloadReportCsv } from "@/lib/reportExport";

/** One choice in the "Action" dropdown. `param` adds a second dropdown (e.g. the new status). */
export type BulkAction<T> = {
  value: string;
  label: string;
  hint: string;
  adminOnly?: boolean;
  /** Deletes: shown in red and needs DELETE typed first. */
  danger?: boolean;
  param?: { label: string; options: { value: string; label: string }[] };
  /** Lines for the warning box. */
  points?: (items: T[], param: string) => ReactNode[];
  /** Return an error message for this row, or null when it worked. */
  each?: (item: T, param: string) => Promise<string | null>;
  /** Runs once for all rows instead (exports). */
  all?: (items: T[], param: string) => void;
};

/** Run `fn` on each row, six at a time, so database rules judge each row on its own. */
async function runEach<T>(items: T[], fn: (t: T) => Promise<string | null>, onTick: (n: number) => void) {
  const errors: string[] = [];
  let i = 0, done = 0;
  const worker = async () => {
    while (i < items.length) {
      const it = items[i++]!;
      const err = await fn(it).catch((e: Error) => e.message);
      if (err) errors.push(err);
      onTick(++done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, items.length) }, worker));
  return errors;
}

/** Check-box state for a list. */
export function useSelection() {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  return {
    picked,
    has: (id: string) => picked.has(id),
    toggle: (id: string, on: boolean) => setPicked((p) => { const n = new Set(p); if (on) n.add(id); else n.delete(id); return n; }),
    setAll: (ids: string[], on: boolean) => setPicked((p) => { const n = new Set(p); ids.forEach((id) => (on ? n.add(id) : n.delete(id))); return n; }),
    clear: () => setPicked(new Set()),
  };
}

/** "Select all" box for the rows currently shown. */
export function SelectAllBox({ ids, sel, label = "Select all shown" }: { ids: string[]; sel: ReturnType<typeof useSelection>; label?: string }) {
  const all = ids.length > 0 && ids.every((id) => sel.has(id));
  const some = !all && ids.some((id) => sel.has(id));
  return <Checkbox aria-label={label} checked={all ? true : some ? "indeterminate" : false} onCheckedChange={(v) => sel.setAll(ids, v === true)} onClick={(e) => e.stopPropagation()} />;
}

/** Shared delete action: admins only, each delete lands in the deletion log. */
export function deleteAction<T extends { id: string }>(table: "companies" | "carriers" | "drivers" | "fleet_units" | "quotes", name: (t: T) => string, what: string): BulkAction<T> {
  return {
    value: "delete", label: `Delete ${what}`, danger: true, adminOnly: true,
    hint: `Permanently deletes the checked ${what}. Each one is saved in the admin deletion log.`,
    points: (items) => [`${items.length} ${what} will be permanently deleted.`, "Loads and quotes that used them keep their details but lose the link.", "Each one is saved in the admin deletion log."],
    each: async (t) => {
      const { error, count } = await supabase.from(table).delete({ count: "exact" }).eq("id", t.id);
      return error ? `${name(t)}: ${error.message}` : !count ? `${name(t)}: not allowed to delete` : null;
    },
  };
}

/** Shared CSV export of the checked rows. */
export function exportAction<T>(title: string, head: string[], row: (t: T) => (string | number | null | undefined)[]): BulkAction<T> {
  return {
    value: "export", label: "Export checked to CSV", hint: "Downloads the checked rows as a spreadsheet. Nothing changes.",
    all: (items) => downloadReportCsv({ title, head, rows: items.map((t) => row(t).map((v) => (v == null ? "" : String(v)))) }),
  };
}

/** "N selected · Action [..] · Apply" bar shown once rows are checked. */
export function BulkActionBar<T>({ items, total, actions, onClear, invalidate, noun = "rows" }: {
  items: T[]; total: number; actions: BulkAction<T>[]; onClear: () => void; invalidate: string[]; noun?: string;
}) {
  const { isAdmin } = useRouteContext({ from: "/_authenticated" });
  const qc = useQueryClient();
  const ask = useConfirm();
  const [value, setValue] = useState("");
  const [param, setParam] = useState("");
  const [busy, setBusy] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [typing, setTyping] = useState<null | ((ok: boolean) => void)>(null);
  const [typed, setTyped] = useState("");
  if (!items.length) return null;
  const list = actions.filter((a) => !a.adminOnly || isAdmin);
  const a = list.find((x) => x.value === value);
  const needParam = !!a?.param && !param;

  const go = async () => {
    if (!a || needParam) return;
    if (a.all) { a.all(items, param); return; }
    const points = a.points?.(items, param) ?? [`${items.length} ${noun} will be updated.`];
    if (!(await ask({ title: `${a.label}${a.param ? `: ${a.param.options.find((o) => o.value === param)?.label}` : ""} — ${items.length} ${noun}?`, points: [...points, "Any that can't be changed are listed after."], confirmLabel: a.label, danger: a.danger }))) return;
    if (a.danger) {
      setTyped("");
      const ok = await new Promise<boolean>((res) => setTyping(() => res));
      setTyping(null);
      if (!ok) return;
    }
    setErrors([]);
    const errs = await runEach(items, (t) => a.each!(t, param), (n) => setBusy(`${n}/${items.length}`));
    setBusy("");
    invalidate.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    const ok = items.length - errs.length;
    if (ok) toast.success(`${a.label}: ${ok} ${noun} done`);
    if (errs.length) toast.error(`${errs.length} ${noun} could not be changed`);
    setErrors(errs);
    if (!errs.length) { onClear(); setValue(""); setParam(""); }
  };

  return (
    <div className="space-y-2 rounded-md border border-gold/50 bg-gold/5 p-2 text-sm print:hidden">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-gold">{items.length} of {total} selected</span>
        <Select value={value} onValueChange={(v) => { setValue(v); setParam(""); setErrors([]); }}>
          <SelectTrigger className="h-8 w-56" aria-label="Action"><SelectValue placeholder="Pick an action" /></SelectTrigger>
          <SelectContent>{list.map((x) => <SelectItem key={x.value} value={x.value} className={x.danger ? "text-destructive" : undefined}>{x.label}</SelectItem>)}</SelectContent>
        </Select>
        {a?.param && (
          <Select value={param} onValueChange={setParam}>
            <SelectTrigger className="h-8 w-48" aria-label={a.param.label}><SelectValue placeholder={a.param.label} /></SelectTrigger>
            <SelectContent>{a.param.options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
          </Select>
        )}
        <Hint text={a ? a.hint : "Pick an action first."}>
          <Button size="sm" variant={a?.danger ? "destructive" : "default"} disabled={!a || needParam || !!busy} onClick={go}>{busy ? `Working ${busy}…` : "Apply"}</Button>
        </Hint>
        <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => { onClear(); setErrors([]); }}>Clear selection</Button>
      </div>
      {!!errors.length && <div role="alert" className="max-h-40 overflow-auto rounded border border-destructive/40 p-2 text-xs text-destructive">{errors.map((e, k) => <p key={k}>{e}</p>)}</div>}
      <Dialog open={!!typing} onOpenChange={(o) => { if (!o) typing?.(false); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete {items.length} {noun}?</DialogTitle></DialogHeader>
          <label className="block text-sm">Type <b className="font-mono text-gold">DELETE</b> to confirm
            <Input className="mt-1" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => typing?.(false)}>Keep them</Button>
            <Button variant="destructive" disabled={typed.trim() !== "DELETE"} onClick={() => typing?.(true)}>Delete permanently</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
