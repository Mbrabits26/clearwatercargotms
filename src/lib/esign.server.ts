import { getRequest, getRequestHeader } from "@tanstack/react-start/server";
import { assessIp } from "./ipRisk";

/** Client IP, device, country and network from the signing request (Cloudflare request data when available). */
export function requestSigner() {
  const ip = (getRequestHeader("cf-connecting-ip") || getRequestHeader("x-real-ip") || getRequestHeader("x-forwarded-for") || "").split(",")[0]?.trim() || null;
  const ua = getRequestHeader("user-agent")?.slice(0, 500) || null;
  let cf: { country?: string; asOrganization?: string; asn?: number } | undefined;
  try { cf = (getRequest() as unknown as { cf?: typeof cf }).cf; } catch { cf = undefined; }
  const country = cf?.country || getRequestHeader("cf-ipcountry") || null;
  const network = cf?.asOrganization ? `${cf.asOrganization}${cf.asn ? ` (AS${cf.asn})` : ""}` : null;
  return { ip, ua, ...assessIp(country, network) };
}

/** Post a Team chat warning when a signature came from a risky IP. */
export async function postIpRiskNotice(supabaseAdmin: any, authorId: string | null | undefined, what: string, risk: string | null, ip: string | null) {
  if (!risk || !authorId) return;
  try {
    await supabaseAdmin.from("chat_messages").insert({
      channel: "team", author_id: authorId,
      body: `⚠️ Signing warning — ${what} was signed from IP ${ip ?? "unknown"}: ${risk}. Call the carrier at the FMCSA phone number to confirm before dispatching.`,
    });
  } catch (e) { console.error("ip risk notice failed", e); }
}
