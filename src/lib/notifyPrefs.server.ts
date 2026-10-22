export type EmailPref = "email_driver_status" | "email_driver_docs" | "email_ratecon_signed";

/** True unless the user turned this email alert off (no saved row = all on). */
export async function wantsEmail(supabaseAdmin: any, userId: string | null | undefined, pref: EmailPref): Promise<boolean> {
  if (!userId) return true;
  const { data } = await supabaseAdmin.from("notification_prefs").select(pref).eq("user_id", userId).maybeSingle();
  return data ? data[pref] !== false : true;
}

export async function wantsEmailByAddress(supabaseAdmin: any, email: string, pref: EmailPref): Promise<boolean> {
  const { data } = await supabaseAdmin.from("profiles").select("id").ilike("email", email).maybeSingle();
  return wantsEmail(supabaseAdmin, data?.id, pref);
}

const SITE = "https://tms.clearwatercargo.com";

/** Email the load's broker about a driver tracking update, if they want it. */
export async function emailDriverUpdate(supabaseAdmin: any, tk: any, pref: "email_driver_status" | "email_driver_docs", info: { what: string; note?: string | null; place?: string | null; key: string }) {
  try {
    const { data: load } = await supabaseAdmin.from("loads")
      .select("load_number, broker_id, origin_city, origin_state, dest_city, dest_state").eq("id", tk.load_id).maybeSingle();
    if (!load) return;
    const brokerId = load.broker_id ?? tk.created_by;
    if (!brokerId || !(await wantsEmail(supabaseAdmin, brokerId, pref))) return;
    const { data: p } = await supabaseAdmin.from("profiles").select("email").eq("id", brokerId).maybeSingle();
    if (!p?.email) return;
    const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
    await sendTemplateEmail("driver-update", p.email, {
      templateData: {
        loadNumber: load.load_number,
        lane: `${load.origin_city ?? ""}, ${load.origin_state ?? ""} → ${load.dest_city ?? ""}, ${load.dest_state ?? ""}`,
        driver: tk.driver_name ?? undefined,
        what: info.what, note: info.note ?? undefined, place: info.place ?? undefined,
        at: new Date().toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }) + " ET",
        loadUrl: `${SITE}/dispatch`,
      },
      idempotencyKey: `driver-update-${info.key}`,
    });
  } catch (e) {
    console.error("driver update email failed", e);
  }
}
