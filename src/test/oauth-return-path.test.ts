import { describe, expect, it } from "vitest";
import { oauthReturnPath } from "@/lib/oauth-return-path";

describe("oauthReturnPath (sign-in return for AI-app connections)", () => {
  it("keeps the consent page path with its request id", () => {
    expect(oauthReturnPath("/.lovable/oauth/consent?authorization_id=abc")).toBe("/.lovable/oauth/consent?authorization_id=abc");
  });
  it("rejects other websites", () => {
    expect(oauthReturnPath("https://evil.example/x")).toBe("/");
    expect(oauthReturnPath("//evil.example/x")).toBe("/");
    expect(oauthReturnPath("/\\evil.example/")).toBe("/");
  });
  it("rejects non-text values", () => {
    expect(oauthReturnPath(undefined)).toBe("/");
  });
});
