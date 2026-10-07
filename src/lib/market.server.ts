// Server-only: searches public freight-market pages and summarizes spot/contract rates with Lovable AI.
export type MarketRate = {
  spot_rpm: number | null;
  contract_rpm: number | null;
  scope: string;
  as_of: string | null;
  summary: string;
  sources: { title: string; url: string; note: string }[];
};

const n = { type: ["number", "null"] };
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["spot_rpm", "contract_rpm", "scope", "as_of", "summary", "sources"],
  properties: {
    spot_rpm: n,
    contract_rpm: n,
    scope: { type: "string" },
    as_of: { type: ["string", "null"] },
    summary: { type: "string" },
    sources: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["title", "url", "note"], properties: { title: { type: "string" }, url: { type: "string" }, note: { type: "string" } } },
    },
  },
};

async function firecrawlSearch(query: string, key: string, aiKey: string) {
  const r = await fetch("https://connector-gateway.lovable.dev/firecrawl/v2/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${aiKey}`, "X-Connection-Api-Key": key },
    body: JSON.stringify({ query, limit: 4, tbs: "qdr:m", scrapeOptions: { formats: ["markdown"], onlyMainContent: true } }),
  });
  if (!r.ok) throw new Error(`Market search failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { data?: { web?: { url: string; title?: string; markdown?: string }[] } | { url: string; title?: string; markdown?: string }[] };
  const arr = Array.isArray(j.data) ? j.data : j.data?.web ?? [];
  return arr.map((x) => ({ url: x.url, title: x.title ?? x.url, text: (x.markdown ?? "").slice(0, 6000) }));
}

export async function fetchMarketRates(lane: { origin_state: string; dest_state: string; origin_city?: string; dest_city?: string; equipment: string }, fcKey: string, aiKey: string): Promise<MarketRate> {
  const eq = lane.equipment;
  const queries = [
    `FreightWaves ${eq} spot rate per mile national average this week`,
    `DAT trendlines ${eq} spot and contract rate per mile`,
    `Freightview ${eq} truckload rate report ${lane.origin_state} ${lane.dest_state}`,
  ];
  const results = await Promise.allSettled(queries.map((q) => firecrawlSearch(q, fcKey, aiKey)));
  const pages = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
  if (!pages.length && failed) throw failed.reason;
  const seen = new Set<string>();
  const uniq = pages.filter((p) => p.text && !seen.has(p.url) && seen.add(p.url)).slice(0, 8);
  if (!uniq.length) throw new Error("No public market rate pages were found right now.");

  const corpus = uniq.map((p, i) => `### Source ${i + 1}: ${p.title}\nURL: ${p.url}\n${p.text}`).join("\n\n");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": aiKey, "X-Lovable-AIG-SDK": "fetch" },
    body: JSON.stringify({
      model: "openai/gpt-6-astra",
      instructions: `You are a freight pricing analyst. From the provided public web pages only, report the most recent truckload ${eq} rates per mile (USD, linehaul incl. fuel if that is how the source reports it).
- spot_rpm / contract_rpm: numbers stated in the sources (national or the closest region to ${lane.origin_state}→${lane.dest_state}); null if not stated. Never invent numbers.
- scope: e.g. "National dry van" or "Southeast outbound reefer".
- as_of: the date the figures refer to (YYYY-MM-DD) if stated.
- summary: 1-3 sentences on direction (rising/falling) and what drives it.
- sources: only the pages you actually used, with the number each one gave.`,
      input: [{ role: "user", content: [{ type: "input_text", text: corpus }] }],
      stream: false,
      store: false,
      reasoning: { effort: "low" },
      text: { format: { type: "json_schema", name: "market_rates", strict: true, schema: SCHEMA } },
    }),
  });
  if (res.status === 402) throw new Error("AI credits are used up — add credits in Settings → Plans & credits.");
  if (res.status === 429) throw new Error("Too many requests right now — wait a minute and try again.");
  if (!res.ok) throw new Error(`Market rate reader error (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { output?: { type: string; content?: { type: string; text?: string }[] }[] };
  const text = j.output?.flatMap((o) => o.content ?? []).find((c) => c.type === "output_text")?.text;
  if (!text) throw new Error("Couldn't read market rates from the sources.");
  return JSON.parse(text) as MarketRate;
}
