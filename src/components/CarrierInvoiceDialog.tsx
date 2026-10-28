import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/ActionGuard";
import { auditBill, auditFlags, parseChargeLines, type ChargeLine } from "@/lib/billAudit";
import { readCarrierInvoice } from "@/lib/billAudit.functions";
import { loadTotals, usd, type Load } from "@/lib/tms";

export type SignedRc = { total: number; lines: { label: string; amount: number }[]; signedAt: string };

/** Latest signed, not voided rate con per load (what the carrier agreed to). */
export function useSignedRcs(loadIds: string[]) {
  const ids = [...new Set(loadIds)].sort();
  return useQuery({
    queryKey: ["signed-rcs", ...ids],
    enabled: ids.length > 0,
    queryFn: async () => {
      const out: Record<string, SignedRc> = {};
      for (let i = 0; i < ids.length; i += 150) {
        const { data, error } = await supabase.from("ratecon_requests").select("load_id, snapshot, signed_at")
          .in("load_id", ids.slice(i, i + 150)).not("signed_at", "is", null).is("voided_at", null).order("signed_at", { ascending: true });
        if (error) throw error;
        for (const r of data ?? []) {
          const s = r.snapshot as { total?: number; lines?: { label: string; amount: number }[] } | null;
          if (s && Number.isFinite(Number(s.total))) out[r.load_id] = { total: Number(s.total), lines: s.lines ?? [], signedAt: r.signed_at! };
        }
      }
      return out;
    },
  });
}

export type BillRow = { id: string; status: string; carrier_invoice_path: string | null; carrier_invoice_amount: number | null; carrier_invoice_number?: string | null; carrier_invoice_lines?: unknown };
export type BillTarget = { load: Load; bill?: BillRow; payee: string; net: number; gross: number; fee: number };

const toB64 = (buf: ArrayBuffer) => {
  let s = "";
  const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};

