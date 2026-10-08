import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Upload } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { DocLink, type DocItem } from "@/components/DocPreview";

const label = (n: string) => {
  const k = n.split("-")[0]!.toLowerCase();
  return ({ pod: "POD", bol: "BOL", ratecon: "Rate con", invoice: "Invoice", carrier_invoice: "Carrier invoice" } as Record<string, string>)[k] ?? "File";
};

/** Every file stored for a load (driver POD/BOL, signed rate con, invoices, uploads) with in-page preview. */
export function LoadDocs({ loadId }: { loadId: string }) {
  const qc = useQueryClient();
  const key = ["load-docs", loadId];
  const [busy, setBusy] = useState(false);
  const { data: files = [] } = useQuery({
    queryKey: key,
    queryFn: async () => (await supabase.storage.from("load-docs").list(loadId, { sortBy: { column: "created_at", order: "desc" } })).data ?? [],
  });
  const items: DocItem[] = files.filter((f) => f.id).map((f) => ({ name: f.name, bucket: "load-docs", path: `${loadId}/${f.name}` }));
  const upload = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    const { error } = await supabase.storage.from("load-docs").upload(`${loadId}/file-${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`, file);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("File attached to load");
    qc.invalidateQueries({ queryKey: key });
  };
  return (
    <div className="space-y-2">
      <ul className="divide-y text-sm">
        {items.map((d, i) => (
          <li key={d.path} className="flex items-center gap-2 py-1.5">
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <b className="text-xs uppercase text-gold">{label(d.name)}</b>
            <DocLink items={items} index={i} className="truncate">{d.name}</DocLink>
          </li>
        ))}
        {!items.length && <li className="py-2 text-xs text-muted-foreground">No documents yet. Driver POD/BOL uploads and signed rate cons appear here.</li>}
      </ul>
      <Button size="sm" variant="secondary" disabled={busy} asChild>
        <label className="cursor-pointer"><Upload className="mr-1 h-3.5 w-3.5" />{busy ? "Uploading…" : "Attach file"}
          <input type="file" className="hidden" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
      </Button>
    </div>
  );
}
