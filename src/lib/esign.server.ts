import { getRequestHeader } from "@tanstack/react-start/server";

/** Client IP and device from the signing request. */
export function requestSigner() {
  const ip = (getRequestHeader("cf-connecting-ip") || getRequestHeader("x-real-ip") || getRequestHeader("x-forwarded-for") || "").split(",")[0]?.trim() || null;
  const ua = getRequestHeader("user-agent")?.slice(0, 500) || null;
  return { ip, ua };
}
