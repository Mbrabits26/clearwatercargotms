import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SITE = "https://tms.clearwatercargo.com";

/**
 * Emails the people tagged in a load note (one email per tag, deduped by tag id).
 * Only tags the caller just wrote are sent; each person's "tagged in a load note" email switch is honored.
 */
export const emailNoteMentions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: staff } = await context.supabase.rpc("is_staff", { _uid: context.userId });
    if (!staff) throw new Error("Forbidden");
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - 10 * 60_000).toISOString();
    const { data: rows } = await admin.from("chat_mentions").select("id, user_id, body, load_id, created_at")
      .in("id", data.ids).eq("author_id", context.userId).eq("source", "note").gte("created_at", since);
    if (!rows?.length) return { sent: 0, skipped: 0 };
    const loadId = rows[0]!.load_id;
    const userIds = [...new Set(rows.map((r) => r.user_id))];
    const [{ data: load }, { data: people }, { data: prefs }] = await Promise.all([
      loadId ? admin.from("loads").select("id, load_number, origin_city, origin_state, dest_city, dest_state").eq("id", loadId).maybeSingle() : Promise.resolve({ data: null }),
      admin.from("profiles").select("id, full_name, email").in("id", [...userIds, context.userId]),
      admin.from("notification_prefs").select("user_id, email_mentions").in("user_id", userIds),
    ]);
    const author = people?.find((p) => p.id === context.userId);
    const authorName = author?.full_name || author?.email?.split("@")[0] || "A teammate";
    const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
    let sent = 0, skipped = 0;
    for (const r of rows) {
      const to = people?.find((p) => p.id === r.user_id)?.email;
      if (!to || prefs?.find((p) => p.user_id === r.user_id)?.email_mentions === false) { skipped++; continue; }
      try {
        const res = await sendTemplateEmail("note-mention", to, {
          templateData: {
            author: authorName,
            loadNumber: load?.load_number ?? "",
            lane: load ? `${load.origin_city ?? ""}, ${load.origin_state ?? ""} → ${load.dest_city ?? ""}, ${load.dest_state ?? ""}` : undefined,
            note: r.body,
            group: /@(team|everyone)\b/i.test(r.body),
            loadUrl: load ? `${SITE}/dispatch?load=${load.id}` : `${SITE}/dispatch`,
          },
          replyTo: author?.email ?? undefined,
          idempotencyKey: `note-mention-${r.id}`,
        });
        if (res.sent) sent++; else skipped++;
      } catch (e) {
        console.error("note mention email failed", e);
        skipped++;
      }
    }
    return { sent, skipped };
  });
