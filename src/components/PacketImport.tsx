import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileStack, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { extractCarrierPacket, type PacketData } from "@/lib/extract.functions";
import type { Carrier } from "@/lib/tms";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const toB64 = (buf: ArrayBuffer) => {
  let s = "";
  const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};

const FIELDS: { k: keyof Carrier & keyof PacketData; label: string }[] = [
  { k: "legal_name", label: "Legal name" }, { k: "dba", label: "DBA" }, { k: "mc_number", label: "MC #" }, { k: "dot_number", label: "DOT #" },
  { k: "address", label: "Address" }, { k: "city", label: "City" }, { k: "state", label: "State" }, { k: "zip", label: "ZIP" },
  { k: "phone", label: "Phone" }, { k: "email", label: "Email" }, { k: "contact_name", label: "Contact" }, { k: "equipment", label: "Equipment" },
  { k: "auto_liability", label: "Auto liability $" }, { k: "insurance_expires", label: "Auto liability expires" },
  { k: "cargo_insurance", label: "Cargo $" }, { k: "cargo_expires", label: "Cargo expires" },
  { k: "factoring_company", label: "Factoring company" }, { k: "factoring_remit", label: "Factoring remit-to" },
];
const FLAGS: { p: keyof PacketData; c: keyof Carrier; label: string }[] = [
  { p: "has_w9", c: "w9_received", label: "W-9" }, { p: "has_coi", c: "coi_received", label: "Certificate of insurance" },
  { p: "has_agreement_signed", c: "agreement_signed", label: "Signed broker-carrier agreement" },
  { p: "has_noa", c: "noa_received", label: "Factoring NOA" }, { p: "has_voided_check", c: "voided_check_received", label: "Voided check" },
];
const KIND_FOR: Record<string, string> = { has_w9: "w9", has_coi: "coi", has_agreement_signed: "agreement", has_noa: "noa", has_voided_check: "voided_check" };

