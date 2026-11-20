import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { GoogleVoiceShareButton } from "@/components/GoogleVoiceShareButton";

const { success, error } = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success, error } }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); success.mockClear(); error.mockClear(); });

it("opens Voice before awaiting clipboard and keeps recipient and message separately copyable", async () => {
  const events: string[] = [];
  const launch = vi.spyOn(window, "open").mockImplementation(() => { events.push("open"); return null; });
  const writeText = vi.fn().mockImplementation(async () => { events.push("copy"); });
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  render(<GoogleVoiceShareButton phone="336-555-0100" message="Driver tracking CW-10602" />);
  fireEvent.click(screen.getByRole("button", { name: "Google Voice" }));
  expect(launch).toHaveBeenCalledWith("https://voice.google.com/u/0/messages?itemId=t.%2B13365550100", "_blank", "noopener,noreferrer");
  expect(events).toEqual(["open", "copy"]);
  expect(writeText).toHaveBeenLastCalledWith("Driver tracking CW-10602");
  fireEvent.click(screen.getByRole("button", { name: "Copy phone" }));
  expect(writeText).toHaveBeenLastCalledWith("+13365550100");
  fireEvent.click(screen.getByRole("button", { name: "Copy message" }));
  expect(writeText).toHaveBeenLastCalledWith("Driver tracking CW-10602");
});

it("does not report a copied message when clipboard access fails", async () => {
  vi.spyOn(window, "open").mockReturnValue(null);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
  render(<GoogleVoiceShareButton phone="336-555-0100" message="Driver tracking CW-10602" />);
  fireEvent.click(screen.getByRole("button", { name: "Google Voice" }));
  await waitFor(() => expect(error).toHaveBeenCalledOnce());
  expect(success).not.toHaveBeenCalled();
});