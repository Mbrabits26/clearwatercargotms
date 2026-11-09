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
      // Generated RPC types omit nullable arguments; preserve explicit SQL nulls.
      p_load: data.load, p_bill: data.bill as string, p_path: data.path, p_kind: data.kind,
      p_number: data.number, p_amount: data.amount as number, p_lines: data.lines,
      p_factor: data.factor, p_account: data.account,
    });
    if (error) throw new Error(error.message);
    return result;
  });