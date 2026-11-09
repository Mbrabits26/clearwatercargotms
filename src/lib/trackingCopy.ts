/** Recipient and message stay separate for Google Voice's two different fields. */
export function trackingCopyText(message: string, phone: string | null | undefined, includePhone: boolean) {
  return includePhone && phone?.trim() ? `To: ${phone.trim()}\n\n${message}` : message;
}