/** Quick date-range presets shared by Reports and QuickBooks reconciliation. Dates are YYYY-MM-DD. */
export type RangeKey = "all" | "ytd" | "this_year" | "last_year" | "this_month" | "last_month" | "this_quarter" | "last_quarter" | "last_30" | "last_90" | "custom" | `year_${number}`;

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function rangeOptions(now = new Date()): { value: RangeKey; label: string }[] {
  const y = now.getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => y - 2 - i).map((yr) => ({ value: `year_${yr}` as RangeKey, label: `Year ${yr}` }));
  return [
    { value: "all", label: "All dates" },
    { value: "ytd", label: "Year to date" },
    { value: "this_year", label: `This year (${y})` },
    { value: "last_year", label: `Last year (${y - 1})` },
    ...years,
    { value: "this_quarter", label: "This quarter" },
    { value: "last_quarter", label: "Last quarter" },
    { value: "this_month", label: "This month" },
    { value: "last_month", label: "Last month" },
    { value: "last_30", label: "Last 30 days" },
    { value: "last_90", label: "Last 90 days" },
    { value: "custom", label: "Custom dates" },
  ];
}

/** Returns [from, to] for a preset; null for custom (keep user's dates). */
export function rangeFor(key: RangeKey, now = new Date()): [string, string] | null {
  const y = now.getFullYear(), m = now.getMonth(), today = iso(now);
  const q = Math.floor(m / 3);
  const back = (days: number) => iso(new Date(y, m, now.getDate() - days));
  switch (key) {
    case "all": return ["", ""];
    case "ytd": return [`${y}-01-01`, today];
    case "this_year": return [`${y}-01-01`, `${y}-12-31`];
    case "last_year": return [`${y - 1}-01-01`, `${y - 1}-12-31`];
    case "this_month": return [iso(new Date(y, m, 1)), iso(new Date(y, m + 1, 0))];
    case "last_month": return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
    case "this_quarter": return [iso(new Date(y, q * 3, 1)), iso(new Date(y, q * 3 + 3, 0))];
    case "last_quarter": return [iso(new Date(y, q * 3 - 3, 1)), iso(new Date(y, q * 3, 0))];
    case "last_30": return [back(30), today];
    case "last_90": return [back(90), today];
    case "custom": return null;
    default: {
      const yr = Number(String(key).slice(5));
      return [`${yr}-01-01`, `${yr}-12-31`];
    }
  }
}
