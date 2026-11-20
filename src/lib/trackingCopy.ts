import { rateconPhone } from "@/lib/rateconDelivery";

/** This targets an existing thread; Google Voice does not support new-draft recipient URLs. */
export function googleVoiceUrl(phone: string): string | null {
  const number = rateconPhone(phone);
  return number ? `https://voice.google.com/u/0/messages?itemId=t.${encodeURIComponent(number)}` : null;
}

/** Recipient and message stay separate for Google Voice's two different fields. */
export function trackingCopyText(message: string, phone: string | null | undefined, includePhone: boolean) {
  return includePhone && phone?.trim() ? `To: ${phone.trim()}\n\n${message}` : message;
}