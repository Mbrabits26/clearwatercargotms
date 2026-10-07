// Free fallback: FMCSA SAFER Company Snapshot (public HTML), parsed with regex.
export type FmcsaResult = {
  legal_name: string; dba: string | null; dot_number: string; mc_number: string | null;
  address: string | null; city: string | null; state: string | null; zip: string | null; phone: string | null;
  authority_status: "Authorized" | "Inactive" | "Revoked"; allowed_to_operate: boolean;
  safety_rating: string; power_units: number | null; drivers: number | null;
  bipd_on_file: number | null; bipd_required: number | null; cargo_on_file: number | null;
  out_of_service: boolean; warnings: string[];
  source: "FMCSA" | "SAFER" | "blocked"; safer_url: string;
  email?: string | null; contact_name?: string | null; cell_phone?: string | null; fax?: string | null; mailing_address?: string | null;
};

const QC_BASE = "https://mobile.fmcsa.dot.gov/qc/services";
const RATING: Record<string, string> = { S: "Satisfactory", C: "Conditional", U: "Unsatisfactory" };

async function qcGet(path: string, key: string) {
  const r = await fetch(`${QC_BASE}${path}${path.includes("?") ? "&" : "?"}webKey=${key}`, { headers: { Accept: "application/json" } });
  if (r.status === 403 || r.status === 401) {
    const ct = r.headers.get("content-type") ?? "";
    throw new Error(ct.includes("json") ? "FMCSA rejected the web key." : "BLOCKED");
  }
  if (!r.ok) throw new Error(`FMCSA lookup failed (${r.status}).`);
  return r.json() as Promise<{ content: unknown }>;
}

export async function qcLookup(mc: string | null, dotIn: string | null, key: string): Promise<Omit<FmcsaResult, "source" | "safer_url">> {
  let dot = dotIn;
  if (!dot && mc) {
    const res = await qcGet(`/carriers/docket-number/${mc}`, key);
    const list = (Array.isArray(res.content) ? res.content : [res.content]) as { carrier?: { dotNumber?: number } }[];
    const found = list.find((x) => x?.carrier?.dotNumber)?.carrier?.dotNumber;
    if (!found) throw new Error(`No carrier found for MC ${mc}.`);
    dot = String(found);
  }
  const base = await qcGet(`/carriers/${dot}`, key);
  const c = (base.content as { carrier?: Record<string, unknown> } | null)?.carrier;
  if (!c) throw new Error(`No carrier found for DOT ${dot}.`);
  const [auth, dockets] = await Promise.all([
    qcGet(`/carriers/${dot}/authority`, key).catch(() => null),
    mc ? null : qcGet(`/carriers/${dot}/mc-numbers`, key).catch(() => null),
  ]);
  const authRows = ((auth?.content as { carrierAuthority?: Record<string, string> }[] | undefined) ?? []).map((a) => a.carrierAuthority ?? {});
  const anyActive = authRows.some((a) => a.commonAuthorityStatus === "A" || a.contractAuthorityStatus === "A");
  const anyRevoked = authRows.some((a) => a.commonAuthorityStatus === "I" || a.authorizedForHire === "N");
  const mcFound = ((dockets?.content as { docketNumber?: number; prefix?: string }[] | undefined) ?? []).find((d) => d.prefix === "MC")?.docketNumber;
  const docket = mc ?? (mcFound ? String(mcFound) : null);
  const allowed = c["allowedToOperate"] === "Y";
  const oos = !!c["oosDate"];
  const n = (k: string) => (c[k] == null || c[k] === "" ? null : Number(c[k]));
  const bipdOn = n("bipdInsuranceOnFile"), bipdReq = n("bipdInsuranceRequired");
  const authority_status: FmcsaResult["authority_status"] = allowed && (anyActive || !authRows.length) ? "Authorized" : anyRevoked ? "Revoked" : "Inactive";
  const warnings: string[] = [];
  if (!allowed) warnings.push("Not allowed to operate per FMCSA");
  if (oos) warnings.push(`Out-of-service order (${c["oosDate"]})`);
  if (authRows.length && !anyActive) warnings.push("No active common/contract authority");
  if (bipdReq && (bipdOn ?? 0) < bipdReq) warnings.push("Liability insurance on file below FMCSA requirement");
  if (c["safetyRating"] === "U") warnings.push("Unsatisfactory safety rating");
  return {
    legal_name: String(c["legalName"] ?? ""), dba: (c["dbaName"] as string) || null,
    dot_number: String(dot), mc_number: docket,
    address: (c["phyStreet"] as string) || null, city: (c["phyCity"] as string) || null,
    state: (c["phyState"] as string) || null, zip: (c["phyZipcode"] as string) || null, phone: (c["telephone"] as string) || null,
    authority_status, allowed_to_operate: allowed,
    safety_rating: RATING[String(c["safetyRating"] ?? "")] ?? "Not Rated",
    power_units: n("totalPowerUnits"), drivers: n("totalDrivers"),
    bipd_on_file: bipdOn != null ? bipdOn * 1000 : null, bipd_required: bipdReq != null ? bipdReq * 1000 : null,
    cargo_on_file: n("cargoInsuranceOnFile") != null ? n("cargoInsuranceOnFile")! * 1000 : null,
    out_of_service: oos, warnings,
  };
}

