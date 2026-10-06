import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Copy, FileText, Link2, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DOC_KINDS, expiryState, fmtDate, type Carrier, type ExpiryState } from "@/lib/tms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export function ExpiryBadge({ s }: { s: ExpiryState }) {
  if (s === "ok") return null;
  const map = { expired: ["Expired", "border-destructive text-destructive"], soon: ["Expiring soon", "border-warning text-warning"], missing: ["Missing", "border-destructive text-destructive"] } as const;
  const [l, c] = map[s];
  return <span className={cn("rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider", c)}>{l}</span>;
}

export function InsurancePanel({ c, update }: { c: Carrier; update: (p: Partial<Carrier>, m: string) => void }) {
  const [f, setF] = useState({
    auto_liability: String(c.auto_liability ?? ""), insurance_expires: c.insurance_expires ?? "",
    cargo_insurance: String(c.cargo_insurance ?? ""), cargo_expires: c.cargo_expires ?? "",
  });
  const row = (amt: "auto_liability" | "cargo_insurance", exp: "insurance_expires" | "cargo_expires", label: string, min: number) => (
    <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
      <label className="text-xs text-muted-foreground">{label} limit ($)
        <Input className="mt-1" type="number" value={f[amt]} onChange={(e) => setF((p) => ({ ...p, [amt]: e.target.value }))} />
      </label>
      <label className="text-xs text-muted-foreground">Expires
        <Input className="mt-1" type="date" value={f[exp]} onChange={(e) => setF((p) => ({ ...p, [exp]: e.target.value }))} />
      </label>
      <div className="flex h-9 items-center gap-1">
        <ExpiryBadge s={expiryState(f[exp] || null)} />
        {Number(f[amt]) < min && <span className="rounded border border-warning px-1.5 py-0.5 text-[10px] uppercase text-warning">Below ${min.toLocaleString()}</span>}
      </div>
    </div>
  );
  return (
    <div className="space-y-3 rounded border bg-card p-4">
      <h3 className="text-sm font-semibold uppercase tracking-widest text-gold">Insurance</h3>
      {row("auto_liability", "insurance_expires", "Auto liability", 750000)}
      {row("cargo_insurance", "cargo_expires", "Cargo", 100000)}
      <Button size="sm" variant="secondary" onClick={() => update({
        auto_liability: Number(f.auto_liability) || 0, cargo_insurance: Number(f.cargo_insurance) || 0,
        insurance_expires: f.insurance_expires || null, cargo_expires: f.cargo_expires || null,
      }, "Insurance updated")}>Save insurance</Button>
    </div>
  );
}

