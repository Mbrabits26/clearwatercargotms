import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, ShieldCheck, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { lookupFmcsa, type FmcsaCarrier } from "@/lib/fmcsa.functions";
import { contactRisk } from "@/lib/fraudCheck";
import { getCarrierCheck } from "@/lib/carrierCheck.functions";
import { CarrierCheckButton } from "@/components/CarrierCheckDialog";
import { carrierCheckWarning, type CarrierWarning } from "@/lib/carrierAlerts";

/** Button that pulls carrier data from FMCSA/SAFER by MC or DOT. */
export function FmcsaButton({ mc, dot, onResult, label = "Look up FMCSA" }: {
  mc?: string | null; dot?: string | null; onResult: (r: FmcsaCarrier) => void; label?: string;
}) {
  const fn = useServerFn(lookupFmcsa);
  const checkFn = useServerFn(getCarrierCheck);
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState<CarrierWarning | null>(null);
  const run = async () => {
    setBusy(true); setWarning(null);
    try {
      const r = await fn({ data: { mc: mc || null, dot: dot || null } });
      if (r.source === "blocked") { toast.warning(r.warnings[0], { action: { label: "Open in SAFER", onClick: () => window.open(r.safer_url, "_blank") } }); return; }
      onResult(r);
      if (r.warnings.length) toast.warning(`FMCSA: ${r.warnings.join(" · ")}`);
      else toast.success(`FMCSA: ${r.legal_name} · ${r.authority_status}`);
      // Complete the check as part of this lookup, not a silent background job.
      if (r.dot_number) {
        try {
          const report = await checkFn({ data: { mc: r.mc_number, dot: r.dot_number } });
          setWarning(carrierCheckWarning(report));
        } catch {
          toast.warning("Detailed Carrier Checks unavailable; FMCSA result is still shown.");
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "FMCSA lookup failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="secondary" className="shrink-0" disabled={busy || (!mc && !dot)} onClick={run}>
        {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-1 h-4 w-4" />}{label}
      </Button>
      <MotusButton dot={dot} />
      <CarrierCheckButton mc={mc} dot={dot} />
      {warning && <div role="status" className={`w-full rounded border p-2 text-sm ${warning.level === "red" ? "border-destructive/50 bg-destructive/5" : "border-warning/50 bg-warning/5"}`}>
        <div className={`font-semibold ${warning.level === "red" ? "text-destructive" : "text-warning"}`}>{warning.title}</div>
        <div className="text-muted-foreground">{warning.body}</div>
      </div>}
    </div>
  );
}

/** Opens the carrier's record in FMCSA MOTUS (new tab) and copies the DOT # as a fallback. */
export function MotusButton({ dot }: { dot?: string | null }) {
  const d = (dot ?? "").replace(/\D/g, "");
  const open = () => {
    if (d) navigator.clipboard.writeText(d).catch(() => {});
    window.open(d ? `https://motus.dot.gov/customer/${d}/account` : "https://motus.dot.gov/public/search", "_blank", "noopener");
    if (d) toast.success(`DOT ${d} copied — paste it into MOTUS search if needed`);
  };
  return (
    <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={open} title="Verify this carrier in FMCSA MOTUS">
      <ExternalLink className="mr-1 h-4 w-4" />MOTUS
    </Button>
  );
}

export function FmcsaSummary({ r }: { r: FmcsaCarrier }) {
  const usd = (n: number | null) => (n == null ? "—" : `$${n.toLocaleString()}`);
  return (
    <div className={`rounded border p-2 text-xs ${r.warnings.length ? "border-destructive/50 bg-destructive/5" : "border-success/50 bg-success/5"}`}>
      <div className="font-semibold">{r.legal_name}{r.dba && ` (DBA ${r.dba})`} · DOT {r.dot_number}{r.mc_number && ` · MC ${r.mc_number}`}</div>
      <div className="text-muted-foreground">
        Authority: {r.authority_status} · Safety: {r.safety_rating} · Power units: {r.power_units ?? "—"} · Liability on file: {usd(r.bipd_on_file)}{r.bipd_required ? ` (req. ${usd(r.bipd_required)})` : ""} · Cargo on file: {usd(r.cargo_on_file)}
      </div>
      {(r.contact_name || r.email || r.phone || r.cell_phone) && <div className="text-muted-foreground">{[r.contact_name, r.email, r.phone, r.cell_phone && `cell ${r.cell_phone}`, r.fax && `fax ${r.fax}`].filter(Boolean).join(" · ")}</div>}
      <div className="text-muted-foreground">Source: {r.source === "SAFER" ? "SAFER snapshot" : "FMCSA"} · <a href={r.safer_url} target="_blank" rel="noreferrer" className="text-gold underline">Open in SAFER</a></div>
      {r.warnings.map((w) => <div key={w} className="text-destructive">⚠ {w}</div>)}
      <ContactCheck r={r} />
    </div>
  );
}

/** Compare the dispatcher actually contacting us against FMCSA's records (spoofing / double-brokering check). */
function ContactCheck({ r }: { r: FmcsaCarrier }) {
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const flags = contactRisk({ email, phone }, r);
  return (
    <div className="mt-2 space-y-1 border-t pt-2">
      <div className="font-semibold">Fraud check — who contacted you?</div>
      <div className="flex flex-wrap gap-2">
        <input className="h-7 min-w-0 flex-1 rounded border bg-background px-2" placeholder="Their email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="h-7 min-w-0 flex-1 rounded border bg-background px-2" placeholder="Their phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      {flags.map((f) => <div key={f.text} className={f.level === "ok" ? "text-success" : f.level === "high" ? "font-semibold text-destructive" : "text-warning"}>{f.level === "ok" ? "✓" : "⚠"} {f.text}</div>)}
      <div className="text-muted-foreground">Always confirm new carriers by calling the FMCSA phone{r.phone ? ` (${r.phone})` : ""}, not the number in their email or load-board post.</div>
    </div>
  );
}
