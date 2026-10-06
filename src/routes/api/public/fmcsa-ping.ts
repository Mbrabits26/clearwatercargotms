import { createFileRoute } from "@tanstack/react-router";

// Temporary connectivity check — returns only the HTTP status, no data.
export const Route = createFileRoute("/api/public/fmcsa-ping")({
  server: {
    handlers: {
      GET: async () => {
        const r = await fetch(`https://mobile.fmcsa.dot.gov/qc/services/carriers/2245540?webKey=${process.env["FMCSA_WEBKEY"]}`, { headers: { Accept: "application/json" } });
        return new Response(String(r.status));
      },
    },
  },
});
