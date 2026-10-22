import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listLoads from "./tools/list-loads";
import getLoad from "./tools/get-load";
import searchCarriers from "./tools/search-carriers";
import searchCompanies from "./tools/search-companies";

// Vite inlines the stable ref; the published SUPABASE_URL may be a proxy.
const projectRef = import.meta.env["VITE_SUPABASE_PROJECT_ID"] ?? "project-ref-unset";

export default defineMcp({
  name: "clearwater-cargo-flow",
  title: "Clearwater Cargo Flow",
  version: "0.1.0",
  instructions:
    "Read-only tools for the Clearwater Cargo TMS. Look up loads (status, lane, dates, customer, carrier, rates), load details, carriers (vetting, authority, insurance) and directory companies. Results follow the signed-in team member's app permissions.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listLoads, getLoad, searchCarriers, searchCompanies],
});
