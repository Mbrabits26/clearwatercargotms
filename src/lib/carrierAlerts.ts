import type { CarrierCheckReport } from "./carrierCheck";

export type CarrierWarning = { level: "yellow" | "red"; title: string; body: string };

export function carrierCheckWarning(r: Pick<CarrierCheckReport, "grade" | "flags" | "legal_name" | "mc" | "dot" | "score">): CarrierWarning | null {
  const level = r.grade === "High risk" || r.flags.some((f) => f.level === "red") ? "red"
    : r.grade === "Review" || r.flags.some((f) => f.level === "amber") ? "yellow" : null;
  if (!level) return null;
  return {
    level,
    title: `Carrier check — ${level === "red" ? "Red" : "Yellow"} — ${r.legal_name}`,
    body: `DOT ${r.dot}${r.mc ? ` · MC ${r.mc}` : ""} · Score ${r.score}/100 · ${r.flags.map((f) => f.text).join(" · ") || r.grade}. Informational only; no additional approval or booking restriction.`,
  };
}

export function carrierAlertRecipients(senderId: string | null | undefined, adminIds: string[], brokerId?: string | null): string[] {
  return [...new Set([senderId, brokerId, ...adminIds].filter((id): id is string => Boolean(id)))];
}

export const isCarrierSafetyAlert = (source: string) => source === "signing_risk" || source === "carrier_check";