/** Attach the carrier's invoice, read its charges, and compare them to the signed rate con before AP posting. */
export function CarrierInvoiceDialog({ target, onClose, onSaved }: { target: BillTarget | null; onClose: () => void; onSaved: () => void }) {
  const read = useServerFn(readCarrierInvoice);
  const { data: rcs } = useSignedRcs(target ? [target.load.id] : []);
  const rc = target ? rcs?.[target.load.id] : undefined;
  const [file, setFile] = useState<File | null>(null);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [amount, setAmount] = useState("");
  const [num, setNum] = useState("");
  const [lines, setLines] = useState<ChargeLine[]>([]);
  useEffect(() => {
    if (!target) return;
    setFile(null);
    setAmount(target.bill?.carrier_invoice_amount != null ? String(target.bill.carrier_invoice_amount) : "");
    setNum(target.bill?.carrier_invoice_number ?? "");
    setLines(parseChargeLines(target.bill?.carrier_invoice_lines));
  }, [target]);
  const pick = async (f?: File) => {
    if (!f) return;
    setFile(f);
    const mime = f.type || (f.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "");
    if (!(mime === "application/pdf" || mime.startsWith("image/")) || f.size > 10_000_000) return toast.info("Couldn't read this file automatically — type the invoice amount.");
    setReading(true);
    try {
      const r = await read({ data: { fileName: f.name, mime, base64: toB64(await f.arrayBuffer()) } });
      if (r.total != null) setAmount(String(r.total));
      if (r.invoice_number) setNum(r.invoice_number);
      setLines(r.lines ?? []);
      toast.success("Read the carrier invoice — check the amount below.");
    } catch (e) { toast.error((e as Error).message); }
    setReading(false);
  };
  if (!target) return null;
  const billed = amount.trim() === "" ? null : Number(amount);
  const a = auditBill({ rcTotal: rc?.total ?? null, rcLines: rc?.lines, loadCost: loadTotals(target.load).cost, billed: Number.isFinite(billed) ? billed : null, billedLines: lines });
  const flags = auditFlags(a).filter((f) => !f.startsWith("No carrier invoice"));
  const save = async () => {
    if (!file && !target.bill?.carrier_invoice_path) return toast.info("Pick the carrier's invoice file.");
    setSaving(true);
    let path = target.bill?.carrier_invoice_path ?? null;
    if (file) {
      path = `${target.load.id}/carrier_invoice-${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
      const { error } = await supabase.storage.from("load-docs").upload(path, file);
      if (error) { setSaving(false); return toast.error(error.message); }
    }
    const fields = { carrier_invoice_path: path, carrier_invoice_amount: billed != null && Number.isFinite(billed) && billed > 0 ? billed : null, carrier_invoice_number: num.trim() || null, carrier_invoice_lines: lines };
    const { error } = target.bill
      ? await supabase.from("qb_sync").update(fields).eq("id", target.bill.id)
      : await supabase.from("qb_sync").insert({ load_id: target.load.id, kind: "bill", payee: target.payee, amount: target.net, gross_amount: target.gross, quickpay_fee: target.fee, status: "hold", ...fields });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(target.bill ? "Carrier invoice saved" : "Carrier invoice saved — bill is on hold until you send it to QuickBooks");
    onSaved();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Carrier invoice — {target.load.load_number}</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">{target.payee}. Upload their invoice; the TMS reads it and checks it against the signed rate con. Nothing goes to QuickBooks from here.</p>
        <Button variant="secondary" asChild disabled={reading}>
          <label className="cursor-pointer"><Upload className="mr-1 h-4 w-4" />{reading ? "Reading invoice…" : file ? file.name : target.bill?.carrier_invoice_path ? "Replace invoice file" : "Choose invoice file"}
            <input type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-muted-foreground">Carrier invoice #<Input className="mt-1" value={num} onChange={(e) => setNum(e.target.value)} /></label>
          <label className="text-xs text-muted-foreground">Invoice total ($)<Input className="mt-1" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        </div>
        <div className="grid grid-cols-2 gap-3 rounded border p-2 text-xs">
          <div><div className="mb-1 font-semibold uppercase text-muted-foreground">{rc ? `Signed rate con (${new Date(rc.signedAt).toLocaleDateString("en-US")})` : "Load carrier pay (no signed rate con)"}</div>
            {(rc?.lines ?? [{ label: "Carrier pay", amount: loadTotals(target.load).cost }]).map((l, i) => <div key={i} className="flex justify-between"><span>{l.label}</span><span>{usd(Number(l.amount))}</span></div>)}
            <div className="mt-1 flex justify-between border-t pt-1 font-semibold"><span>Total</span><span>{usd(a.expected)}</span></div></div>
          <div><div className="mb-1 font-semibold uppercase text-muted-foreground">Carrier billed</div>
            {lines.length ? lines.map((l, i) => <div key={i} className={`flex justify-between ${a.unexpected.includes(l) ? "text-destructive" : ""}`}><span className="truncate pr-1">{l.description}</span><span>{usd(l.amount)}</span></div>) : <div className="text-muted-foreground">No lines read</div>}
            <div className="mt-1 flex justify-between border-t pt-1 font-semibold"><span>Total</span><span>{billed != null && Number.isFinite(billed) ? usd(billed) : "—"}</span></div></div>
        </div>
        {billed != null && (flags.length ? (
          <ul className="space-y-1 rounded border border-destructive/50 bg-destructive/10 p-2 text-xs">{flags.map((f) => <li key={f} className="flex gap-1"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-destructive" />{f}</li>)}</ul>
        ) : <div className="flex items-center gap-1 rounded border border-success/50 bg-success/10 p-2 text-xs text-success"><CheckCircle2 className="h-3.5 w-3.5" />Matches the rate con.</div>)}
        <ActionButton disabled={saving || reading} hint="Stores the invoice on the load's billing record with the amount and charges above."
          confirm={() => ({ title: "Save this carrier invoice?", points: [
            "Stores the file and amount on this load's carrier bill (Accounting only).",
            target.bill ? "The bill's amount for QuickBooks is not changed — it stays the rate con amount." : "Creates the carrier bill ON HOLD. It goes to QuickBooks only when you tick it and press Send selected to QuickBooks.",
            "Does not pay the carrier or change the load.",
          ], confirmLabel: "Save" })}
          onClick={save}>{saving ? "Saving…" : "Save carrier invoice"}</ActionButton>
      </DialogContent>
    </Dialog>
  );
}