/** Upload a full carrier packet, read it, and apply the details to the carrier after review. */
export function PacketImport({ c, onDone }: { c: Carrier; onDone: () => void }) {
  const qc = useQueryClient();
  const read = useServerFn(extractCarrierPacket);
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<PacketData | null>(null);
  const [path, setPath] = useState<{ path: string; name: string } | null>(null);
  const [pick, setPick] = useState<Record<string, boolean>>({});

  const upload = async (file?: File) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return toast.error("Files must be 10 MB or smaller.");
    setBusy(true);
    try {
      const p = `${c.id}/packet-${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
      const { error } = await supabase.storage.from("carrier-docs").upload(p, file);
      if (error) throw new Error(error.message);
      await supabase.from("carrier_documents").insert({ carrier_id: c.id, kind: "packet", file_path: p, file_name: file.name });
      qc.invalidateQueries({ queryKey: ["carrier_docs", c.id] });
      setPath({ path: p, name: file.name });
      const name = file.name.toLowerCase();
      const mime = file.type || (name.endsWith(".pdf") ? "application/pdf" : "image/jpeg");
      const { packet } = await read({ data: { fileName: file.name, mime, base64: toB64(await file.arrayBuffer()), text: null } });
      // Default: fill blanks; existing values only change if ticked.
      const init: Record<string, boolean> = {};
      for (const f of FIELDS) { const v = packet[f.k]; init[f.k] = v != null && v !== "" && (c[f.k] == null || c[f.k] === "" || c[f.k] === 0); }
      for (const f of FLAGS) init[f.p] = !!packet[f.p] && !c[f.c];
      setPick(init);
      setFound(packet);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't read the packet");
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!found) return;
    const patch: Record<string, unknown> = {};
    for (const f of FIELDS) if (pick[f.k]) {
      let v: unknown = found[f.k];
      if (f.k === "state" && typeof v === "string") v = v.toUpperCase().slice(0, 2);
      patch[f.k] = v;
    }
    for (const f of FLAGS) if (pick[f.p]) patch[f.c] = true;
    if (Object.keys(patch).length) {
      const { error } = await supabase.from("carriers").update(patch as Partial<Carrier>).eq("id", c.id);
      if (error) return toast.error(error.message);
    }
    // Save the packet as the source file for each checklist item it covers.
    if (path) {
      const rows = FLAGS.filter((f) => found[f.p]).map((f) => ({
        carrier_id: c.id, kind: KIND_FOR[f.p]!, file_path: path.path, file_name: `${path.name} (from packet)`,
        expires_on: f.p === "has_coi" ? (found.insurance_expires ?? null) : null,
      }));
      if (rows.length) await supabase.from("carrier_documents").insert(rows);
    }
    toast.success(`Packet applied · ${Object.keys(patch).length} field${Object.keys(patch).length === 1 ? "" : "s"} updated`);
    qc.invalidateQueries({ queryKey: ["carriers"] });
    qc.invalidateQueries({ queryKey: ["carrier_docs", c.id] });
    setFound(null);
    onDone();
  };

  const show = (v: unknown) => (v == null || v === "" ? <span className="text-muted-foreground">—</span> : String(v));

  return (
    <>
      <Button variant="outline" disabled={busy} asChild>
        <label className="cursor-pointer">
          {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileStack className="mr-1 h-4 w-4" />}
          {busy ? "Reading packet…" : "Upload full carrier packet"}
          <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp" disabled={busy} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
      </Button>
      <Dialog open={!!found} onOpenChange={(o) => !o && setFound(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-auto">
          <DialogHeader><DialogTitle className="font-display text-2xl uppercase">Review carrier packet</DialogTitle></DialogHeader>
          {found && (
            <div className="space-y-4 text-sm">
              <p className="text-xs text-muted-foreground">Ticked rows are applied. Empty fields are ticked for you; tick a filled field only to replace it.</p>
              <table className="w-full text-xs">
                <thead><tr className="text-left text-muted-foreground"><th className="w-8" /><th>Field</th><th>On file</th><th>From packet</th></tr></thead>
                <tbody>
                  {FIELDS.filter((f) => found[f.k] != null && found[f.k] !== "").map((f) => (
                    <tr key={f.k} className="border-t">
                      <td className="py-1.5"><input type="checkbox" checked={!!pick[f.k]} onChange={(e) => setPick((p) => ({ ...p, [f.k]: e.target.checked }))} /></td>
                      <td>{f.label}</td><td>{show(c[f.k])}</td><td className="text-gold">{show(found[f.k])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div>
                <div className="mb-1 text-xs uppercase text-muted-foreground">Documents found — mark received</div>
                <div className="flex flex-wrap gap-3">
                  {FLAGS.filter((f) => found[f.p]).map((f) => (
                    <label key={f.p} className="flex items-center gap-1 text-xs">
                      <input type="checkbox" checked={!!pick[f.p]} onChange={(e) => setPick((p) => ({ ...p, [f.p]: e.target.checked }))} />{f.label}
                    </label>
                  ))}
                  {!FLAGS.some((f) => found[f.p]) && <span className="text-xs text-muted-foreground">No standard documents recognized.</span>}
                </div>
              </div>
              {(found.insurer || found.tin_last4 || found.bank_name || found.signer_name) && (
                <div className="rounded bg-muted p-2 text-xs">
                  {found.insurer && <div>Insurer: {found.insurer}</div>}
                  {found.tin_last4 && <div>W-9 tax ID: •••••{found.tin_last4}</div>}
                  {found.bank_name && <div>Voided check bank: {found.bank_name}</div>}
                  {found.signer_name && <div>Agreement signed by: {found.signer_name}</div>}
                </div>
              )}
              <p className="text-xs text-muted-foreground">The carrier stays {c.status} — mark them vetted when you're satisfied.</p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setFound(null)}>Cancel</Button>
                <Button onClick={apply}>Apply to carrier</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
