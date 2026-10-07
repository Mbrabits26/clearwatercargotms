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
  const v = clean(m[1]);
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
    safety_rating: rating ? clean(rating[1]) || null : null,
  };
}
