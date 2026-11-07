import { appUserReconnectRequired, callAsAppUser } from "@/integrations/lovable/appUserConnector";
import { getConnectionKeyForUser } from "@/server/appUserConnections.server";

const GATEWAY_BASE_URL = "https://connector-gateway.lovable.dev";
const CONNECTOR_ID = "google_mail";
/** Reading the saved Gmail signature needs this scope; granted at connect, but older connections may lack it. */
export const GMAIL_SETTINGS_SCOPE = "https://www.googleapis.com/auth/gmail.settings.basic";

const CACHE_DAYS = 7;
const NEG_CACHE_HOURS = 12;

/** Gmail stores signatures as HTML; outgoing TMS mail is plain text. */
export function signatureHtmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*(div|p|tr|table|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The sender's own Gmail signature as plain text, cached so we don't call Gmail on every send.
 * Returns null when Gmail is not connected, the connection lacks the settings scope (older
 * connections — a reconnect grants it), or the account has no signature. Callers fall back
 * to their built-in signature or none.
 */
export async function getGmailSignatureText(userId: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const ck = `gmailsig:${userId}`;
  const { data: hit } = await supabaseAdmin.from("market_rate_cache").select("result, fetched_at").eq("key", ck).maybeSingle();
  if (hit?.fetched_at) {
    const ageH = (Date.now() - new Date(hit.fetched_at).getTime()) / 3600_000;
    const cached = (hit.result as { signature?: string | null } | null)?.signature ?? null;
    if (cached && ageH < CACHE_DAYS * 24) return cached;
    if (!cached && ageH < NEG_CACHE_HOURS) return null;
  }

  const key = await getConnectionKeyForUser(userId, CONNECTOR_ID);
  if (!key) return null;
  const res = await callAsAppUser({
    gatewayBaseUrl: GATEWAY_BASE_URL,
    connectionAPIKey: key,
    connectorId: CONNECTOR_ID,
    path: "/gmail/v1/users/me/settings/sendAs",
    requiredScopes: [GMAIL_SETTINGS_SCOPE],
  });
  if (await appUserReconnectRequired(res)) return null;
  if (!res.ok) {
    console.error(`Gmail signature read failed [${res.status}]: ${await res.text().catch(() => "")}`);
    return null;
  }
  const data = (await res.json()) as { sendAs?: { isPrimary?: boolean; isDefault?: boolean; signature?: string }[] };
  const list = data.sendAs ?? [];
  const primary = list.find((s) => s.isPrimary) ?? list.find((s) => s.isDefault) ?? list[0];
  const signature = primary?.signature ? signatureHtmlToText(primary.signature) : null;

  await supabaseAdmin.from("market_rate_cache").upsert([{ key: ck, result: { signature } as never, fetched_at: new Date().toISOString() }]);
  return signature || null;
}
