import { useState } from "react";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { useReviewChanges } from "@/components/ReviewChanges";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PAY_TERMS, payTermsOf, type Carrier } from "@/lib/tms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/DatePicker";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const FIELDS: { key: keyof Carrier; label: string; half?: boolean }[] = [
  { key: "legal_name", label: "Legal name" },
  { key: "dba", label: "DBA", half: true },
  { key: "mc_number", label: "MC #", half: true },
  { key: "dot_number", label: "DOT #", half: true },
  { key: "contact_name", label: "Contact name", half: true },
  { key: "phone", label: "Phone", half: true },
  { key: "email", label: "Email", half: true },
  { key: "address", label: "Address" },
  { key: "city", label: "City", half: true },
  { key: "state", label: "State", half: true },
  { key: "zip", label: "ZIP", half: true },
  { key: "equipment", label: "Equipment" },
  { key: "factoring_company", label: "Factoring company", half: true },
  { key: "factoring_remit_address", label: "Factoring remit-to address" },
];

export function EditCarrierDialog({ c, open, onOpenChange, onDone }: { c: Carrier; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [f, setF] = useState<Record<string, string>>(() => init(c));
  const [saving, setSaving] = useState(false);
  const { ask, dialog } = useReviewChanges();
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  const save = async () => {
    setSaving(true);
    const patch: Record<string, unknown> = {};
    for (const { key } of FIELDS) {
      const v = (f[key as string] ?? "").trim();
      if (v !== String(c[key] ?? "")) patch[key] = v || null;
    }
    const num = (k: string, cur: number | null) => {
      const v = (f[k] ?? "").trim();
      if (v === String(cur ?? "")) return;
      patch[k] = v ? Number(v.replace(/[^0-9.]/g, "")) : null;
    };
    num("cargo_insurance", c.cargo_insurance);
    num("auto_liability", c.auto_liability);
    const date = (k: string, cur: string | null) => {
      const v = (f[k] ?? "").trim();
      if (v !== (cur ?? "")) patch[k] = v || null;
    };
    date("insurance_expires", c.insurance_expires);
    date("cargo_expires", c.cargo_expires);
    if (f.pay_terms !== c.pay_terms) patch.pay_terms = f.pay_terms;
    if (f.authority_status !== c.authority_status) patch.authority_status = f.authority_status;
    if ((f.safety_rating ?? "") !== (c.safety_rating ?? "")) patch.safety_rating = f.safety_rating || null;

    if (!Object.keys(patch).length) {
      toast.info("No changes to save.");
      setSaving(false);
      return;
    }
    const labels: Record<string, string> = { cargo_insurance: "Cargo insurance", auto_liability: "Auto liability", insurance_expires: "Liability expires", cargo_expires: "Cargo expires", pay_terms: "Pay option", authority_status: "Authority status", safety_rating: "Safety rating" };
    const ok = await ask(Object.entries(patch).map(([k, v]) => ({ label: FIELDS.find((x) => x.key === k)?.label ?? labels[k] ?? k, before: c[k as keyof Carrier], after: v })));
    if (!ok) { setSaving(false); return; }
    const { error } = await supabase.from("carriers").update(patch as never).eq("id", c.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Carrier updated");
    onOpenChange(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-auto">
        {dialog}
        <DialogHeader><DialogTitle className="font-display text-2xl uppercase">Edit carrier — {c.legal_name}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          {FIELDS.map(({ key, label, half }) => (
            <label key={key} className={half ? "" : "col-span-2"}>
              <span className="text-xs text-muted-foreground">{label}</span>
              {key === "address" ? (
                <AddressAutocomplete value={f.address ?? ""} onChange={(v) => set("address", v)}
                  onPick={(pl) => setF((p) => ({ ...p, address: pl.address, city: pl.city, state: pl.state, zip: pl.zip, phone: p.phone || pl.phone }))} />
              ) : (
                <Input value={f[key as string] ?? ""} onChange={(e) => set(key as string, e.target.value)} />
              )}
            </label>
          ))}
          <label>
            <span className="text-xs text-muted-foreground">Cargo insurance ($)</span>
            <Input inputMode="numeric" value={f.cargo_insurance ?? ""} onChange={(e) => set("cargo_insurance", e.target.value)} />
          </label>
          <label>
            <span className="text-xs text-muted-foreground">Auto liability ($)</span>
            <Input inputMode="numeric" value={f.auto_liability ?? ""} onChange={(e) => set("auto_liability", e.target.value)} />
          </label>
          <label>
            <span className="text-xs text-muted-foreground">Liability insurance expires</span>
            <DatePicker value={f.insurance_expires ?? ""} onChange={(v) => set("insurance_expires", v)} />
          </label>
          <label>
            <span className="text-xs text-muted-foreground">Cargo insurance expires</span>
            <DatePicker value={f.cargo_expires ?? ""} onChange={(v) => set("cargo_expires", v)} />
          </label>
          <label>
            <span className="text-xs text-muted-foreground">Pay option</span>
            <Select value={f.pay_terms} onValueChange={(v) => set("pay_terms", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PAY_TERMS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
            </Select>
          </label>
          <label>
            <span className="text-xs text-muted-foreground">Authority status</span>
            <Select value={f.authority_status} onValueChange={(v) => set("authority_status", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{["Authorized", "Not Authorized", "None", "Unknown"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </label>
          <label>
            <span className="text-xs text-muted-foreground">Safety rating</span>
            <Select value={f.safety_rating || "none"} onValueChange={(v) => set("safety_rating", v === "none" ? "" : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{["none", "Satisfactory", "Conditional", "Unsatisfactory", "Not Rated"].map((s) => <SelectItem key={s} value={s}>{s === "none" ? "—" : s}</SelectItem>)}</SelectContent>
            </Select>
          </label>
        </div>
        <p className="text-xs text-muted-foreground">Pay option now: {payTermsOf(c.pay_terms).label}. Compliance status and document checkboxes still update through the normal safety checks and documents.</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={saving} onClick={save}>{saving ? "Saving…" : "Save changes"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function init(c: Carrier): Record<string, string> {
  const o: Record<string, string> = {};
  const keys = ["legal_name", "dba", "mc_number", "dot_number", "contact_name", "phone", "email", "address", "city", "state", "zip", "equipment", "factoring_company", "factoring_remit_address", "insurance_expires", "cargo_expires", "safety_rating"] as const;
  for (const k of keys) o[k] = String(c[k] ?? "");
  o.cargo_insurance = c.cargo_insurance != null ? String(c.cargo_insurance) : "";
  o.auto_liability = c.auto_liability != null ? String(c.auto_liability) : "";
  o.pay_terms = c.pay_terms;
  o.authority_status = c.authority_status;
  return o;
}