/** Full lookup chain shared by the manual button and the weekly re-check: FMCSA QC → SAFER → census. */
export async function lookupCarrierFull(mcIn: string | null, dotIn: string | null, webkey: string | undefined): Promise<FmcsaResult> {
  const mc = mcIn?.replace(/\D/g, "") || null;
  const dot = dotIn?.replace(/\D/g, "") || null;
  if (!mc && !dot) throw new Error("Enter an MC # or DOT #.");
  const url = dot ? saferUrl("dot", dot) : saferUrl("mc", mc!);
  let out: FmcsaResult | null = null;
  if (webkey) {
    try { out = { ...(await qcLookup(mc, dot, webkey)), source: "FMCSA", safer_url: url }; }
    catch (e) { if (!(e instanceof Error) || (e.message !== "BLOCKED" && !e.message.startsWith("FMCSA lookup failed"))) throw e; }
  }
  if (!out) {
    const s = await fetchSafer(dot ? "dot" : "mc", (dot ?? mc)!);
    if (s === null) throw new Error(`No carrier found for ${dot ? "DOT " + dot : "MC " + mc}.`);
    if (s === "blocked") {
      return { legal_name: "", dba: null, dot_number: dot ?? "", mc_number: mc, address: null, city: null, state: null, zip: null, phone: null,
        authority_status: "Inactive", allowed_to_operate: false, safety_rating: "Not Rated", power_units: null, drivers: null,
        bipd_on_file: null, bipd_required: null, cargo_on_file: null, out_of_service: false,
        warnings: ["FMCSA blocked the automatic lookup — use Open in SAFER to check by hand."], source: "blocked", safer_url: url };
    }
    const st = s.operating_status.toUpperCase();
    const authorized = st.includes("AUTHORIZED") && !st.includes("NOT AUTHORIZED");
    const warnings: string[] = [];
    if (!authorized) warnings.push(`Operating status: ${s.operating_status}`);
    if (s.oos_date) warnings.push(`Out-of-service order (${s.oos_date})`);
    if (s.safety_rating?.toUpperCase().startsWith("UNSAT")) warnings.push("Unsatisfactory safety rating");
    out = { legal_name: s.legal_name, dba: s.dba, dot_number: s.dot_number ?? dot ?? "", mc_number: s.mc_number ?? mc,
      address: s.address, city: s.city, state: s.state, zip: s.zip, phone: s.phone,
      authority_status: authorized ? "Authorized" : st.includes("REVOKED") ? "Revoked" : "Inactive", allowed_to_operate: authorized,
      safety_rating: s.safety_rating && s.safety_rating !== "" ? s.safety_rating : "Not Rated",
      power_units: s.power_units, drivers: s.drivers, bipd_on_file: null, bipd_required: null, cargo_on_file: null,
      out_of_service: !!s.oos_date, warnings, source: "SAFER", safer_url: url };
  }
  const cen = out.dot_number ? await fetchCensus(out.dot_number) : null;
  if (cen) {
    const o = out;
    out = { ...o, legal_name: o.legal_name || cen.legal_name || "", dba: o.dba ?? cen.dba,
      address: o.address ?? cen.address, city: o.city ?? cen.city, state: o.state ?? cen.state, zip: o.zip ?? cen.zip,
      phone: o.phone ?? cen.phone ?? cen.cell_phone, email: cen.email, contact_name: cen.contact_name,
      cell_phone: cen.cell_phone, fax: cen.fax, mailing_address: cen.mailing_address,
      power_units: o.power_units ?? cen.power_units, drivers: o.drivers ?? cen.drivers };
  }
  return out;
}

