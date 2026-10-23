// Pure rules for the "removed from load" carrier email (shared by server + tests).

export type RcRequestLite = { id: string; status: string; carrier_email: string | null; created_at: string; snapshot: unknown };
export type CarrierLite = { legal_name: string; email: string | null; mc_number?: string | null; dot_number?: string | null };

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const firstEmail = (s: string | null | undefined) =>
  (s ?? "").split(/[,;\s]+/).map((x) => x.trim()).find((x) => EMAIL.test(x)) ?? null;

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();

/** Rate con requests on this load that were made out to this carrier (by name or MC/DOT). */
export function requestsForCarrier(reqs: RcRequestLite[], c: CarrierLite): RcRequestLite[] {
  const mc = c.mc_number ? `mc ${c.mc_number}` : null;
  const dot = c.dot_number ? `dot ${c.dot_number}` : null;
  return reqs
    .filter((r) => {
      const s = (r.snapshot ?? {}) as { carrier?: string; carrierMc?: string };
      const id = norm(s.carrierMc);
      return norm(s.carrier) === norm(c.legal_name) || (!!id && (id === mc || id === dot));
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/**
 * Who gets the removal email: only a carrier that was actually sent a rate con
 * for this load. Uses the address the rate con went to, else the carrier's email.
 */
export function removalRecipient(reqs: RcRequestLite[], c: CarrierLite): { to: string; requestId: string } | null {
  const mine = requestsForCarrier(reqs, c);
  if (!mine.length) return null;
  const to = firstEmail(mine[0].carrier_email) ?? firstEmail(c.email);
  return to ? { to, requestId: mine[0].id } : null;
}
