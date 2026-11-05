import { lookupCarrierFull } from "./fmcsa.server";
import { scoreReport, type CarrierCheckReport, type InspRow, type CrashRow } from "./carrierCheck";

const SODA = "https://data.transportation.gov/resource";
async function soda<T>(id: string, q: Record<string, string>): Promise<T[]> {
  const r = await fetch(`${SODA}/${id}.json?${new URLSearchParams(q)}`, { headers: { Accept: "application/json" } });
  if (!r.ok) return [];
  return (await r.json()) as T[];
}
const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);
const OP: Record<string, string> = { A: "Interstate", B: "Intrastate hazmat", C: "Intrastate non-hazmat" };
const ENT: Record<string, string> = { C: "Carrier", S: "Shipper", B: "Carrier/Shipper" };

/** Builds the full vetting report from FMCSA QC/SAFER + public MCMIS datasets (census, inspections, crashes). */
export async function buildCarrierCheck(mc: string | null, dot: string | null, webkey: string | undefined): Promise<CarrierCheckReport> {
  const base = await lookupCarrierFull(mc, dot, webkey);
  const d = base.dot_number || dot;
  if (!d) throw new Error("No DOT number found for this carrier.");
  const since = new Date(Date.now() - 730 * 86400000).toISOString().slice(0, 10).replace(/-/g, "");
  const [cen, insps, crashes] = await Promise.all([
    soda<Record<string, string>>("az4n-8mr2", { dot_number: d, $limit: "1" }).then((x) => x[0] ?? {}),
    soda<Record<string, string>>("fx4q-ay7w", { dot_number: d, $where: `insp_date >= '${since}'`, $order: "insp_date DESC", $limit: "500",
      $select: "inspection_id,insp_date,report_state,insp_level_id,viol_total,oos_total,driver_oos_total,vehicle_oos_total,hazmat_oos_total,hazmat_viol_total" }),
    soda<Record<string, string>>("aayw-vxb3", { dot_number: d, $where: `report_date >= '${since}'`, $order: "report_date DESC", $limit: "200",
      $select: "report_date,report_state,city,fatalities,injuries,tow_away" }),
  ]);
  // Driver inspections: levels 1,2,3,6; vehicle: 1,2,5,6 (FMCSA convention).
  const lv = (r: Record<string, string>) => String(r["insp_level_id"] ?? "");
  const veh = insps.filter((r) => ["1", "2", "5", "6"].includes(lv(r)));
  const drv = insps.filter((r) => ["1", "2", "3", "6"].includes(lv(r)));
  const hz = insps.filter((r) => num(r["hazmat_viol_total"]) > 0 || num(r["hazmat_oos_total"]) > 0);
  const ids = insps.slice(0, 60).map((r) => `'${String(r["inspection_id"]).replace(/\D/g, "")}'`);
  const viols = ids.length ? await soda<Record<string, string>>("876r-jsdb", { $where: `inspection_id in (${ids.join(",")})`, $limit: "1000", $select: "viol_code,viol_desc,out_of_service_indicator" }) : [];
  const vmap = new Map<string, { code: string; desc: string; count: number; oos: number }>();
  for (const v of viols) {
    const k = v["viol_code"] ?? "?";
    const e = vmap.get(k) ?? { code: k, desc: v["viol_desc"] ?? "", count: 0, oos: 0 };
    e.count++; if (v["out_of_service_indicator"] === "Y") e.oos++;
    vmap.set(k, e);
  }
  const recent_inspections: InspRow[] = insps.slice(0, 25).map((r) => ({
    date: r["insp_date"] ?? "", state: r["report_state"] ?? "", level: lv(r), violations: num(r["viol_total"]), oos: num(r["oos_total"]),
    driver_oos: num(r["driver_oos_total"]), vehicle_oos: num(r["vehicle_oos_total"]), hazmat_oos: num(r["hazmat_oos_total"]),
  }));
  const recent_crashes: CrashRow[] = crashes.map((r) => ({
    date: (r["report_date"] ?? "").slice(0, 8), state: r["report_state"] ?? "", city: r["city"] ?? "",
    fatalities: num(r["fatalities"]), injuries: num(r["injuries"]), tow_away: r["tow_away"] === "Y",
  }));
  const cargo = Object.keys(cen).filter((k) => k.startsWith("crgo_") && !k.endsWith("_desc") && cen[k] === "X")
    .map((k) => (k === "crgo_cargoothr" ? cen["crgo_cargoothr_desc"] || "Other" : k.replace("crgo_", "").replace(/_/g, " ")));
  const rt: Record<string, string> = { C: "Compliance review", R: "Rating review", S: "Safety audit" };
  const partial: Omit<CarrierCheckReport, "score" | "grade" | "flags"> = {
    dot: d, mc: base.mc_number ?? (cen["docket1prefix"] === "MC" ? cen["docket1"] ?? null : null), generated_at: new Date().toISOString(),
    legal_name: base.legal_name || cen["legal_name"] || "", dba: base.dba ?? (cen["dba_name"] || null),
    status: cen["status_code"] === "A" ? "Active" : cen["status_code"] === "I" ? "Inactive" : cen["status_code"] ?? "—",
    authority_status: base.authority_status, safety_rating: base.safety_rating, safety_rating_date: cen["safety_rating_date"] ?? null,
    review: cen["review_type"] ? `${rt[cen["review_type"]] ?? cen["review_type"]} ${cen["review_date"] ?? ""}`.trim() : null,
    entity: ENT[cen["carship"] ?? ""] ?? null, operation: OP[cen["carrier_operation"] ?? ""] ?? null, classification: cen["classdef"] ?? null, cargo,
    address: [base.address, base.city, base.state, base.zip].filter(Boolean).join(", ") || null, mailing: base.mailing_address ?? null,
    phone: base.phone, email: base.email ?? null, contact: base.contact_name ?? null,
    added: cen["add_date"] ?? null, mcs150_date: cen["mcs150_date"] ?? null,
    mcs150_mileage: cen["mcs150_mileage"] && cen["mcs150_mileage"] !== "0" ? `${Number(cen["mcs150_mileage"]).toLocaleString()} (${cen["mcs150_mileage_year"]})` : null,
    power_units: base.power_units, drivers: base.drivers,
    owned_tractors: cen["owntract"] ? num(cen["owntract"]) : cen["owntruck"] ? num(cen["owntruck"]) : null, owned_trailers: cen["owntrail"] ? num(cen["owntrail"]) : null,
    hazmat: cen["hm_ind"] === "Y", interstate: cen["carrier_operation"] === "A",
    bipd_on_file: base.bipd_on_file, bipd_required: base.bipd_required, cargo_on_file: base.cargo_on_file,
    insp: { total: insps.length, vehicle: veh.length, driver: drv.length, hazmat: hz.length,
      vehicle_oos: veh.filter((r) => num(r["vehicle_oos_total"]) > 0).length, driver_oos: drv.filter((r) => num(r["driver_oos_total"]) > 0).length,
      hazmat_oos: hz.filter((r) => num(r["hazmat_oos_total"]) > 0).length, violations: insps.reduce((s, r) => s + num(r["viol_total"]), 0) },
    crashes: { total: recent_crashes.length, fatal: recent_crashes.filter((c) => c.fatalities > 0).length,
      injury: recent_crashes.filter((c) => c.injuries > 0).length, tow: recent_crashes.filter((c) => c.tow_away).length },
    recent_inspections, recent_crashes,
    top_violations: [...vmap.values()].sort((a, b) => b.count - a.count).slice(0, 10),
  };
  return { ...partial, ...scoreReport(partial) };
}