export type SaferResult = {
  legal_name: string; dba: string | null; dot_number: string | null; mc_number: string | null;
  address: string | null; city: string | null; state: string | null; zip: string | null; phone: string | null;
  operating_status: string; oos_date: string | null; power_units: number | null; drivers: number | null;
  safety_rating: string | null;
};

const clean = (s: string) =>
  s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/[ \t]+/g, " ").trim();

function field(html: string, label: string): string | null {
  const re = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[\\s\\S]*?<td[^>]*>([\\s\\S]*?)</td>", "i");
  const m = html.match(re);
  if (!m) return null;
  const v = clean(m[1] ?? "");
  return v && v !== "None" ? v : null;
}

export function saferUrl(kind: "dot" | "mc", id: string) {
  const p = kind === "dot" ? "USDOT" : "MC_MX";
  return `https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=${p}&query_string=${encodeURIComponent(id)}`;
}

export async function fetchSafer(kind: "dot" | "mc", id: string): Promise<SaferResult | "blocked" | null> {
  const r = await fetch(saferUrl(kind, id), { headers: { "User-Agent": "Mozilla/5.0 (ClearwaterCargo TMS)", Accept: "text/html" } });
  if (r.status === 403 || r.status === 401) return "blocked";
  if (!r.ok) throw new Error(`SAFER lookup failed (${r.status}).`);
  const html = await r.text();
  if (/Record Not Found|Record Inactive/i.test(html) || !/Legal Name/i.test(html)) return null;
  const addr = field(html, "Physical Address:") ?? "";
  const [street, cityLine] = addr.split("\n").map((s) => s.trim()).filter(Boolean);
  const cm = cityLine?.match(/^(.*?),\s*([A-Z]{2})\s+([\d-]+)/);
  const num = (s: string | null) => (s ? Number(s.replace(/\D/g, "")) || null : null);
  const mcRaw = field(html, "MC/MX/FF Number(s):");
  const rating = html.match(/Rating:[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/i);
  return {
    legal_name: field(html, "Legal Name:") ?? "",
    dba: field(html, "DBA Name:"),
    dot_number: field(html, "USDOT Number:")?.replace(/\D/g, "") || null,
    mc_number: mcRaw?.match(/MC-(\d+)/)?.[1] ?? null,
    address: street ?? null, city: cm?.[1] ?? null, state: cm?.[2] ?? null, zip: cm?.[3] ?? null,
    phone: field(html, "Phone:"),
    operating_status: field(html, "Operating Authority Status:") ?? field(html, "Operating Status:") ?? "Unknown",
    oos_date: field(html, "Out of Service Date:"),
    power_units: num(field(html, "Power Units:")),
    drivers: num(field(html, "Drivers:")),
    safety_rating: rating ? clean(rating[1] ?? "") || null : null,
  };
}

export type CensusResult = {
  email: string | null; contact_name: string | null; phone: string | null; cell_phone: string | null; fax: string | null;
  mailing_address: string | null; address: string | null; city: string | null; state: string | null; zip: string | null;
  legal_name: string | null; dba: string | null; power_units: number | null; drivers: number | null;
};

/** Free FMCSA Company Census file (data.transportation.gov) — has email, officer and phones. */
export async function fetchCensus(dot: string): Promise<CensusResult | null> {
  try {
    const r = await fetch(`https://data.transportation.gov/resource/az4n-8mr2.json?dot_number=${encodeURIComponent(dot)}&$limit=1`, { headers: { Accept: "application/json" } });
    if (!r.ok) return null;
    const [c] = (await r.json()) as Record<string, string | undefined>[];
    if (!c) return null;
    const v = (k: string) => (c[k] && c[k]!.trim() ? c[k]!.trim() : null);
    const ph = (k: string) => { const d = (v(k) ?? "").replace(/\D/g, ""); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : v(k); };
    const n = (k: string) => (v(k) ? Number(v(k)) : null);
    const mail = [v("carrier_mailing_street"), v("carrier_mailing_city"), v("carrier_mailing_state"), v("carrier_mailing_zip")].filter(Boolean).join(", ");
    return {
      email: v("email_address")?.toLowerCase() ?? null, contact_name: v("company_officer_1"),
      phone: ph("phone"), cell_phone: ph("cell_phone"), fax: ph("fax"), mailing_address: mail || null,
      address: v("phy_street"), city: v("phy_city"), state: v("phy_state"), zip: v("phy_zip")?.slice(0, 5) ?? null,
      legal_name: v("legal_name"), dba: v("dba_name"), power_units: n("power_units"), drivers: n("total_drivers"),
    };
  } catch { return null; }
}
