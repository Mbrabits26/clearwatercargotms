// Server-only: reads a certificate of insurance with Lovable AI.
const n = (t: string) => ({ type: [t, "null"] });
const FIELDS = {
  insurer: n("string"), policy_number: n("string"),
  auto_liability: n("number"), auto_expires: n("string"),
  cargo_insurance: n("number"), cargo_expires: n("string"),
};
export type CoiData = { insurer: string | null; policy_number: string | null; auto_liability: number | null; auto_expires: string | null; cargo_insurance: number | null; cargo_expires: string | null };

const iso = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);

export async function readCoi(b64: string, fileName: string, mime: string, key: string): Promise<CoiData | null> {
  const part = /\.pdf$/i.test(fileName) || mime === "application/pdf"
    ? { type: "input_file", filename: fileName, file_data: `data:application/pdf;base64,${b64}` }
    : { type: "input_image", image_url: `data:${mime || "image/jpeg"};base64,${b64}` };
  const { readDocJson } = await import("./extract.server");
  const p = (await readDocJson({
    instructions: "You read trucking certificates of insurance (ACORD 25). Return the auto liability combined single limit and its policy expiration date, and the motor truck cargo limit and its expiration date. Dates as YYYY-MM-DD. Amounts as plain numbers in dollars. Use null when not shown.",
    ask: "Extract the insurance details from this certificate.", name: "coi",
    schema: { type: "object", additionalProperties: false, required: Object.keys(FIELDS), properties: FIELDS },
  }, [part], key)) as CoiData;
  return { ...p, auto_expires: iso(p.auto_expires), cargo_expires: iso(p.cargo_expires) };
}

/** Carrier-row patch from a COI (only values the certificate actually shows). */
export function coiPatch(p: CoiData) {
  const out: Record<string, unknown> = { coi_received: true };
  if (p.auto_liability) out.auto_liability = p.auto_liability;
  if (p.auto_expires) out.insurance_expires = p.auto_expires;
  if (p.cargo_insurance) out.cargo_insurance = p.cargo_insurance;
  if (p.cargo_expires) out.cargo_expires = p.cargo_expires;
  return out;
}
