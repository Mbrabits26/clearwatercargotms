import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GW = "https://connector-gateway.lovable.dev/google_maps/places/v1";

function creds() {
  const lov = process.env["LOVABLE_API_KEY"];
  const key = process.env["GOOGLE_MAPS_API_KEY"];
  if (!lov || !key) throw new Error("Google address lookup is not connected");
  return { Authorization: `Bearer ${lov}`, "X-Connection-Api-Key": key };
}

async function check(r: Response) {
  if (r.ok) return r.json();
  const body = await r.text();
  console.error("places", r.status, body);
  throw new Error(`Address lookup failed (${r.status})`);
}

export const placesAutocomplete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ input: z.string().trim().min(3).max(200), sessionToken: z.string().max(64) }).parse(d))
  .handler(async ({ data }) => {
    const r = await fetch(`${GW}/places:autocomplete`, {
      method: "POST",
      headers: { ...creds(), "Content-Type": "application/json", "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text" },
      body: JSON.stringify({ input: data.input, sessionToken: data.sessionToken, includedRegionCodes: ["us", "ca", "mx"], locationBias: { circle: { center: { latitude: 35.78, longitude: -79.6 }, radius: 50000 } } }),
    });
    const j = (await check(r)) as { suggestions?: { placePrediction?: { placeId: string; text: { text: string } } }[] };
    return (j.suggestions ?? []).flatMap((s) => (s.placePrediction ? [{ id: s.placePrediction.placeId, text: s.placePrediction.text.text }] : []));
  });

export const placeDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ placeId: z.string().regex(/^[A-Za-z0-9_-]{5,300}$/), sessionToken: z.string().max(64) }).parse(d))
  .handler(async ({ data }) => {
    const r = await fetch(`${GW}/places/${data.placeId}?sessionToken=${encodeURIComponent(data.sessionToken)}`, {
      headers: { ...creds(), "X-Goog-FieldMask": "displayName,addressComponents,nationalPhoneNumber,types" },
    });
    const j = (await check(r)) as { displayName?: { text: string }; nationalPhoneNumber?: string; types?: string[]; addressComponents?: { longText: string; shortText: string; types: string[] }[] };
    const comps = j.addressComponents ?? [];
    const get = (t: string, short = false) => { const c = comps.find((x) => x.types.includes(t)); return c ? (short ? c.shortText : c.longText) : ""; };
    const street = [get("street_number"), get("route", true)].filter(Boolean).join(" ");
    const isBusiness = !(j.types ?? []).some((t) => ["street_address", "premise", "route", "subpremise"].includes(t));
    return {
      name: isBusiness ? j.displayName?.text ?? "" : "",
      phone: j.nationalPhoneNumber ?? "",
      address: street,
      city: get("locality") || get("postal_town") || get("sublocality") || get("administrative_area_level_3"),
      state: get("administrative_area_level_1", true),
      zip: get("postal_code"),
    };
  });
