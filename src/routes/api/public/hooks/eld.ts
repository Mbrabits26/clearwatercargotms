import { createFileRoute } from "@tanstack/react-router";
import { parseEldPayload, sameId } from "@/lib/eld";

/** ELD location/HOS push (Core ELD). Caller must send the CORE_ELD_API_KEY as Bearer, X-Api-Key, or ?key=. */
function authorized(request: Request) {
  const expected = process.env["CORE_ELD_API_KEY"];
  if (!expected) return false;
  const url = new URL(request.url);
  const got = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1]
    ?? request.headers.get("x-api-key") ?? url.searchParams.get("key");
  if (!got || got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export const Route = createFileRoute("/api/public/hooks/eld")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
        let body: unknown;
        try { body = await request.json(); } catch { return Response.json({ error: "invalid json" }, { status: 400 }); }
        const pings = parseEldPayload(body).slice(0, 500);
        if (!pings.length) return Response.json({ saved: 0 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const [{ data: units }, { data: drivers }] = await Promise.all([
          supabaseAdmin.from("fleet_units").select("id, unit_number, eld_id").eq("kind", "truck"),
          supabaseAdmin.from("drivers").select("id, full_name, eld_id"),
        ]);
        const rows = pings.map((p) => {
          const u = (units ?? []).find((x) => sameId(x.eld_id, p.unit)) ?? (units ?? []).find((x) => sameId(x.unit_number, p.unit));
          const d = p.driver ? (drivers ?? []).find((x) => sameId(x.eld_id, p.driver) || sameId(x.full_name, p.driver)) : undefined;
          return { unit_id: u?.id ?? null, driver_id: d?.id ?? null, eld_unit: p.unit, eld_driver: p.driver, lat: p.lat, lng: p.lng,
            speed_mph: p.speed_mph, heading: p.heading, odometer: p.odometer, duty_status: p.duty_status,
            drive_left_min: p.drive_left_min, shift_left_min: p.shift_left_min, cycle_left_min: p.cycle_left_min, recorded_at: p.recorded_at };
        });
        const { error } = await supabaseAdmin.from("eld_positions").insert(rows);
        if (error) { console.error("eld insert", error); return Response.json({ error: "save failed" }, { status: 500 }); }
        return Response.json({ saved: rows.length, unmatched: rows.filter((r) => !r.unit_id).map((r) => r.eld_unit) });
      },
    },
  },
});
