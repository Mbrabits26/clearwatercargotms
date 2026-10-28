import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const tokenSchema = z.object({ token: z.string().uuid() });

type Admin = typeof import("@/integrations/supabase/client.server")["supabaseAdmin"];

/** Move the load to Delivered if a signed POD is on file (see podAutoDeliver.ts). Returns true when it changed. */
async function autoDeliverIfPod(admin: Admin, tk: { load_id: string; created_by: string | null }, why: string) {
  const { shouldAutoDeliver } = await import("./podAutoDeliver");
  const { data: load } = await admin.from("loads")
    .select("status, pod_received, customer_id, carrier_id, truck_id, closed_at").eq("id", tk.load_id).single();
  if (!load || !shouldAutoDeliver(load)) return false;
  const { data: upd, error } = await admin.from("loads").update({ status: "delivered" })
    .eq("id", tk.load_id).eq("status", load.status).select("id");
  if (error || !upd?.length) { if (error) console.error(error); return false; }
  await admin.from("load_notes").insert({
    load_id: tk.load_id,
    author_id: tk.created_by ?? undefined,
    body: `Status changed: ${load.status} → delivered (automatic — signed POD on file, ${why} via driver link)`,
  });
  return true;
}


/** A link stops working for good once the load is delivered (or later) with a signed POD on file, or cancelled. */
export function trackingFinished(load: { status: string; pod_received: boolean | null } | null): boolean {
  if (!load) return false;
  if (load.status === "cancelled") return true;
  return !!load.pod_received && ["delivered", "invoiced", "paid"].includes(load.status);
}

const COMPLETED = "Tracking for this load has ended — it was delivered and the signed POD is on file. This link is no longer valid.";

async function loadToken(token: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: tk } = await supabaseAdmin.from("load_tracking_tokens").select("*").eq("token", token).maybeSingle();
  let problem: string | null = null;
  let completed = false;
  if (!tk) problem = "This tracking link is not valid.";
  else if (tk.status === "completed") { problem = COMPLETED; completed = true; }
  else if (tk.status === "void") problem = "This tracking link was cancelled. Contact Clearwater Cargo for a new one.";
  else if (new Date(tk.expires_at) < new Date()) problem = "This tracking link has expired. Contact Clearwater Cargo for a new one.";
  else {
    const { data: load } = await supabaseAdmin.from("loads").select("status, pod_received").eq("id", tk.load_id).maybeSingle();
    if (trackingFinished(load)) {
      await closeLinks(supabaseAdmin, tk.load_id);
      problem = COMPLETED; completed = true;
    }
  }
  return { supabaseAdmin, tk, problem, completed };
}

/** Permanently end every open tracking link on a load. */
async function closeLinks(admin: Admin, loadId: string) {
  const { error } = await admin.from("load_tracking_tokens").update({ status: "completed" }).eq("load_id", loadId).eq("status", "active");
  if (error) await admin.from("load_tracking_tokens").update({ status: "void" }).eq("load_id", loadId).eq("status", "active");
}

export const getTracking = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => tokenSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin, tk, problem, completed } = await loadToken(data.token);
    if (problem || !tk) return { ok: false as const, problem: problem ?? "Invalid link", completed };
    const { data: load } = await supabaseAdmin
      .from("loads")
      .select("id, load_number, status, origin_city, origin_state, dest_city, dest_state, pickup_at, delivery_at, commodity, equipment")
      .eq("id", tk.load_id)
      .single();
    if (!load) return { ok: false as const, problem: "Load not found.", completed: false };
    return { ok: true as const, load, driverName: tk.driver_name };
  });

const pingSchema = tokenSchema.extend({
  kind: z.enum(["location", "status"]),
  status: z.string().max(60).optional(),
  note: z.string().trim().max(500).optional(),
  lat: z.number().min(-90).max(90).nullish(),
  lng: z.number().min(-180).max(180).nullish(),
});

