// Carrier Checks vetting report: shared types + pure scoring (client-safe).
export const NAT_AVG = { vehicle: 22.26, driver: 6.67, hazmat: 4.44 };

export type InspRow = { date: string; state: string; level: string; violations: number; oos: number; driver_oos: number; vehicle_oos: number; hazmat_oos: number };
export type CrashRow = { date: string; state: string; city: string; fatalities: number; injuries: number; tow_away: boolean };

export type CarrierCheckReport = {
  dot: string; mc: string | null; generated_at: string;
  legal_name: string; dba: string | null; status: string; authority_status: string; safety_rating: string; safety_rating_date: string | null;
  review: string | null; entity: string | null; operation: string | null; classification: string | null; cargo: string[];
  address: string | null; mailing: string | null; phone: string | null; email: string | null; contact: string | null;
  added: string | null; mcs150_date: string | null; mcs150_mileage: string | null;
  power_units: number | null; drivers: number | null; owned_tractors: number | null; owned_trailers: number | null;
  hazmat: boolean; interstate: boolean;
  bipd_on_file: number | null; bipd_required: number | null; cargo_on_file: number | null;
  insp: { total: number; vehicle: number; driver: number; hazmat: number; vehicle_oos: number; driver_oos: number; hazmat_oos: number; violations: number };
  crashes: { total: number; fatal: number; injury: number; tow: number };
  recent_inspections: InspRow[]; recent_crashes: CrashRow[];
  top_violations: { code: string; desc: string; count: number; oos: number }[];
  score: number; grade: "Low risk" | "Review" | "High risk"; flags: { level: "red" | "amber"; text: string }[];
};

const ymd = (s: string | null) => (s && /^\d{8}/.test(s) ? new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00Z`) : null);
export const fmtYmd = (s: string | null) => { const d = ymd(s); return d ? d.toISOString().slice(0, 10) : "—"; };
export const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);

/** Score 0–100 (higher = safer) plus red/amber flags. `now` injectable for tests. */
export function scoreReport(r: Omit<CarrierCheckReport, "score" | "grade" | "flags">, now = new Date()) {
  const flags: CarrierCheckReport["flags"] = [];
  let score = 100;
  const red = (t: string, p: number) => { flags.push({ level: "red", text: t }); score -= p; };
  const amber = (t: string, p: number) => { flags.push({ level: "amber", text: t }); score -= p; };
  if (r.authority_status !== "Authorized") red(`Operating authority: ${r.authority_status}`, 50);
  if (/unsat/i.test(r.safety_rating)) red("Unsatisfactory safety rating", 40);
  else if (/cond/i.test(r.safety_rating)) amber("Conditional safety rating", 20);
  const added = ymd(r.added);
  if (added) {
    const months = (now.getTime() - added.getTime()) / (30.44 * 86400000);
    if (months < 6) red(`New DOT — registered ${Math.max(0, Math.round(months))} month(s) ago`, 25);
    else if (months < 12) amber(`DOT under 1 year old`, 10);
  }
  const mcs = ymd(r.mcs150_date);
  if (mcs && now.getTime() - mcs.getTime() > 2 * 365.25 * 86400000) amber("MCS-150 not updated in over 2 years", 10);
  const vr = pct(r.insp.vehicle_oos, r.insp.vehicle), dr = pct(r.insp.driver_oos, r.insp.driver);
  if (r.insp.vehicle >= 3 && vr > NAT_AVG.vehicle * 1.5) red(`Vehicle OOS rate ${vr}% (nat'l avg ${NAT_AVG.vehicle}%)`, 15);
  else if (r.insp.vehicle >= 3 && vr > NAT_AVG.vehicle) amber(`Vehicle OOS rate ${vr}% above nat'l avg ${NAT_AVG.vehicle}%`, 7);
  if (r.insp.driver >= 3 && dr > NAT_AVG.driver * 1.5) red(`Driver OOS rate ${dr}% (nat'l avg ${NAT_AVG.driver}%)`, 15);
  else if (r.insp.driver >= 3 && dr > NAT_AVG.driver) amber(`Driver OOS rate ${dr}% above nat'l avg ${NAT_AVG.driver}%`, 7);
  if (r.crashes.fatal > 0) red(`${r.crashes.fatal} fatal crash(es) in 24 months`, 15);
  if (r.crashes.injury > 0) amber(`${r.crashes.injury} injury crash(es) in 24 months`, 5);
  if (r.insp.total === 0 && (r.power_units ?? 0) > 0) amber("No inspections in 24 months", 5);
  if (r.bipd_required && (r.bipd_on_file ?? 0) < r.bipd_required) red("Liability insurance on file below requirement", 20);
  if ((r.power_units ?? 0) <= 1) amber("1 power unit or fewer", 3);
  score = Math.max(0, Math.min(100, score));
  const grade: CarrierCheckReport["grade"] = flags.some((f) => f.level === "red") || score < 60 ? "High risk" : score < 85 ? "Review" : "Low risk";
  return { score, grade, flags };
}
