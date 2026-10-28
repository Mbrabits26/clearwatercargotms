import { describe, expect, it } from "vitest";
import { buyBox, contractProjection, maxCarrierPay, sellForMargin } from "./buyBox";

describe("buyBox", () => {
  it("15% or more is healthy", () => expect(buyBox(2500, 2125, 500).health).toBe("healthy"));
  it("8–15% is moderate", () => expect(buyBox(2500, 2250, 500).health).toBe("moderate"));
  it("under 8% is low", () => expect(buyBox(2200, 2080, 500).health).toBe("low"));
  it("rpm math", () => {
    const b = buyBox(2800, 2380, 650);
    expect(b.custRpm!.toFixed(2)).toBe("4.31");
    expect(b.netRpm!.toFixed(2)).toBe("0.65");
  });
  it("max carrier pay for 15% on $2,500 is $2,125", () => expect(maxCarrierPay(2500, 15)).toBe(2125));
  it("sell rate for 15% on $2,125 cost is $2,500", () => expect(sellForMargin(2125, 15)).toBe(2500));
  it("contract: 4/wk at $350 profit = $1,400/wk, $72,800/yr", () => {
    const p = contractProjection(2400, 2050, 0, 4, 0);
    expect(p.weekly).toBe(1400);
    expect(p.annual).toBe(72800);
  });
});
