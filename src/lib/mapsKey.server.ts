/** Google Maps calls: use the company's own key directly when set (no workspace credits), else the connector gateway. */
const GW = "https://connector-gateway.lovable.dev/google_maps";
const HOSTS: Record<string, string> = { places: "https://places.googleapis.com", routes: "https://routes.googleapis.com" };

export function mapsFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const own = process.env["GOOGLE_MAPS_CUSTOM_KEY"];
  const headers = new Headers(init.headers);
  if (own) {
    const [first, ...rest] = path.replace(/^\//, "").split("/");
    const base = HOSTS[first];
    const url = base ? `${base}/${rest.join("/")}` : `https://maps.googleapis.com/${path.replace(/^\//, "")}`;
    headers.set("X-Goog-Api-Key", own);
    return fetch(url, { ...init, headers });
  }
  const lov = process.env["LOVABLE_API_KEY"];
  const key = process.env["GOOGLE_MAPS_API_KEY"];
  if (!lov || !key) throw new Error("Google address lookup is not connected");
  headers.set("Authorization", `Bearer ${lov}`);
  headers.set("X-Connection-Api-Key", key);
  return fetch(`${GW}/${path.replace(/^\//, "")}`, { ...init, headers });
}
