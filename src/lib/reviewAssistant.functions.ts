import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const nul = (t: string) => ({ type: [t, "null"] });
const SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["mode", "customer", "from", "to", "minDaysSinceDelivery", "entity", "summary"],
  properties: {
    mode: { type: "string", enum: ["qb_match", "paid_mismatch", "closeout"] },
    customer: nul("string"), from: nul("string"), to: nul("string"), minDaysSinceDelivery: nul("number"),
    entity: { type: "string", enum: ["brokerage", "fleet"] }, summary: { type: "string" },
  },
};

/** Reads an admin/accountant's plain-English request into a review filter. It never changes data. */
export const planReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ query: z.string().min(2).max(500), today: z.string().max(10) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: ok } = await (context.supabase as unknown as { rpc: (f: string, a: object) => Promise<{ data: boolean }> }).rpc("is_finance", { _uid: context.userId });
    if (!ok) throw new Error("Admins or accountants only.");
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("AI is not set up.");
    const { readDocJson } = await import("./extract.server");
    const instructions = `You turn a freight brokerage accountant's request into a review filter. Today is ${data.today}.
mode: "qb_match" = find QuickBooks invoices that match TMS loads (link/attach); "paid_mismatch" = invoices paid in QuickBooks whose loads aren't marked paid; "closeout" = paid loads ready to close out.
customer: customer name if mentioned, else null. from/to: YYYY-MM-DD date range if mentioned (months → full month, "this year" → Jan 1 to today), else null.
minDaysSinceDelivery: e.g. "over 30 days" → 30, else null. entity: "fleet" only if Foust Farms / fleet / company trucks are mentioned, else "brokerage".
summary: one short sentence describing what will be listed.`;
    return (await readDocJson({ instructions, ask: data.query, name: "review_plan", schema: SCHEMA }, [], key)) as {
      mode: "qb_match" | "paid_mismatch" | "closeout"; customer: string | null; from: string | null; to: string | null;
      minDaysSinceDelivery: number | null; entity: "brokerage" | "fleet"; summary: string;
    };
  });
