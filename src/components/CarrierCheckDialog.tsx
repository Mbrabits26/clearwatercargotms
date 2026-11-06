import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, ClipboardCheck, RefreshCw, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getCarrierCheck } from "@/lib/carrierCheck.functions";
import { fmtYmd, pct, NAT_AVG, type CarrierCheckReport } from "@/lib/carrierCheck";

const usd = (n: number | null) => (n == null ? "—" : `$${n.toLocaleString()}`);

/** Opens the Carrier Checks vetting report (cached up to 7 days; built on demand). */
export function CarrierCheckButton({ mc, dot }: { mc?: string | null; dot?: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" variant="outline" className="shrink-0" disabled={!mc && !dot} onClick={() => setOpen(true)} title="Detailed SAFER / FMCSA vetting report">
        <ClipboardCheck className="mr-1 h-4 w-4" />Carrier Checks
      </Button>
      {open && <CarrierCheckDialog mc={mc ?? null} dot={dot ?? null} onClose={() => setOpen(false)} />}
    </>
  );
}

export function CarrierCheckDialog({ mc, dot, onClose }: { mc: string | null; dot: string | null; onClose: () => void }) {
  const fn = useServerFn(getCarrierCheck);
  const [r, setR] = useState<CarrierCheckReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async (refresh = false) => {
    setBusy(true); setErr(null);
    try { setR(await fn({ data: { mc, dot, refresh } })); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not build the report"); }
    finally { setBusy(false); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Carrier Checks{r ? ` — ${r.legal_name}` : ""}</DialogTitle></DialogHeader>
        {busy && !r && <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Pulling FMCSA census, inspections and crashes…</div>}
        {err && <div className="rounded border border-destructive/50 bg-destructive/5 p-2 text-sm">{err}</div>}
        {r && <Report r={r} />}
        {r && (
          <div className="flex flex-wrap justify-between gap-2 border-t pt-3">
            <span className="text-xs text-muted-foreground">Report from {new Date(r.generated_at).toLocaleString()} · FMCSA SAFER/MCMIS public data · last 24 months</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => load(true)}>{busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}Refresh</Button>
              <Button size="sm" onClick={() => printReport(r)}><Printer className="mr-1 h-4 w-4" />Print / PDF</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Report({ r }: { r: CarrierCheckReport }) {
  const tone = r.grade === "High risk" ? "border-destructive/60 bg-destructive/10" : r.grade === "Review" ? "border-warning/60 bg-warning/10" : "border-success/60 bg-success/10";
  const kv = (k: string, v: React.ReactNode) => <div className="flex justify-between gap-2 border-b border-border/40 py-1"><span className="text-muted-foreground">{k}</span><span className="text-right font-medium">{v ?? "—"}</span></div>;
  const oosRow = (label: string, n: number, oos: number, avg: number | null) => {
    const p = pct(oos, n);
    return <tr className="border-b border-border/40"><td className="py-1">{label}</td><td>{n}</td><td>{oos}</td><td className={avg != null && n >= 3 && p > avg ? "font-semibold text-destructive" : ""}>{p}%</td><td>{avg ?? "—"}{avg != null && "%"}</td></tr>;
  };
  return (
    <div className="space-y-4 text-sm">
      <div className={`flex flex-wrap items-center gap-4 rounded border p-3 ${tone}`}>
        <div className="text-3xl font-bold">{r.score}</div>
        <div><div className="font-semibold">{r.grade}</div><div className="text-xs text-muted-foreground">DOT {r.dot}{r.mc && ` · MC ${r.mc}`}{r.dba && ` · DBA ${r.dba}`}</div></div>
        <ul className="ml-auto space-y-0.5 text-xs">
          {r.flags.length ? r.flags.map((f, i) => <li key={i} className={f.level === "red" ? "text-destructive" : "text-warning"}>{f.level === "red" ? "●" : "▲"} {f.text}</li>) : <li>No flags found</li>}
        </ul>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h4 className="mb-1 font-semibold">Identity & authority</h4>
          {kv("USDOT status", r.status)}{kv("Operating authority", r.authority_status)}{kv("Safety rating", `${r.safety_rating}${r.safety_rating_date ? ` (${fmtYmd(r.safety_rating_date)})` : ""}`)}
          {kv("Last review", r.review)}{kv("DOT added", fmtYmd(r.added))}{kv("MCS-150 updated", fmtYmd(r.mcs150_date))}{kv("MCS-150 mileage", r.mcs150_mileage)}
          {kv("Entity / operation", [r.entity, r.operation].filter(Boolean).join(" · ") || "—")}{kv("Classification", r.classification)}{kv("Hazmat", r.hazmat ? "Yes" : "No")}
        </div>
        <div>
          <h4 className="mb-1 font-semibold">Contact & fleet</h4>
          {kv("Address", r.address)}{kv("Mailing", r.mailing)}{kv("Phone", r.phone)}{kv("Email", r.email)}{kv("Contact", r.contact)}
          {kv("Power units / drivers", `${r.power_units ?? "—"} / ${r.drivers ?? "—"}`)}{kv("Owned tractors / trailers", `${r.owned_tractors ?? "—"} / ${r.owned_trailers ?? "—"}`)}
          {kv("Liability on file", `${usd(r.bipd_on_file)}${r.bipd_required ? ` (req. ${usd(r.bipd_required)})` : ""}`)}{kv("Cargo on file", usd(r.cargo_on_file))}
        </div>
      </div>
      {r.cargo.length > 0 && <div><h4 className="mb-1 font-semibold">Cargo carried</h4><div className="flex flex-wrap gap-1">{r.cargo.map((c) => <span key={c} className="rounded border px-1.5 py-0.5 text-xs capitalize">{c}</span>)}</div></div>}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h4 className="mb-1 font-semibold">Inspections (24 mo) · {r.insp.total} total, {r.insp.violations} violations</h4>
          <table className="w-full text-xs"><thead><tr className="text-left text-muted-foreground"><th>Type</th><th>Insp</th><th>OOS</th><th>OOS %</th><th>Nat'l avg</th></tr></thead>
            <tbody>{oosRow("Vehicle", r.insp.vehicle, r.insp.vehicle_oos, NAT_AVG.vehicle)}{oosRow("Driver", r.insp.driver, r.insp.driver_oos, NAT_AVG.driver)}{oosRow("Hazmat", r.insp.hazmat, r.insp.hazmat_oos, NAT_AVG.hazmat)}</tbody></table>
        </div>
        <div>
          <h4 className="mb-1 font-semibold">Crashes (24 mo)</h4>
          <table className="w-full text-xs"><thead><tr className="text-left text-muted-foreground"><th>Fatal</th><th>Injury</th><th>Tow</th><th>Total</th></tr></thead>
            <tbody><tr><td>{r.crashes.fatal}</td><td>{r.crashes.injury}</td><td>{r.crashes.tow}</td><td>{r.crashes.total}</td></tr></tbody></table>
        </div>
      </div>
      {r.top_violations.length > 0 && (
        <div><h4 className="mb-1 font-semibold">Most common violations</h4>
          <table className="w-full text-xs"><thead><tr className="text-left text-muted-foreground"><th>Code</th><th>Description</th><th>Count</th><th>OOS</th></tr></thead>
            <tbody>{r.top_violations.map((v) => <tr key={v.code} className="border-b border-border/40"><td className="py-1">{v.code}</td><td>{v.desc}</td><td>{v.count}</td><td>{v.oos}</td></tr>)}</tbody></table></div>
      )}
      {r.recent_inspections.length > 0 && (
        <div><h4 className="mb-1 font-semibold">Recent inspections</h4>
          <table className="w-full text-xs"><thead><tr className="text-left text-muted-foreground"><th>Date</th><th>State</th><th>Level</th><th>Violations</th><th>OOS</th></tr></thead>
            <tbody>{r.recent_inspections.map((i, k) => <tr key={k} className="border-b border-border/40"><td className="py-1">{fmtYmd(i.date)}</td><td>{i.state}</td><td>{i.level}</td><td>{i.violations}</td><td className={i.oos ? "text-destructive" : ""}>{i.oos}</td></tr>)}</tbody></table></div>
      )}
      {r.recent_crashes.length > 0 && (
        <div><h4 className="mb-1 font-semibold">Crash list</h4>
          <table className="w-full text-xs"><thead><tr className="text-left text-muted-foreground"><th>Date</th><th>Location</th><th>Fatalities</th><th>Injuries</th><th>Tow</th></tr></thead>
            <tbody>{r.recent_crashes.map((c, k) => <tr key={k} className="border-b border-border/40"><td className="py-1">{fmtYmd(c.date)}</td><td>{c.city}, {c.state}</td><td>{c.fatalities}</td><td>{c.injuries}</td><td>{c.tow_away ? "Yes" : "No"}</td></tr>)}</tbody></table></div>
      )}
    </div>
  );
}

const esc = (s: unknown) => String(s ?? "—").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

/** Plain black-on-white printable sheet (report printing rule). */
function printReport(r: CarrierCheckReport) {
  const rows = (pairs: [string, unknown][]) => pairs.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("");
  const tbl = (head: string[], body: unknown[][]) => `<table><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr>${body.map((b) => `<tr>${b.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</table>`;
  const html = `<html><head><title>Carrier Checks - ${esc(r.legal_name)}</title><style>body{font:12px Arial;color:#000;margin:24px}table{border-collapse:collapse;width:100%;margin:6px 0 14px}th,td{border:1px solid #000;padding:3px 6px;text-align:left}h1{font-size:18px}h2{font-size:14px;margin:10px 0 2px}</style></head><body>
<h1>Carrier Checks — ${esc(r.legal_name)}</h1><div>DOT ${esc(r.dot)} · MC ${esc(r.mc)} · Generated ${esc(new Date(r.generated_at).toLocaleString())}</div>
<h2>Score: ${r.score} — ${esc(r.grade)}</h2>${tbl(["Flag", "Detail"], r.flags.length ? r.flags.map((f) => [f.level === "red" ? "High" : "Review", f.text]) : [["—", "No flags found"]])}
<h2>Identity & authority</h2><table>${rows([["DBA", r.dba], ["USDOT status", r.status], ["Operating authority", r.authority_status], ["Safety rating", r.safety_rating], ["Last review", r.review], ["DOT added", fmtYmd(r.added)], ["MCS-150 updated", fmtYmd(r.mcs150_date)], ["MCS-150 mileage", r.mcs150_mileage], ["Operation", r.operation], ["Classification", r.classification], ["Cargo", r.cargo.join(", ")]])}</table>
<h2>Contact & fleet</h2><table>${rows([["Address", r.address], ["Phone", r.phone], ["Email", r.email], ["Power units", r.power_units], ["Drivers", r.drivers], ["Liability on file", usd(r.bipd_on_file)], ["Cargo on file", usd(r.cargo_on_file)]])}</table>
<h2>Inspections (24 months)</h2>${tbl(["Type", "Inspections", "OOS", "OOS %", "Nat'l avg"], [["Vehicle", r.insp.vehicle, r.insp.vehicle_oos, pct(r.insp.vehicle_oos, r.insp.vehicle) + "%", NAT_AVG.vehicle + "%"], ["Driver", r.insp.driver, r.insp.driver_oos, pct(r.insp.driver_oos, r.insp.driver) + "%", NAT_AVG.driver + "%"], ["Hazmat", r.insp.hazmat, r.insp.hazmat_oos, pct(r.insp.hazmat_oos, r.insp.hazmat) + "%", NAT_AVG.hazmat + "%"]])}
<h2>Crashes (24 months)</h2>${tbl(["Fatal", "Injury", "Tow", "Total"], [[r.crashes.fatal, r.crashes.injury, r.crashes.tow, r.crashes.total]])}
${r.top_violations.length ? `<h2>Most common violations</h2>${tbl(["Code", "Description", "Count", "OOS"], r.top_violations.map((v) => [v.code, v.desc, v.count, v.oos]))}` : ""}
${r.recent_inspections.length ? `<h2>Recent inspections</h2>${tbl(["Date", "State", "Level", "Violations", "OOS"], r.recent_inspections.map((i) => [fmtYmd(i.date), i.state, i.level, i.violations, i.oos]))}` : ""}
${r.recent_crashes.length ? `<h2>Crashes</h2>${tbl(["Date", "Location", "Fatalities", "Injuries", "Tow"], r.recent_crashes.map((c) => [fmtYmd(c.date), `${c.city}, ${c.state}`, c.fatalities, c.injuries, c.tow_away ? "Yes" : "No"]))}` : ""}
<p>Source: FMCSA SAFER / MCMIS public data. Clearwater Cargo, LLC carrier vetting record.</p><script>window.onload=()=>window.print()</script></body></html>`;
  const w = window.open("", "_blank");
  if (w) { w.document.write(html); w.document.close(); }
}
