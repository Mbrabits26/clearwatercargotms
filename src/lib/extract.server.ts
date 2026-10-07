// Server-only: reads a dispatch document with Lovable AI and returns load fields.
const nullable = (t: string) => ({ type: [t, "null"] });
const FIELDS = {
  customer_name: nullable("string"), reference: nullable("string"),
  shipper_name: nullable("string"), shipper_address: nullable("string"),
  origin_city: nullable("string"), origin_state: nullable("string"), origin_zip: nullable("string"),
  pickup_at: nullable("string"), pickup_notes: nullable("string"),
  consignee_name: nullable("string"), consignee_address: nullable("string"),
  dest_city: nullable("string"), dest_state: nullable("string"), dest_zip: nullable("string"),
  delivery_at: nullable("string"), delivery_notes: nullable("string"),
  equipment: nullable("string"), commodity: nullable("string"), weight_lbs: nullable("number"),
  pieces: nullable("number"), temperature: nullable("string"), miles: nullable("number"),
  customer_rate: nullable("number"), carrier_rate: nullable("number"),
  carrier_name: nullable("string"), carrier_mc: nullable("string"),
  ship_ref: nullable("string"), dest_ref: nullable("string"), po_number: nullable("string"),
  shipper_phone: nullable("string"), shipper_contact: nullable("string"),
  consignee_phone: nullable("string"), consignee_contact: nullable("string"),
  hazmat: nullable("boolean"), handwritten_notes: nullable("string"),
} as const;
export type Extracted = { [K in keyof typeof FIELDS]: (typeof FIELDS)[K]["type"][0] extends "number" ? number | null : (typeof FIELDS)[K]["type"][0] extends "boolean" ? boolean | null : string | null };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["loads"],
  properties: {
    loads: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: Object.keys(FIELDS), properties: FIELDS },
    },
  },
};

const PROMPT = `You read freight dispatch documents (rate confirmations, tenders, BOLs, load sheets, spreadsheets) for Clearwater Cargo, a freight broker.
Extract every load in the document. Use null when a value is not present — never guess.
- customer_name: the party paying / tendering the load (bill-to or broker issuing the rate con).
- States are 2-letter US codes. Dates are local ISO "YYYY-MM-DDTHH:mm" (use 08:00 if only a date).
- equipment: one of Dry Van, Reefer, Flatbed, Step Deck, Power Only, Box Truck, Hotshot, Conestoga when possible.
- customer_rate is the total the customer pays; carrier_rate is carrier pay if stated. Numbers only, no $ or commas.
- customer_name: ONLY when a bill-to/broker/customer is explicitly named. A shipper's own letterhead on a BOL or shipping order is the SHIPPER (pickup facility), not the customer — leave customer_name null then.
- Shipper/BOL/shipping orders: the letterhead company and its address is the shipper/origin; "Ship To" is the consignee/destination. Due Date or Ship Date is the pickup date.
- ship_ref: shipper/BOL/sales order/pickup number. dest_ref: delivery/appointment/confirmation #. po_number: customer PO. Put trip #, load # or other refs in reference.
- shipper_contact/phone and consignee_contact/phone: names and phone numbers for each facility (e.g. "Attn: Arturo 719-459-3360").
- commodity: product description (e.g. "#9 Rebar Grade 60, 40'"). pieces: total ship quantity. weight_lbs: total weight.
- equipment hints: "FLAT", "flatbed", "no conestoga" → Flatbed; "reefer"/temps → Reefer; "van" → Dry Van.
- handwritten_notes: transcribe any handwriting or stamps verbatim (carrier names, dates, amounts like "4000/FLAT").
- Handwritten amounts written as "<amount>/<equipment>" next to a carrier name are the carrier pay: set carrier_rate and carrier_name from them. Do not set customer_rate from handwriting.
- Facility notes: appointment requirements, hours, directions, instructions (e.g. "No appointment required", "Call Arturo for jobsite directions").`;

export async function extractLoads(parts: Record<string, unknown>[], apiKey: string): Promise<Extracted[]> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "fetch" },
    body: JSON.stringify({
      model: "openai/gpt-6-astra",
      instructions: PROMPT,
      input: [{ role: "user", content: [{ type: "input_text", text: "Extract the loads from this document." }, ...parts] }],
      stream: true,
      store: false,
      reasoning: { effort: "low" },
      text: { format: { type: "json_schema", name: "loads", strict: true, schema: SCHEMA } },
    }),
  });
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    let msg = body.slice(0, 300);
    try { msg = JSON.parse(body)?.error?.message ?? JSON.parse(body)?.message ?? msg; } catch { /* keep text */ }
    if (res.status === 402) throw new Error("AI credits are used up — add credits in Settings → Plans & credits.");
    if (res.status === 429) throw new Error("Too many requests right now — wait a minute and try again.");
    throw new Error(`Document reader error (${res.status}): ${msg}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const d = line.slice(5).trim();
        if (!d || d === "[DONE]") continue;
        try {
          const ev = JSON.parse(d);
          if (ev.type === "response.output_text.delta") text += ev.delta;
          if (ev.type === "response.refusal.done") throw new Error("The document reader declined this file.");
          if (ev.type === "response.failed" || ev.type === "error") throw new Error(ev.response?.error?.message ?? ev.message ?? "Document reader failed");
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      }
    }
  }
  if (!text) throw new Error("No load details were found in that document.");
  return (JSON.parse(text).loads ?? []) as Extracted[];
}
