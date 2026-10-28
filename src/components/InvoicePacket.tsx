import { useEffect, useState } from "react";
import type { jsPDF } from "jspdf";
import { toast } from "sonner";
import { AlertTriangle, Download, Eye, Mail } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { ActionButton } from "@/components/ActionGuard";
import { useBlobViewer } from "@/components/DocPreview";
import { mergePacket, packetDefault, packetDocKind, packetHidden, packetSort, PACKET_KIND_LABEL, type PacketDocKind } from "@/lib/invoicePacket";
import type { Load } from "@/lib/tms";

export type PacketDoc = { path: string; name: string; kind: PacketDocKind; loadNumber: string };

/** Every load document that could go in a customer packet (carrier invoices left out). */
export async function listPacketDocs(loads: Load[]): Promise<PacketDoc[]> {
  const lists = await Promise.all(loads.map(async (l) => ({ l, files: (await supabase.storage.from("load-docs").list(l.id, { sortBy: { column: "created_at", order: "asc" } })).data ?? [] })));
  const paths = lists.flatMap(({ l, files }) => files.filter((f) => f.id).map((f) => `${l.id}/${f.name}`));
  const names = new Map<string, string>();
  for (let i = 0; i < paths.length; i += 150) {
    const { data } = await supabase.from("load_doc_names").select("path, display_name").in("path", paths.slice(i, i + 150));
    for (const r of data ?? []) names.set(r.path, r.display_name);
  }
  return lists.flatMap(({ l, files }) => packetSort(files.filter((f) => f.id).map((f) => {
    const path = `${l.id}/${f.name}`;
    const name = names.get(path) ?? f.name;
    return { path, name, kind: packetDocKind(f.name, names.get(path)), loadNumber: l.load_number };
  }).filter((d) => !packetHidden(d.kind))));
}

/** Invoice PDF + the picked documents merged into one PDF. */
export async function buildPacketBlob(invoice: jsPDF, docs: PacketDoc[]) {
  const files = await Promise.all(docs.map(async (d) => {
    const { data } = await supabase.storage.from("load-docs").download(d.path);
    return { name: d.name, bytes: data ? await data.arrayBuffer() : new ArrayBuffer(0) };
  }));
  const r = await mergePacket(invoice.output("arraybuffer"), files);
  return { blob: new Blob([r.bytes as BlobPart], { type: "application/pdf" }), pages: r.pages, skipped: r.skipped };
}

export const saveBlob = (blob: Blob, name: string) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
};

/** Pick which load documents ride with the invoice, then preview, download or email one combined PDF. */
export function InvoicePacketDialog({ invoiceNumber, loads, buildInvoice, onEmail, onClose }: {
  invoiceNumber: string | null; loads: Load[]; buildInvoice: () => Promise<jsPDF | null>;
  onEmail: (blob: Blob, fileName: string) => Promise<void>; onClose: () => void;
}) {
  const open = !!invoiceNumber;
  const [docs, setDocs] = useState<PacketDoc[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const viewer = useBlobViewer();
  const ids = loads.map((l) => l.id).join(",");
  useEffect(() => {
    if (!open) { setDocs(null); return; }
    let live = true;
    listPacketDocs(loads).then((d) => { if (!live) return; setDocs(d); setPicked(new Set(d.filter((x) => packetDefault(x.kind)).map((x) => x.path))); })
      .catch((e) => toast.error((e as Error).message));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ids]);
  const fileName = `${invoiceNumber}-packet.pdf`;
  const chosen = (docs ?? []).filter((d) => picked.has(d.path));
  const noPod = loads.filter((l) => !(docs ?? []).some((d) => d.kind === "pod" && d.loadNumber === l.load_number));
  const rcPicked = chosen.some((d) => d.kind === "ratecon");
  const make = async () => {
    setBusy(true);
    try {
      const inv = await buildInvoice();
      if (!inv) { toast.error("Couldn't build the invoice."); return null; }
      const r = await buildPacketBlob(inv, chosen);
      if (r.skipped.length) toast.warning(`Left out (not a PDF or JPG/PNG photo): ${r.skipped.join(", ")}`);
      return r;
    } catch (e) { toast.error((e as Error).message); return null; }
    finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>Invoice packet — {invoiceNumber}</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">One PDF: the invoice first, then the documents you tick. PODs and BOLs are ticked for you. Building a packet doesn't change the invoice, the load or QuickBooks.</p>
        {noPod.length > 0 && docs && <div className="flex items-start gap-2 rounded border border-warning/50 bg-warning/10 p-2 text-xs"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />No POD on {noPod.map((l) => l.load_number).join(", ")}. Most customers won't pay without one.</div>}
        <div className="max-h-80 overflow-y-auto rounded border">
          <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2 text-sm"><Checkbox checked disabled /><b>Invoice {invoiceNumber}</b><span className="text-xs text-muted-foreground">always first</span></div>
          {!docs ? <div className="p-3 text-xs text-muted-foreground">Loading documents…</div>
            : !docs.length ? <div className="p-3 text-xs text-muted-foreground">No documents on {loads.length > 1 ? "these loads" : "this load"} yet.</div>
            : docs.map((d) => (
              <label key={d.path} className="flex cursor-pointer items-center gap-2 border-b px-3 py-1.5 text-sm last:border-0">
                <Checkbox checked={picked.has(d.path)} onCheckedChange={(v) => setPicked((p) => { const n = new Set(p); if (v === true) n.add(d.path); else n.delete(d.path); return n; })} />
                <b className="w-28 shrink-0 text-xs uppercase text-gold">{PACKET_KIND_LABEL[d.kind]}</b>
                <span className="min-w-0 flex-1 truncate">{d.name}</span>
                {loads.length > 1 && <span className="text-xs text-muted-foreground">{d.loadNumber}</span>}
              </label>
            ))}
        </div>
        {rcPicked && <div className="flex items-start gap-2 rounded border border-destructive/50 bg-destructive/10 p-2 text-xs"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />The carrier rate con shows what we pay the carrier. Only include it if this customer requires it.</div>}
        <div className="flex flex-wrap justify-end gap-2">
          <ActionButton variant="outline" disabled={busy || !docs} hint="Opens the combined PDF here. Nothing is saved or sent." onClick={async () => { const r = await make(); if (r) viewer.show(r.blob, fileName); }}><Eye className="mr-1 h-4 w-4" />Preview</ActionButton>
          <ActionButton variant="outline" disabled={busy || !docs} hint="Downloads the combined PDF to this computer." onClick={async () => { const r = await make(); if (r) { saveBlob(r.blob, fileName); toast.success(`Packet downloaded — ${r.pages} pages`); } }}><Download className="mr-1 h-4 w-4" />Download</ActionButton>
          <ActionButton disabled={busy || !docs} hint="Downloads the packet and opens an email to the customer in your Gmail. Nothing is sent until you press Send there."
            onClick={async () => { const r = await make(); if (r) await onEmail(r.blob, fileName); }}><Mail className="mr-1 h-4 w-4" />{busy ? "Building…" : "Download & email"}</ActionButton>
        </div>
        {viewer.viewer}
      </DialogContent>
    </Dialog>
  );
}
