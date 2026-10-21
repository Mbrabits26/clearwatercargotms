/** File extension of a name or path, lower-cased, without the dot ("" when none). */
export const extOf = (n: string) => {
  const base = n.split("/").pop() ?? "";
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(i + 1).toLowerCase() : "";
};

/**
 * Clean a user-typed document name. Keeps the original file type so previews and
 * QuickBooks attachments still work: if the new name drops the extension, it is added back.
 * Returns null when the name is blank.
 */
export function cleanDocName(input: string, original: string): string | null {
  const name = input.replace(/[\\/]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!name) return null;
  const ext = extOf(original);
  if (!ext || extOf(name) === ext) return name;
  return `${name}.${ext}`;
}
