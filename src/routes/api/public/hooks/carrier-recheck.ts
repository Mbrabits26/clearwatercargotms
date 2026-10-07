import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/**
 * Weekly carrier safety & authority re-check.
 * Auth: LOVABLE_CRON_SECRET bearer, or the DB-held cron token (market_rate_cache key "cron_token")
 * so pg_cron can call it with a token we control.
 */
export const Route = createFileRoute("/api/public/hooks/carrier-recheck")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        if (denied) {
          // Fall back to the DB-held token used by the pg_cron job.
          const token = /^Bearer ([^\s,]+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
          const { data: row } = await supabaseAdmin.from("market_rate_cache").select("result").eq("key", "cron_token").maybeSingle();
          const expected = (row?.result as { token?: string } | null)?.token;
          if (!token || !expected || token !== expected) return denied;
        }

        const { lookupCarrierFull } = await import("@/lib/fmcsa.server");
        const webkey = process.env["FMCSA_WEBKEY"];

        const { data: carriers, error } = await supabaseAdmin
          .from("carriers")
          .select("id, legal_name, dot_number, mc_number, authority_status, safety_rating, status")
          .neq("status", "dnu")
          .not("dot_number", "is", null);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const changes: { name: string; what: string; from: string; to: string }[] = [];
        let checked = 0, failed = 0, cached = 0;

        const list = carriers ?? [];
        for (let i = 0; i < list.length; i += 5) {
          await Promise.all(list.slice(i, i + 5).map(async (c) => {
            try {
              const ck = `fmcsa2:dot${c.dot_number}`;
              const { data: hit } = await supabaseAdmin.from("market_rate_cache").select("result, fetched_at").eq("key", ck).maybeSingle();
              let r;
              if (hit && Date.now() - new Date(hit.fetched_at).getTime() < 86400000) {
                r = hit.result as unknown as Awaited<ReturnType<typeof lookupCarrierFull>>;
                cached++;
              } else {
                r = await lookupCarrierFull(c.mc_number, c.dot_number, webkey);
                await supabaseAdmin.from("market_rate_cache").upsert({ key: ck, result: r as never, fetched_at: new Date().toISOString() });
              }
              if (r.source === "blocked") { failed++; return; }
              checked++;
              const upd: Record<string, string> = {};
              if (r.authority_status !== c.authority_status) {
                changes.push({ name: c.legal_name, what: "Operating authority", from: c.authority_status, to: r.authority_status });
                upd.authority_status = r.authority_status;
              }
              if (r.safety_rating && r.safety_rating !== (c.safety_rating ?? "Not Rated")) {
                changes.push({ name: c.legal_name, what: "Safety rating", from: c.safety_rating ?? "Not Rated", to: r.safety_rating });
                upd.safety_rating = r.safety_rating;
              }
              if (Object.keys(upd).length) await supabaseAdmin.from("carriers").update(upd).eq("id", c.id);
            } catch { failed++; }
          }));
        }

        // Post change notices + a summary to team chat, authored as the first admin.
        const { data: adminRole } = await supabaseAdmin.from("user_roles").select("user_id").eq("role", "admin").limit(1).maybeSingle();
        const authorId = adminRole?.user_id;
        if (authorId) {
          const rows = changes.map((ch) => ({
            channel: "team", author_id: authorId,
            body: `⚠️ Carrier watch: ${ch.name} — ${ch.what} changed: ${ch.from} → ${ch.to}. ${ch.what === "Operating authority" && ch.to !== "Authorized" ? "This carrier is now blocked from new load assignments." : "Review before booking."}`,
          }));
          const blocked = (carriers ?? []).filter((c) => c.authority_status !== "Authorized").length
            + changes.filter((c) => c.what === "Operating authority" && c.to !== "Authorized").length;
          rows.push({
            channel: "team", author_id: authorId,
            body: `📋 Weekly carrier check complete: ${checked} checked (${cached} from cache), ${changes.length} status change${changes.length === 1 ? "" : "s"}, ${failed} could not be reached, ~${blocked} currently not Authorized.`,
          });
          await supabaseAdmin.from("chat_messages").insert(rows);
        }

        return Response.json({ ok: true, checked, cached, failed, changes: changes.length });
      },
    },
  },
});
