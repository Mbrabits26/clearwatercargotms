/** Normalize US/Canada local numbers or explicit international numbers for texting links. */
export function rateconPhone(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (value.trim().startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}

export function rateconText(loadNumber: string, lane: string, url: string) {
  return `Please review and sign rate confirmation ${loadNumber} (${lane}):\n\n${url}\n\nClearwater Cargo LLC · 252-497-7916`;
}