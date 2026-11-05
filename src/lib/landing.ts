// Where each person lands after sign-in / clicking the logo. Personal choice (saved per user on this
// device) wins; otherwise role default: admin → Home, accountant → Accounting, broker → Dispatch.
export type Landing = "/home" | "/dispatch" | "/quickbooks" | "/reports";
export const LANDINGS: { value: Landing; label: string }[] = [
  { value: "/home", label: "Home" },
  { value: "/dispatch", label: "Dispatch Board" },
  { value: "/quickbooks", label: "Accounting" },
  { value: "/reports", label: "Reports" },
];
export function defaultLanding(roles: { isAdmin: boolean; isAccountant: boolean }): Landing {
  if (roles.isAdmin) return "/home";
  if (roles.isAccountant) return "/quickbooks";
  return "/dispatch";
}
const key = (uid: string) => `cw-landing:${uid}`;
export function getLandingPref(uid: string): Landing | null {
  if (typeof window === "undefined") return null;
  const v = window.localStorage.getItem(key(uid));
  return LANDINGS.some((l) => l.value === v) ? (v as Landing) : null;
}
export function setLandingPref(uid: string, v: Landing | null) {
  if (v) window.localStorage.setItem(key(uid), v);
  else window.localStorage.removeItem(key(uid));
}
export function landingFor(uid: string, roles: { isAdmin: boolean; isAccountant: boolean }): Landing {
  return getLandingPref(uid) ?? defaultLanding(roles);
}
