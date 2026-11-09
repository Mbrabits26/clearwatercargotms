import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { invoiceReviewSchema } from "./carrierInvoiceReview";

export const saveCarrierInvoiceReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => invoiceReviewSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: finance, error: roleError } = await context.supabase.rpc("is_finance", { _uid: context.userId });
    if (roleError || !finance) throw new Error("Only admins and accountants can save carrier payment details");
    const { data: result, error } = await context.supabase.rpc("save_carrier_invoice_review", {
      p_load: data.load, p_bill: data.bill ?? undefined, p_path: data.path, p_kind: data.kind,
      p_number: data.number, p_amount: data.amount ?? undefined, p_lines: data.lines,
      p_factor: data.factor ?? undefined, p_account: data.account ?? undefined,
    });
    if (error) throw new Error(error.message);
    return result;
  });