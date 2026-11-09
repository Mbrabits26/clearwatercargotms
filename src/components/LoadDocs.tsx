import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Upload } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { DocLink, type DocItem } from "@/components/DocPreview";
import { RenameDoc, useLoadDocNames } from "@/components/RenameDoc";
import { QbFilesPanel } from "@/components/QbFilesPanel";
import { DocTypePicker, LOAD_DOC_TYPES, loadDocPath, retypedName, typeFromName, type LoadDocType } from "@/components/DocTypePicker";
import { markPodReceived, marksPod } from "@/lib/podMark";
import { useRouteContext } from "@tanstack/react-router";
import { CarrierInvoiceDialog, type BillTarget } from "@/components/CarrierInvoiceDialog";
import { effectivePayTerms, loadTotals, type Load } from "@/lib/tms";

const label = (n: string) => {
  const k = n.split("-")[0]!.toLowerCase();
  return ({ pod: "POD", bol: "BOL", ratecon: "Rate con", invoice: "Invoice", carrier_invoice: "Carrier invoice", lumper: "Lumper receipt", scale: "Scale ticket", other: "Other" } as Record<string, string>)[k] ?? "File";
};

/** Every file stored for a load (driver POD/BOL, signed rate con, invoices, uploads) with in-page preview. */
export function LoadDocs({ loadId }: { loadId: string }) {
  const { isFinance } = useRouteContext({ from: "/_authenticated" });
  const [invoiceTarget, setInvoiceTarget] = useState<BillTarget | null>(null);
  const [invoiceKind, setInvoiceKind] = useState<"regular" | "factoring">("regular");
  const [invoiceFile, setInvoiceFile] = useState<File | undefined>();
  const qc = useQueryClient();
  const key = ["load-docs", loadId];
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<File | null>(null);
  const { data: files = [] } = useQuery({
    queryKey: key,
    queryFn: async () => (await supabase.storage.from("load-docs").list(loadId, { sortBy: { column: "created_at", order: "desc" } })).data ?? [],
  });
  const stored = files.filter((f) => f.id && !/^invoice-/i.test(f.name));
  const { nameOf, rename } = useLoadDocNames(stored.map((f) => `${loadId}/${f.name}`));
  const items: (DocItem & { path: string; file: string })[] = stored
    .map((f) => ({ file: f.name, name: nameOf(`${loadId}/${f.name}`, f.name), bucket: "load-docs", path: `${loadId}/${f.name}`, readOnly: /^carrier_invoice-/i.test(f.name) }));
  const upload = async (type: LoadDocType, custom?: string) => {
    if (!pending) return;
    if ((type === "carrier_invoice" || type === "factoring_invoice") && isFinance) {
      setBusy(true);
      try {
        const { data: load, error } = await supabase.from("loads").select("*").eq("id", loadId).single();
        if (error || !load) throw new Error(error?.message ?? "Load unavailable");
        if (!load.carrier_id) throw new Error("Assign a carrier to this load first.");
        const { data: carrier, error: carrierError } = await supabase.from("carriers").select("*").eq("id", load.carrier_id).single();
        if (carrierError || !carrier) throw new Error(carrierError?.message ?? "Carrier unavailable");
        const { data: bill, error: billError } = await supabase.from("qb_sync").select("*").eq("load_id", loadId).eq("kind", "bill").order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (billError) throw billError;
        const gross = loadTotals(load as Load).cost;
        const fee = gross * effectivePayTerms(load, carrier).fee;
        setInvoiceFile(pending); setInvoiceKind(type === "factoring_invoice" ? "factoring" : "regular");
        setInvoiceTarget({ load, bill: bill ?? undefined, gross, fee, net: gross - fee, payee: carrier.factoring_company ?? carrier.legal_name });
      } catch (e) { toast.error((e as Error).message); }
      setBusy(false); return;
    }
    setBusy(true);
    const path = loadDocPath(loadId, type, pending);
    const { error } = await supabase.storage.from("load-docs").upload(path, pending);
    if (error) { setBusy(false); return toast.error(error.message); }
    const nameError = await rename(path, retypedName(type, pending.name, custom));
    if (nameError) toast.error(`File saved; name not saved: ${nameError}`);
    const podErr = marksPod(type) ? await markPodReceived(loadId, qc) : null;
    setBusy(false);
    setPending(null);
    if (podErr) toast.error(`File saved, but the load couldn't be marked "Signed POD received": ${podErr}`);
    else toast.success(marksPod(type) ? "Signed POD attached — load marked POD received" : "File attached to load");
    qc.invalidateQueries({ queryKey: key });
  };
  // Re-label a file already on the load (e.g. mark it as the Signed POD). The stored file never moves.
  const retype = async (path: string, name: string, type: LoadDocType) => {
    setBusy(true);
    const err = await rename(path, retypedName(type, name));
    const podErr = !err && marksPod(type) ? await markPodReceived(loadId, qc) : null;
    setBusy(false);
    if (err || podErr) return toast.error(err ?? `Renamed, but the load couldn't be marked "Signed POD received": ${podErr}`);
    toast.success(marksPod(type) ? "Marked as Signed POD — load marked POD received" : "Document type updated");
  };
  return (
    <div className="space-y-2">
      <ul className="divide-y text-sm">
        {items.map((d, i) => {
          const picked = typeFromName(d.name);
          const shown = picked ? LOAD_DOC_TYPES.find((t) => t.value === picked)?.label : d.name.includes(" – ") ? d.name.split(" – ")[0] : label(d.file);
          return (
            <li key={d.path} className="flex items-center gap-2 py-1.5">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <select aria-label={`Document type for ${d.name}`} title="Choose what this document is"
                className="h-7 shrink-0 rounded border border-border bg-background px-1 text-xs font-bold uppercase text-gold"
                value={picked ?? ""} disabled={busy} onChange={(e) => e.target.value && retype(d.path, d.name, e.target.value as LoadDocType)}>
                <option value="" disabled>{shown}</option>
                {LOAD_DOC_TYPES.filter((t) => !t.value.endsWith("invoice")).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <DocLink items={items} index={i} className="min-w-0 truncate">{d.name}</DocLink>
              <RenameDoc name={d.name} original={d.file} onSave={(n) => rename(d.path, n)} />
            </li>
          );
        })}
        {!items.length && <li className="py-2 text-xs text-muted-foreground">No documents yet. Driver POD/BOL uploads and signed rate cons appear here.</li>}
      </ul>
      <div className="flex items-center gap-2 rounded-md border border-dashed border-border p-2">
      <Button size="sm" variant="secondary" disabled={busy} asChild>
        <label className="cursor-pointer"><Upload className="mr-1 h-3.5 w-3.5" />{busy ? "Uploading…" : "Attach file"}
          <input type="file" className="hidden" onChange={(e) => { setPending(e.target.files?.[0] ?? null); e.target.value = ""; }} />
        </label>
      </Button>
      <span className="text-xs text-muted-foreground">or drag &amp; drop a file here — you'll pick the type next</span>
      </div>
      <DocTypePicker file={pending} busy={busy} onPick={upload} onCancel={() => setPending(null)} />
      <QbFilesPanel loadId={loadId} />
      <CarrierInvoiceDialog target={invoiceTarget} initialFile={invoiceFile} initialKind={invoiceKind} onClose={() => { setInvoiceTarget(null); setInvoiceFile(undefined); }} onSaved={() => { setInvoiceTarget(null); setInvoiceFile(undefined); setPending(null); qc.invalidateQueries({ queryKey: key }); }} />
    </div>
  );
}
