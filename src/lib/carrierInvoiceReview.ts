import { z } from "zod";

export const factorReviewSchema = z.object({
  company: z.string().trim().min(1, "Enter factoring company").max(200),
  address: z.string().trim().min(1, "Enter remit-to address").max(1000),
});
export const paymentReviewSchema = z.object({
  method: z.enum(["ach", "wire", "check"]),
  bank_name: z.string().max(200), account_name: z.string().max(200),
  routing_number: z.string().regex(/^$|^\d{9}$/, "Routing number must have nine digits"),
  account_number: z.string().max(100), account_type: z.enum(["checking", "savings"]),
  remit_email: z.union([z.literal(""), z.string().email()]), notes: z.string().max(2000),
});
export const invoiceReviewSchema = z.object({
  load: z.string().uuid(), bill: z.string().uuid().nullable(), path: z.string().max(1000),
  kind: z.enum(["regular", "factoring"]), number: z.string().max(200), amount: z.number().nonnegative().nullable(),
  lines: z.array(z.object({ description: z.string().max(1000), amount: z.number() })).max(200),
  factor: factorReviewSchema.nullable(), account: paymentReviewSchema.nullable(),
}).superRefine((v, ctx) => {
  if (v.factor && v.kind !== "factoring") ctx.addIssue({ code: "custom", message: "Regular invoices cannot change factoring details" });
  if (v.account && !v.factor) ctx.addIssue({ code: "custom", message: "Review factoring company before saving payment details" });
  if (!v.path.startsWith(`${v.load}/`) || v.path.includes("..")) ctx.addIssue({ code: "custom", message: "Invoice file must belong to this load" });
});