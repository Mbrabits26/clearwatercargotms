import { describe, it, expect } from "vitest";
import { rateConTerms } from "./ratecon";
const c = (x: any) => ({ legal_name: "C", factoring_company: null, ...x }) as any;
describe("rate con QuickPay terms", () => {
  it("uses carrier's changed fee", () => expect(rateConTerms({} as any, c({ pay_terms: "quickpay", quickpay_fee_pct: 3 }))).toBe("Quick Pay: 3% fee, paid in 3 days"));
  it("load override wins", () => expect(rateConTerms({ quickpay_fee_pct: 2.5 } as any, c({ pay_terms: "quickpay", quickpay_fee_pct: 3 }))).toBe("Quick Pay: 2.5% fee, paid in 3 days"));
  it("defaults to 5%", () => expect(rateConTerms({} as any, c({ pay_terms: "quickpay" }))).toBe("Quick Pay: 5% fee, paid in 3 days"));
  it("net 30 no fee", () => expect(rateConTerms({} as any, c({ pay_terms: "net30" }))).toBe("Net 30"));
});
