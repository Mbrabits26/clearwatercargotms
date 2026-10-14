import { useRef, useState } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

export type Change = { label: string; before: unknown; after: unknown };
const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

/** Collect only the fields that actually differ. */
export function diff(fields: { label: string; before: unknown; after: unknown }[]): Change[] {
  return fields.filter((f) => show(f.before) !== show(f.after));
}

/** "Review changes" step before saving: `const ok = await ask(changes)`. */
export function useReviewChanges() {
  const [changes, setChanges] = useState<Change[] | null>(null);
  const resolver = useRef<(ok: boolean) => void>(() => {});
  const ask = (c: Change[]) => new Promise<boolean>((res) => { resolver.current = res; setChanges(c); });
  const done = (ok: boolean) => { setChanges(null); resolver.current(ok); };
  const dialog = (
    <AlertDialog open={!!changes} onOpenChange={(o) => !o && done(false)}>
      <AlertDialogContent className="max-h-[85vh] overflow-auto">
        <AlertDialogHeader><AlertDialogTitle>Review changes</AlertDialogTitle></AlertDialogHeader>
        <div className="space-y-2 text-sm">
          {changes?.map((c) => (
            <div key={c.label} className="rounded border p-2">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">{c.label}</div>
              <div className="text-muted-foreground line-through">{show(c.before)}</div>
              <div className="font-medium text-gold">{show(c.after)}</div>
            </div>
          ))}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => done(false)}>Go back</AlertDialogCancel>
          <AlertDialogAction onClick={() => done(true)}>Confirm & save</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return { ask, dialog };
}
