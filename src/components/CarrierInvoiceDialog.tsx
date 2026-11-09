import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { saveCarrierInvoiceReview } from "@/lib/carrierInvoiceReview.functions";
import { invoiceReviewSchema, type paymentReviewSchema } from "@/lib/carrierInvoiceReview";
import { Checkbox } from "@/components/ui/checkbox";
import type { z } from "zod";

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

export type BillRow = { id: string; status: string; carrier_invoice_path: string | null; carrier_invoice_amount: number | null; carrier_invoice_number?: string | null; carrier_invoice_lines?: unknown; carrier_invoice_kind?: string | null };
export type BillTarget = { load: Load; bill?: BillRow; payee: string; net: number; gross: number; fee: number };

const toB64 = (buf: ArrayBuffer) => {
  let s = "";
  const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};

/** Attach the carrier's invoice, read its charges, and compare them to the signed rate con before AP posting. */
export function CarrierInvoiceDialog({ target, onClose, onSaved, initialFile, initialKind = "regular" }: { target: BillTarget | null; onClose: () => void; onSaved: () => void; initialFile?: File; initialKind?: "regular" | "factoring" }) {
  const read = useServerFn(readCarrierInvoice);
  const saveReview = useServerFn(saveCarrierInvoiceReview);
  const qc = useQueryClient();
  const [kind, setKind] = useState<"regular" | "factoring">(initialKind);
  const [factor, setFactor] = useState("");
  const [address, setAddress] = useState("");
  const [saveFactor, setSaveFactor] = useState(false);
  const [saveAccount, setSaveAccount] = useState(false);
  const [account, setAccount] = useState<z.infer<typeof paymentReviewSchema>>({ method: "check", bank_name: "", account_name: "", routing_number: "", account_number: "", account_type: "checking", remit_email: "", notes: "" });
  const { data: carrier } = useQuery({ queryKey: ["invoice-carrier", target?.load.carrier_id], enabled: !!target?.load.carrier_id,
    queryFn: async () => { const { data, error } = await supabase.from("carriers").select("factoring_company,factoring_remit_address,factoring_remit,noa_received").eq("id", target?.load.carrier_id ?? "").single(); if (error) throw error; return data; } });
  const { data: existingAccount } = useQuery({ queryKey: ["carrier_payment_account", target?.load.carrier_id], enabled: !!target?.load.carrier_id,
    queryFn: async () => { const { data, error } = await supabase.from("carrier_payment_accounts").select("*").eq("carrier_id", target?.load.carrier_id ?? "").maybeSingle(); if (error) throw error; return data; } });
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
    setKind(target.bill?.carrier_invoice_kind === "factoring" ? "factoring" : initialKind);
    setSaveFactor(false); setSaveAccount(false); setFactor(""); setAddress("");
    setAccount({ method: "check", bank_name: "", account_name: "", routing_number: "", account_number: "", account_type: "checking", remit_email: "", notes: "" });
    if (initialFile) void pick(initialFile);
  }, [target]);
  useEffect(() => { if (carrier) { setFactor(carrier.factoring_company ?? ""); setAddress(carrier.factoring_remit_address ?? carrier.factoring_remit ?? ""); } }, [carrier]);
  useEffect(() => { if (existingAccount) setAccount({ method: existingAccount.method === "ach" || existingAccount.method === "wire" ? existingAccount.method : "check", bank_name: existingAccount.bank_name ?? "", account_name: existingAccount.account_name ?? "", routing_number: existingAccount.routing_number ?? "", account_number: existingAccount.account_number ?? "", account_type: existingAccount.account_type === "savings" ? "savings" : "checking", remit_email: existingAccount.remit_email ?? "", notes: existingAccount.notes ?? "" }); }, [existingAccount]);
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
      if (r.factoring_company) { setKind("factoring"); setFactor(r.factoring_company); setAddress(r.factoring_address ?? ""); }
      if (r.remit_email) setAccount((a) => ({ ...a, remit_email: r.remit_email ?? "" }));
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
    const checked = invoiceReviewSchema.safeParse({ load: target.load.id, bill: target.bill?.id ?? null, path: target.bill?.carrier_invoice_path ?? `${target.load.id}/pending.pdf`, kind, number: num.trim(), amount: billed, lines, factor: kind === "factoring" && saveFactor ? { company: factor, address } : null, account: kind === "factoring" && saveFactor && saveAccount ? account : null });
    if (!checked.success) return toast.error(checked.error.issues[0]?.message ?? "Check invoice details");
    setSaving(true);
    let path = target.bill?.carrier_invoice_path ?? null;
    if (file) {
      path = `${target.load.id}/carrier_invoice-${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
      const { error } = await supabase.storage.from("load-docs").upload(path, file);
      if (error) { setSaving(false); return toast.error(error.message); }
    }
    if (!path) { setSaving(false); return; }
    try { await saveReview({ data: { ...checked.data, path } }); }
    catch (e) { setSaving(false); return toast.error((e as Error).message); }
    setSaving(false);
    for (const key of ["qb_sync", "carriers", "carrier_pay_due", "carrier_payment_account", "invoice-carrier", "load-docs", "load-notes"]) qc.invalidateQueries({ queryKey: [key] });
    toast.success(target.bill ? "Carrier invoice saved" : "Carrier invoice saved — bill is on hold until you send it to QuickBooks");
    onSaved();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>Carrier invoice — {target.load.load_number}</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">{target.payee}. Upload their invoice; the TMS reads it and checks it against the signed rate con. Nothing goes to QuickBooks from here.</p>
        <div className="flex gap-2" role="group" aria-label="Carrier invoice source">
          <Button size="sm" variant={kind === "regular" ? "default" : "outline"} onClick={() => setKind("regular")}>Regular carrier invoice</Button>
          <Button size="sm" variant={kind === "factoring" ? "default" : "outline"} onClick={() => setKind("factoring")}>Factoring company invoice</Button>
        </div>
        <Button variant="secondary" asChild disabled={reading}>
          <label className="cursor-pointer"><Upload className="mr-1 h-4 w-4" />{reading ? "Reading invoice…" : file ? file.name : target.bill?.carrier_invoice_path ? "Replace invoice file" : "Choose invoice file"}
            <input type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-muted-foreground">Carrier invoice #<Input className="mt-1" value={num} onChange={(e) => setNum(e.target.value)} /></label>
          <label className="text-xs text-muted-foreground">Invoice total ($)<Input className="mt-1" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        </div>
        {kind === "factoring" && <section className="space-y-3 border-t pt-3">
          <h3 className="text-sm font-semibold">Factoring payment details</h3>
          <label className="block text-xs">Factoring company<Input aria-label="Factoring company" maxLength={200} value={factor} onChange={(e) => setFactor(e.target.value)} /></label>
          <label className="block text-xs">Remit-to address<Input aria-label="Factoring remit-to address" maxLength={1000} value={address} onChange={(e) => setAddress(e.target.value)} /></label>
          {!carrier?.noa_received && <p className="text-xs text-destructive">NOA not on file — verify assignment before paying. This invoice does not establish an NOA.</p>}
          <label className="flex items-center gap-2 text-xs"><Checkbox checked={saveFactor} onCheckedChange={(v) => { setSaveFactor(v === true); if (!v) setSaveAccount(false); }} />Save reviewed factoring company and remit address to carrier</label>
          {saveFactor && <>
            <label className="flex items-center gap-2 text-xs"><Checkbox checked={saveAccount} onCheckedChange={(v) => setSaveAccount(v === true)} />Save reviewed payment account / remittance email to carrier</label>
            {saveAccount && <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="text-xs">Payment method<select aria-label="Payment method" className="mt-1 h-9 w-full rounded border bg-background px-2" value={account.method} onChange={(e) => setAccount({ ...account, method: e.target.value as "ach" | "wire" | "check" })}><option value="check">Check</option><option value="ach">ACH</option><option value="wire">Wire</option></select></label>
              <label className="text-xs">Account type<select aria-label="Account type" className="mt-1 h-9 w-full rounded border bg-background px-2" value={account.account_type} onChange={(e) => setAccount({ ...account, account_type: e.target.value as "checking" | "savings" })}><option value="checking">Checking</option><option value="savings">Savings</option></select></label>
              {([ ["remit_email", "Remittance email"], ["bank_name", "Bank name"], ["account_name", "Account name"], ["routing_number", "Routing number"], ["account_number", "Account number"], ["notes", "Payment instructions"] ] as const).map(([key, label]) => <label key={key} className="text-xs">{label}<Input aria-label={label} type={key === "account_number" || key === "routing_number" ? "password" : "text"} value={account[key]} onChange={(e) => setAccount({ ...account, [key]: e.target.value })} /></label>)}
            </div>}
          </>}
        </section>}
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
            kind === "factoring" && saveFactor ? "Updates this carrier's factoring remit details; confirm with a verified contact. NOA and pay terms stay unchanged." : "Existing carrier factoring/payment instructions stay unchanged.",
            saveAccount && saveFactor && kind === "factoring" ? "Replaces the finance-only carrier payment details with the reviewed values above." : "Bank details stay unchanged.",
          ], confirmLabel: "Save" })}
          onClick={save}>{saving ? "Saving…" : "Save carrier invoice"}</ActionButton>
      </DialogContent>
    </Dialog>
  );
}
