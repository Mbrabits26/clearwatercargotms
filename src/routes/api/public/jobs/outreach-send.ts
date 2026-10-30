import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

// Runs every few minutes; sends at most one due cold email per sender per run, inside business hours.
export const Route = createFileRoute("/api/public/jobs/outreach-send")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFailure = await authenticateCronRequest(request);
        if (authFailure) return authFailure;
        const { sendDueOutreach } = await import("@/lib/outreach.server");
        const sent = await sendDueOutreach();
        return Response.json({ success: true, sent });
      },
    },
  },
});
