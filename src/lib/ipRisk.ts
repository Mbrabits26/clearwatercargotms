// Flags e-signatures made from outside North America or through a VPN / hosting network.
// A warning aid only: staff should confirm the carrier by calling the FMCSA phone.

const OK_COUNTRIES = new Set(["US", "CA"]);
const HOSTING = /(amazon|aws|google cloud|google llc|microsoft|azure|digitalocean|linode|akamai|ovh|hetzner|vultr|choopa|m247|leaseweb|contabo|datacamp|cdn77|packethub|nordvpn|expressvpn|surfshark|private internet access|proton|mullvad|cyberghost|ipvanish|hide\.?me|windscribe|tefincom|zenlayer|psychz|quadranet|colocrossing|hostinger|hosting|datacenter|data center|vpn|proxy|tor exit|oracle cloud|alibaba|tencent|cloudflare warp)/i;

export type IpRisk = { country: string | null; network: string | null; risk: string | null };

export function assessIp(country: string | null | undefined, network: string | null | undefined): IpRisk {
  const c = (country ?? "").toUpperCase().trim() || null;
  const n = (network ?? "").trim() || null;
  const flags: string[] = [];
  if (c === "T1") flags.push("Tor network");
  else if (c && c !== "XX" && !OK_COUNTRIES.has(c)) flags.push(`Signed from outside the US/Canada (${c})`);
  if (n && HOSTING.test(n)) flags.push(`VPN / hosting network (${n})`);
  return { country: c, network: n, risk: flags.length ? flags.join(" · ") : null };
}
