/** Reverse geocode a GPS point to "Near City, ST · Route" via the Google Maps connector gateway. Returns null on any failure. */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const lov = process.env["LOVABLE_API_KEY"];
  const key = process.env["GOOGLE_MAPS_API_KEY"];
  if (!lov || !key) return null;
  try {
    const r = await fetch(`https://connector-gateway.lovable.dev/google_maps/maps/api/geocode/json?latlng=${lat},${lng}`, {
      headers: { Authorization: `Bearer ${lov}`, "X-Connection-Api-Key": key },
    });
    if (!r.ok) { console.error("geocode", r.status, await r.text()); return null; }
    const j = (await r.json()) as { status: string; results?: { address_components: { long_name: string; short_name: string; types: string[] }[] }[] };
    if (j.status !== "OK" || !j.results?.length) return null;
    const comps = j.results.flatMap((x) => x.address_components);
    const get = (t: string, short = false) => { const c = comps.find((x) => x.types.includes(t)); return c ? (short ? c.short_name : c.long_name) : null; };
    const city = get("locality") ?? get("postal_town") ?? get("administrative_area_level_3") ?? get("administrative_area_level_2");
    const st = get("administrative_area_level_1", true);
    const route = get("route", true);
    if (!city && !st) return null;
    return `Near ${[city, st].filter(Boolean).join(", ")}${route ? ` · ${route}` : ""}`;
  } catch (e) { console.error(e); return null; }
}