export const postPing = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => pingSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin, tk, problem } = await loadToken(data.token);
    if (problem || !tk) return { ok: false as const, problem: problem ?? "Invalid link" };
    if (data.lat == null || data.lng == null) return { ok: false as const, problem: "Location is required. Turn on Location for this page, then try again." };
    const { reverseGeocode } = await import("./geocode.server");
    const place = data.lat != null && data.lng != null ? await reverseGeocode(data.lat, data.lng) : null;
    const { data: ping, error } = await supabaseAdmin.from("load_tracking_pings").insert({
      place,
      load_id: tk.load_id,
      token_id: tk.id,
      kind: data.kind,
      status: data.status ?? null,
      note: data.note || null,
      lat: data.lat ?? null,
      lng: data.lng ?? null,
    }).select("id").single();
    if (error) return { ok: false as const, problem: "Could not save the update. Please try again." };
    await supabaseAdmin.from("loads").update({ last_check_call: new Date().toISOString() }).eq("id", tk.load_id);
    let delivered = false;
    let needsPod = false;
    if (data.kind === "status") {
      const label = data.status ?? "Update";
      const who = tk.driver_name ? `${tk.driver_name}: ` : "";
      await supabaseAdmin.from("load_notes").insert({
        load_id: tk.load_id,
        author_id: tk.created_by ?? undefined,
        body: `Driver update — ${who}${label}${data.note ? ` — ${data.note}` : ""}${place ? ` — ${place}` : ""}`,
      });
      if (label === "Delivered") {
        delivered = await autoDeliverIfPod(supabaseAdmin, tk, "driver marked Delivered");
        if (!delivered) {
          const { data: l } = await supabaseAdmin.from("loads").select("pod_received").eq("id", tk.load_id).single();
          needsPod = !l?.pod_received;
        }
      }
      const { emailDriverUpdate } = await import("./notifyPrefs.server");
      await emailDriverUpdate(supabaseAdmin, tk, "email_driver_status", {
        what: `Status: ${label}${delivered ? " — load marked Delivered" : ""}`,
        note: data.note, place, key: ping?.id ?? crypto.randomUUID(),
      });
    }
    if (delivered) await closeLinks(supabaseAdmin, tk.load_id);
    return { ok: true as const, delivered, needsPod };
  });

export const uploadTrackingDoc = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    tokenSchema.extend({
      kind: z.enum(["pod", "bol"]),
      fileName: z.string().min(1).max(200),
      base64: z.string().min(50).max(14_000_000),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin, tk, problem } = await loadToken(data.token);
    if (problem || !tk) return { ok: false as const, problem: problem ?? "Invalid link" };
    const safe = data.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
    const path = `${tk.load_id}/${data.kind}-${Date.now()}-${safe}`;
    const { error } = await supabaseAdmin.storage
      .from("load-docs")
      .upload(path, Buffer.from(data.base64, "base64"), { contentType: "application/octet-stream" });
    if (error) { console.error(error); return { ok: false as const, problem: "Could not save the document. Please try again." }; }
    if (data.kind === "pod") {
      await supabaseAdmin.from("loads").update({ pod_received: true, last_check_call: new Date().toISOString() }).eq("id", tk.load_id);
    }
    await supabaseAdmin.from("load_notes").insert({
      load_id: tk.load_id,
      author_id: tk.created_by ?? undefined,
      body: `Driver uploaded ${data.kind === "pod" ? "POD" : "BOL"}: ${data.fileName}`,
    });
    const delivered = data.kind === "pod" ? await autoDeliverIfPod(supabaseAdmin, tk, "POD uploaded") : false;
    const { emailDriverUpdate } = await import("./notifyPrefs.server");
    await emailDriverUpdate(supabaseAdmin, tk, "email_driver_docs", {
      what: `${data.kind === "pod" ? "POD" : "BOL"} uploaded: ${data.fileName}${delivered ? " — load marked Delivered" : ""}`,
      key: path,
    });
    if (delivered) await closeLinks(supabaseAdmin, tk.load_id);
    else if (data.kind === "pod") {
      const { data: l } = await supabaseAdmin.from("loads").select("status, pod_received").eq("id", tk.load_id).single();
      if (trackingFinished(l)) await closeLinks(supabaseAdmin, tk.load_id);
    }
    return { ok: true as const, delivered };
  });

/** Staff-only: fill in place names for older pings that only have coordinates (max 50 per call). */
export const backfillPingPlaces = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ loadId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: staff } = await context.supabase.rpc("is_staff", { _uid: context.userId });
    if (!staff) throw new Error("Forbidden");
    const { data: rows } = await context.supabase.from("load_tracking_pings").select("id, lat, lng")
      .eq("load_id", data.loadId).is("place", null).not("lat", "is", null).limit(50);
    if (!rows?.length) return { updated: 0 };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { reverseGeocode } = await import("./geocode.server");
    let updated = 0;
    for (const r of rows) {
      const place = await reverseGeocode(Number(r.lat), Number(r.lng));
      if (place) { await supabaseAdmin.from("load_tracking_pings").update({ place }).eq("id", r.id); updated++; }
    }
    return { updated };
  });

/** Staff-only: coordinates for the pickup and delivery cities, for the tracking map. */
export const getLanePoints = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ origin: z.string().max(120), dest: z.string().max(120) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: staff } = await context.supabase.rpc("is_staff", { _uid: context.userId });
    if (!staff) throw new Error("Forbidden");
    const { geocodeCity } = await import("./geocode.server");
    const [o, d] = await Promise.all([geocodeCity(data.origin), geocodeCity(data.dest)]);
    return { origin: o, dest: d };
  });
