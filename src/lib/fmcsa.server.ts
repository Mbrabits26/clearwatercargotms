// Free fallback: FMCSA SAFER Company Snapshot (public HTML), parsed with regex.
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
