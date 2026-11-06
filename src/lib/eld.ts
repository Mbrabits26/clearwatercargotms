/** Normalizes ELD location/HOS pushes (Core ELD or any provider) into eld_positions rows. Pure — no I/O. */
export type EldPing = {
  unit: string; driver: string | null;
  lat: number | null; lng: number | null;
  speed_mph: number | null; heading: number | null; odometer: number | null;
  duty_status: string | null;
  drive_left_min: number | null; shift_left_min: number | null; cycle_left_min: number | null;
  recorded_at: string;
};

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const pick = (o: Record<string, unknown>, ...keys: string[]) => {
  for (const k of keys) if (o[k] != null && o[k] !== "") return o[k];
  return undefined;
};

const DUTY: Record<string, string> = { d: "driving", dr: "driving", driving: "driving", on: "on_duty", on_duty: "on_duty", onduty: "on_duty",
  sb: "sleeper", sleeper: "sleeper", off: "off_duty", off_duty: "off_duty", offduty: "off_duty", ym: "yard_move", pc: "personal_conveyance" };

export function normalizeDuty(v: unknown): string | null {
  if (v == null || v === "") return null;
  const k = String(v).toLowerCase().replace(/[\s-]+/g, "_");
  return DUTY[k] ?? DUTY[k.replace(/_/g, "")] ?? k;
}

/** Accepts one object, an array, or { data|vehicles|locations: [...] }. Drops entries without a unit or with impossible coordinates. */
export function parseEldPayload(body: unknown, now = new Date()): EldPing[] {
  const b = body as Record<string, unknown> | unknown[] | null;
  const list: unknown[] = Array.isArray(b) ? b
    : b && typeof b === "object" ? ((pick(b, "data", "vehicles", "locations", "items") as unknown[] | undefined) ?? [b]) : [];
  const out: EldPing[] = [];
  for (const raw of Array.isArray(list) ? list : []) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const loc = (o.location && typeof o.location === "object" ? o.location : o) as Record<string, unknown>;
    const unit = pick(o, "unit", "unit_number", "truck", "vehicle", "vehicle_number", "vehicle_id", "truck_number");
    if (unit == null) continue;
    let lat = num(pick(loc, "lat", "latitude")), lng = num(pick(loc, "lng", "lon", "long", "longitude"));
    if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) { lat = null; lng = null; }
    const t = pick(o, "time", "timestamp", "recorded_at", "located_at", "date_time");
    const d = t != null ? new Date(typeof t === "number" && t < 1e12 ? t * 1000 : (t as string)) : now;
    const hos = (o.hos && typeof o.hos === "object" ? o.hos : o) as Record<string, unknown>;
    out.push({
      unit: String(unit).trim(),
      driver: (pick(o, "driver", "driver_name", "driver_id") as string | undefined)?.toString().trim() || null,
      lat, lng,
      speed_mph: num(pick(loc, "speed_mph", "speed")), heading: num(pick(loc, "heading", "bearing")), odometer: num(pick(o, "odometer", "odometer_miles")),
      duty_status: normalizeDuty(pick(o, "duty_status", "status", "duty")),
      drive_left_min: num(pick(hos, "drive_left_min", "drive_remaining", "driving_left")),
      shift_left_min: num(pick(hos, "shift_left_min", "shift_remaining", "on_duty_left")),
      cycle_left_min: num(pick(hos, "cycle_left_min", "cycle_remaining")),
      recorded_at: Number.isNaN(d.getTime()) ? now.toISOString() : d.toISOString(),
    });
  }
  return out;
}

export const sameId = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.replace(/\s+/g, "").toLowerCase() === b.replace(/\s+/g, "").toLowerCase();

export const fmtMin = (m: number | null) => (m == null ? "—" : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`);
