/** Screen-local exclusions allow alerts and accounting windows to preview on Dispatch. */
export function loadHoverAllowed(excluded: boolean, editable: boolean): boolean {
  return !excluded && !editable;
}

export function hoverLoadNumber(text: string): string | null {
  const matches = text.match(/\bCW-\d{3,7}\b/gi) ?? [];
  const unique = [...new Set(matches.map((number) => number.toUpperCase()))];
  return unique.length === 1 ? unique[0] ?? null : null;
}