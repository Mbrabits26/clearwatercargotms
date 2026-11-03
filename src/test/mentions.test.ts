import { describe, it, expect } from "vitest";
import { findMentions, type Person } from "@/components/MentionInput";

const people: Person[] = [
  { id: "a", full_name: "Eric Foust", email: "eric@x.com" },
  { id: "b", full_name: "Kristy", email: "kristy@x.com" },
  { id: "c", full_name: "Micheal", email: "micheal@x.com" },
];

describe("findMentions", () => {
  it("@team tags every person", () => {
    expect(findMentions("heads up @team", people).sort()).toEqual(["a", "b", "c"]);
  });
  it("@everyone tags every person", () => {
    expect(findMentions("@everyone check this load", people).sort()).toEqual(["a", "b", "c"]);
  });
  it("group tag in a private chat only reaches the chat members", () => {
    expect(findMentions("@everyone", people, [people[0]!, people[2]!]).sort()).toEqual(["a", "c"]);
  });
  it("single tag still tags only that person", () => {
    expect(findMentions("@Kristy please call", people)).toEqual(["b"]);
  });
});
