import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type FmcsaCarrier = {
  legal_name: string; dba: string | null; dot_number: string; mc_number: string | null;
  address: string | null; city: string | null; state: string | null; zip: string | null; phone: string | null;
  authority_status: "Authorized" | "Inactive" | "Revoked"; allowed_to_operate: boolean;
  safety_rating: string; power_units: number | null; drivers: number | null;
  bipd_on_file: number | null; bipd_required: number | null; cargo_on_file: number | null;
  out_of_service: boolean; warnings: string[];
};

const BASE = "https://mobile.fmcsa.dot.gov/qc/services";
const RATING: Record<string, string> = { S: "Satisfactory", C: "Conditional", U: "Unsatisfactory" };

async function get(path: string, key: string) {
  const r = await fetch(`${BASE}${path}${path.includes("?") ? "&" : "?"}webKey=${key}`, { headers: { Accept: "application/json" } });
  if (r.status === 403 || r.status === 401) throw new Error("FMCSA rejected the web key.");
  if (!r.ok) throw new Error(`FMCSA lookup failed (${r.status}).`);
  return r.json() as Promise<{ content: unknown }>;
}

export const lookupFmcsa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ mc: z.string().max(20).nullable(), dot: z.string().max(20).nullable() }).parse(d))
  .handler(async ({ data, context }): Promise<FmcsaCarrier> => {
    const { data: staff } = await context.supabase.rpc("is_staff", { _uid: context.userId });
    if (!staff) throw new Error("Forbidden");
    const key = process.env["FMCSA_WEBKEY"];
    if (!key) throw new Error("FMCSA lookup isn't configured.");
    const mc = data.mc?.replace(/\D/g, "") || null;
    let dot = data.dot?.replace(/\D/g, "") || null;
    if (!mc && !dot) throw new Error("Enter an MC # or DOT #.");

    if (!dot && mc) {
      const res = await get(`/carriers/docket-number/${mc}`, key);
      const list = (Array.isArray(res.content) ? res.content : [res.content]) as { carrier?: { dotNumber?: number } }[];
      const found = list.find((x) => x?.carrier?.dotNumber)?.carrier?.dotNumber;
      if (!found) throw new Error(`No carrier found for MC ${mc}.`);
      dot = String(found);
    }
    const base = await get(`/carriers/${dot}`, key);
    const c = (base.content as { carrier?: Record<string, unknown> } | null)?.carrier;
    if (!c) throw new Error(`No carrier found for DOT ${dot}.`);

    const [auth, dockets] = await Promise.all([
      get(`/carriers/${dot}/authority`, key).catch(() => null),
      mc ? null : get(`/carriers/${dot}/mc-numbers`, key).catch(() => null),
    ]);
    const authRows = ((auth?.content as { carrierAuthority?: Record<string, string> }[] | undefined) ?? []).map((a) => a.carrierAuthority ?? {});
    const anyActive = authRows.some((a) => a.commonAuthorityStatus === "A" || a.contractAuthorityStatus === "A");
    const anyRevoked = authRows.some((a) => a.commonAuthorityStatus === "I" || a.authorizedForHire === "N");
    const docket = mc ?? String(((dockets?.content as { docketNumber?: number; prefix?: string }[] | undefined) ?? []).find((d) => d.prefix === "MC")?.docketNumber ?? "") || null;

    const allowed = c["allowedToOperate"] === "Y";
    const oos = !!c["oosDate"];
    const n = (k: string) => (c[k] == null || c[k] === "" ? null : Number(c[k]));
    const bipdOn = n("bipdInsuranceOnFile"), bipdReq = n("bipdInsuranceRequired");
    const authority_status: FmcsaCarrier["authority_status"] = allowed && (anyActive || !authRows.length) ? "Authorized" : anyRevoked ? "Revoked" : "Inactive";
    const warnings: string[] = [];
    if (!allowed) warnings.push("Not allowed to operate per FMCSA");
    if (oos) warnings.push(`Out-of-service order (${c["oosDate"]})`);
    if (authRows.length && !anyActive) warnings.push("No active common/contract authority");
    if (bipdReq && (bipdOn ?? 0) < bipdReq) warnings.push("Liability insurance on file below FMCSA requirement");
    if (c["safetyRating"] === "U") warnings.push("Unsatisfactory safety rating");

    return {
      legal_name: String(c["legalName"] ?? ""), dba: (c["dbaName"] as string) || null,
      dot_number: String(dot), mc_number: docket,
      address: (c["phyStreet"] as string) || null, city: (c["phyCity"] as string) || null,
      state: (c["phyState"] as string) || null, zip: (c["phyZipcode"] as string) || null, phone: (c["telephone"] as string) || null,
      authority_status, allowed_to_operate: allowed,
      safety_rating: RATING[String(c["safetyRating"] ?? "")] ?? "Not Rated",
      power_units: n("totalPowerUnits"), drivers: n("totalDrivers"),
      bipd_on_file: bipdOn != null ? bipdOn * 1000 : null, bipd_required: bipdReq != null ? bipdReq * 1000 : null,
      cargo_on_file: n("cargoInsuranceOnFile") != null ? n("cargoInsuranceOnFile")! * 1000 : null,
      out_of_service: oos, warnings,
    };
  });
