import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

// Runs every few minutes: sends at most one due cold email per sender (business hours), then reads new shipper replies (each inbox at most every 15 min).
export const Route = createFileRoute("/api/public/jobs/outreach-send")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFailure = await authenticateCronRequest(request);
        if (authFailure) return authFailure;
        const { sendDueOutreach } = await import("@/lib/outreach.server");
        const sent = await sendDueOutreach();
        const { checkAllReplies } = await import("@/lib/outreachReplies.server");
        const replies = await checkAllReplies();
        return Response.json({ success: true, sent, replies });
      },
    },
  },
});
