import { describe, expect, it } from "vitest";
import { refMatches } from "./loadRefDup";

const other = { id: "a", load_number: "CW-1", status: "booked", customer_ref: "W0 123", ship_ref: null, dest_ref: null };
describe("refMatches", () => {
  it("flags the same ref on another load, ignoring case and spaces, across ref fields", () =>
    expect(refMatches({ ship_ref: "w0123" }, [other])).toHaveLength(1));
  it("ignores the load being edited", () => expect(refMatches({ customer_ref: "W0 123" }, [other], "a")).toHaveLength(0));
  it("ignores cancelled loads", () => expect(refMatches({ customer_ref: "W0 123" }, [{ ...other, status: "cancelled" }])).toHaveLength(0));
});
