import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { carrierAlertRecipients } from "./carrierAlerts";

/** Called only after a staff check or validation of an individual signing token. */
export async function postCarrierSafetyAlert(db: SupabaseClient<Database>, input: {
  senderId: string | null | undefined; brokerId?: string | null;
  source: "signing_risk" | "carrier_check"; body: string; loadId?: string | null;
}) {
  const { data: admins, error: rolesError } = await db.from("user_roles").select("user_id").eq("role", "admin");
  if (rolesError) throw rolesError;
  const recipients = carrierAlertRecipients(input.senderId, (admins ?? []).map((r) => r.user_id), input.brokerId);
  const authorId = input.senderId || input.brokerId || recipients[0];
  if (!authorId || !recipients.length) return;
  const { error } = await db.from("chat_mentions").insert(recipients.map((userId) => ({
    user_id: userId, author_id: authorId, source: input.source,
    body: input.body, load_id: input.loadId ?? null,
  })));
  if (error) throw error;
}