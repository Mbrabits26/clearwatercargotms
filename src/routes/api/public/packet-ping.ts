import { createFileRoute } from "@tanstack/react-router";

// Temporary diagnostic: reports only the HTTP status from the packet export.
export const Route = createFileRoute("/api/public/packet-ping")({
  server: {
    handlers: {
      GET: async () => {
        const res = await fetch(process.env["PACKET_EXPORT_URL"]!, {
          headers: { Authorization: `Bearer ${(process.env["PACKET_EXPORT_SECRET"] ?? "").trim()}` },
        });
        return new Response(String(res.status));
      },
    },
  },
});
