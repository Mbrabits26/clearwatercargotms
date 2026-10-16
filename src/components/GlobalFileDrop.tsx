import { useEffect } from "react";

/**
 * App-wide drag-and-drop: dropping files onto any upload area feeds them into the
 * nearest file input (same as clicking it), so every existing upload/read flow works.
 */
function findInput(el: Element | null): { zone: Element; input: HTMLInputElement } | null {
  let cur: Element | null = el;
  while (cur && cur !== document.body) {
    const input = cur.matches('input[type="file"]') ? (cur as HTMLInputElement) : cur.querySelector<HTMLInputElement>('input[type="file"]:not([disabled])');
    if (input && !input.disabled) return { zone: cur, input };
    if (cur.getAttribute("role") === "dialog") return null;
    cur = cur.parentElement;
  }
  return null;
}

export function GlobalFileDrop() {
  useEffect(() => {
    let zone: Element | null = null;
    const clear = () => { zone?.classList.remove("cw-drop-active"); zone = null; };
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const hit = findInput(e.target as Element);
      if (hit?.zone !== zone) { clear(); if (hit) { zone = hit.zone; zone.classList.add("cw-drop-active"); } }
      if (e.dataTransfer) e.dataTransfer.dropEffect = hit ? "copy" : "none";
    };
    const leave = (e: DragEvent) => { if (!e.relatedTarget) clear(); };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      clear();
      const hit = findInput(e.target as Element);
      const files = e.dataTransfer?.files;
      if (!hit || !files?.length) return;
      const dt = new DataTransfer();
      Array.from(files).slice(0, hit.input.multiple ? undefined : 1).forEach((f) => dt.items.add(f));
      hit.input.files = dt.files;
      hit.input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => { window.removeEventListener("dragover", over); window.removeEventListener("dragleave", leave); window.removeEventListener("drop", drop); };
  }, []);
  return null;
}
