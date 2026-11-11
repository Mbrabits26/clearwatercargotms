import { describe, expect, it, vi } from "vitest";
import { savePodPhotos } from "../lib/podUpload";

describe("driver multiple POD pictures", () => {
  it("saves every picture before closing delivery", async () => {
    const events: string[] = [];
    await savePodPhotos([{ id: "1", file: "front" }, { id: "2", file: "back" }, { id: "3", file: "extra" }],
      async file => { events.push(file); return `pod-${file}`; }, () => {},
      async paths => { expect(paths).toEqual(["pod-front", "pod-back", "pod-extra"]); events.push("finish"); });
    expect(events).toEqual(["front", "back", "extra", "finish"]);
  });
  it("does not close delivery if one picture fails", async () => {
    const finish = vi.fn();
    const saved = vi.fn();
    await expect(savePodPhotos([{ id: "1", file: "front" }, { id: "2", file: "back" }],
      async file => { if (file === "back") throw new Error("Connection lost"); return "pod-front"; }, saved, finish)).rejects.toThrow("Connection lost");
    expect(saved).toHaveBeenCalledWith("1", "pod-front");
    expect(finish).not.toHaveBeenCalled();
  });
  it("retries without uploading already saved pictures twice", async () => {
    const upload = vi.fn(async () => "pod-back");
    const finish = vi.fn(async () => {});
    await savePodPhotos([{ id: "1", file: "front", path: "pod-front" }, { id: "2", file: "back" }], upload, () => {}, finish);
    expect(upload).toHaveBeenCalledExactlyOnceWith("back");
    expect(finish).toHaveBeenCalledWith(["pod-front", "pod-back"]);
  });
  it("cannot finish without a POD picture", async () => {
    const finish = vi.fn();
    await expect(savePodPhotos([], vi.fn(), vi.fn(), finish)).rejects.toThrow("Add at least one");
    expect(finish).not.toHaveBeenCalled();
  });
});