export function DocumentsPanel({ c, update }: { c: Carrier; update: (p: Partial<Carrier>, m: string) => void }) {
  const qc = useQueryClient();
  const key = ["carrier_docs", c.id];
  const { data: docs = [] } = useQuery({
    queryKey: key,
    queryFn: async () => (await supabase.from("carrier_documents").select("*").eq("carrier_id", c.id).order("uploaded_at", { ascending: false })).data ?? [],
  });
  const [kind, setKind] = useState<string>("w9");
  const [busy, setBusy] = useState(false);
  const flag: Record<string, keyof Carrier> = { w9: "w9_received", coi: "coi_received", agreement: "agreement_signed", noa: "noa_received", voided_check: "voided_check_received" };

  const upload = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    const path = `${c.id}/${kind}-${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
    const { error } = await supabase.storage.from("carrier-docs").upload(path, file);
    if (error) { setBusy(false); return toast.error(error.message); }
    await supabase.from("carrier_documents").insert({ carrier_id: c.id, kind, file_path: path, file_name: file.name, expires_on: kind === "coi" ? c.insurance_expires : null });
    setBusy(false);
    qc.invalidateQueries({ queryKey: key });
    update({ [flag[kind]!]: true } as Partial<Carrier>, "Document uploaded");
  };
  const open = async (path: string) => {
    const { data, error } = await supabase.storage.from("carrier-docs").createSignedUrl(path, 300);
    if (error) return toast.error(error.message);
    window.open(data.signedUrl, "_blank");
  };

  return (
    <div className="space-y-3 rounded border bg-card p-4">
      <h3 className="text-sm font-semibold uppercase tracking-widest text-gold">Onboarding packet</h3>
      <div className="grid grid-cols-5 gap-2">
        {DOC_KINDS.map((d) => {
          const have = Boolean(c[flag[d.value]!]);
          const needed = d.value === "noa" ? !!c.factoring_company : d.value === "voided_check" ? false : true;
          return (
            <label key={d.value} className={cn("rounded border p-2 text-xs", have ? "border-success/60" : needed ? "border-destructive/60" : "border-border")}>
              <input type="checkbox" className="mr-1" checked={have} onChange={(e) => update({ [flag[d.value]!]: e.target.checked } as Partial<Carrier>, `${d.label} updated`)} />
              {d.label}
              <div className={cn("mt-1 text-[10px] uppercase", have ? "text-success" : needed ? "text-destructive" : "text-muted-foreground")}>{have ? "On file" : needed ? "Required" : "Optional"}</div>
            </label>
          );
        })}
      </div>
      <div className="flex gap-2">
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>{DOC_KINDS.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}</SelectContent>
        </Select>
        <Button variant="secondary" disabled={busy} asChild>
          <label className="cursor-pointer"><Upload className="mr-1 h-4 w-4" />{busy ? "Uploading…" : "Upload file"}
            <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => upload(e.target.files?.[0])} />
          </label>
        </Button>
      </div>
      <ul className="divide-y text-sm">
        {docs.map((d) => (
          <li key={d.id} className="flex items-center justify-between py-1.5">
            <span className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <b className="text-xs uppercase text-gold">{DOC_KINDS.find((k) => k.value === d.kind)?.label}</b>
              {d.file_path ? <button className="underline" onClick={() => open(d.file_path)}>{d.file_name}</button> : <span>{d.file_name}</span>}
            </span>
            <span className="text-xs text-muted-foreground">{d.source} · {fmtDate(d.uploaded_at)}</span>
          </li>
        ))}
        {!docs.length && <li className="py-2 text-xs text-muted-foreground">No files uploaded yet.</li>}
      </ul>
    </div>
  );
}

export function InvitePanel({ c }: { c: Carrier }) {
  const qc = useQueryClient();
  const key = ["carrier_invites", c.id];
  const { data: invites = [] } = useQuery({
    queryKey: key,
    queryFn: async () => (await supabase.from("carrier_invites").select("*").eq("carrier_id", c.id).order("created_at", { ascending: false })).data ?? [],
  });
  const link = (t: string) => `${window.location.origin}/onboard/${t}`;
  const create = async () => {
    const { data, error } = await supabase.from("carrier_invites").insert({ carrier_id: c.id, email: c.email }).select("token").single();
    if (error) return toast.error(error.message);
    await navigator.clipboard.writeText(link(data.token)).catch(() => {});
    toast.success("Onboarding link copied — send it to the carrier");
    qc.invalidateQueries({ queryKey: key });
  };
  const revoke = async (id: string) => {
    await supabase.from("carrier_invites").update({ status: "revoked" }).eq("id", id);
    qc.invalidateQueries({ queryKey: key });
  };
  return (
    <div className="space-y-2 rounded border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-gold">Carrier packet link</h3>
        <Button size="sm" onClick={create}><Link2 className="mr-1 h-4 w-4" />Create invite link</Button>
      </div>
      <p className="text-xs text-muted-foreground">The carrier fills in company info, insurance limits and dates, uploads their W-9, COI, NOA or voided check, and signs the agreement. Links last 14 days.</p>
      <ul className="divide-y text-sm">
        {invites.map((i) => (
          <li key={i.id} className="flex items-center justify-between py-1.5">
            <span className="text-xs">
              <span className={cn("mr-2 uppercase", i.status === "submitted" ? "text-success" : i.status === "revoked" ? "text-muted-foreground" : "text-warning")}>{i.status}</span>
              Sent {fmtDate(i.created_at)} {i.submitted_at && `· Submitted ${fmtDate(i.submitted_at)}`}
            </span>
            {i.status === "sent" && (
              <span className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(link(i.token)).then(() => toast.success("Link copied"))}><Copy className="h-3.5 w-3.5" /></Button>
                <Button size="sm" variant="ghost" onClick={() => revoke(i.id)}>Cancel</Button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function NewCarrierInvite() {
  const [email, setEmail] = useState("");
  const create = async () => {
    const { data, error } = await supabase.from("carrier_invites").insert({ email: email || null }).select("token").single();
    if (error) return toast.error(error.message);
    await navigator.clipboard.writeText(`${window.location.origin}/onboard/${data.token}`).catch(() => {});
    toast.success("Link copied — the carrier is added as pending when they submit");
    setEmail("");
  };
  return (
    <div className="flex gap-2 border-b p-3">
      <Input placeholder="New carrier email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} />
      <Button size="sm" variant="secondary" onClick={create}><Link2 className="mr-1 h-4 w-4" />Invite</Button>
    </div>
  );
}
