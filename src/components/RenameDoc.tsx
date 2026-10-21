import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { cleanDocName } from "@/lib/docNames";

/** Pencil button that turns a document name into an edit box. `onSave` gets the cleaned name. */
export function RenameDoc({ name, original, onSave }: { name: string; original: string; onSave: (name: string) => Promise<string | null | void> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const next = cleanDocName(value, original);
    if (!next) return toast.error("Enter a name for the document.");
    if (next === name) return setEditing(false);
    setBusy(true);
    const err = await onSave(next);
    setBusy(false);
    if (err) return toast.error(err);
    toast.success("Document renamed");
    setEditing(false);
  };
  if (!editing) {
    return (
      <button type="button" className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-gold" title="Rename document" aria-label={`Rename ${name}`}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setValue(name); setEditing(true); }}>
        <Pencil className="h-3.5 w-3.5" />
      </button>
    );
  }
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <Input autoFocus value={value} disabled={busy} className="h-7 min-w-0 flex-1 text-xs" aria-label="New document name"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } if (e.key === "Escape") setEditing(false); }} />
      <button type="button" disabled={busy} className="rounded p-0.5 text-success" aria-label="Save name" onClick={save}><Check className="h-4 w-4" /></button>
      <button type="button" disabled={busy} className="rounded p-0.5 text-muted-foreground" aria-label="Cancel rename" onClick={() => setEditing(false)}><X className="h-4 w-4" /></button>
    </span>
  );
}

/** Custom names for files stored on loads, keyed by storage path. */
export function useLoadDocNames(paths: string[]) {
  const qc = useQueryClient();
  const sorted = [...paths].sort();
  const { data: names = {} } = useQuery({
    queryKey: ["load-doc-names", ...sorted],
    enabled: sorted.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("load_doc_names").select("path, display_name").in("path", sorted);
      return Object.fromEntries((data ?? []).map((r) => [r.path, r.display_name])) as Record<string, string>;
    },
  });
  const rename = async (path: string, display_name: string) => {
    const { error } = await supabase.from("load_doc_names").upsert({ path, display_name, updated_at: new Date().toISOString() }, { onConflict: "path" });
    if (error) return error.message;
    qc.invalidateQueries({ queryKey: ["load-doc-names"] });
    return null;
  };
  return { nameOf: (path: string, fallback: string) => names[path] ?? fallback, rename };
}
