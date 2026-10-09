import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/tmp-dir-import")({
  server: { handlers: { POST: async ({ request }) => {
    const t = new URL(request.url).searchParams.get("t");
    if (t !== "ed5ceb4b-6be2-4be3-a5d4-45ae8d13cdda") throw new Error("no");
    const rows = (await import("@/lib/tmpDirImport.json")).default as Record<string, string | null>[];
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const n = (s?: string | null) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const all: any[] = [];
    for (let f = 0; ; f += 1000) {
      const { data: p, error } = await supabaseAdmin.from("companies").select("*").range(f, f + 999);
      if (error) throw error; all.push(...p); if (p.length < 1000) break;
    }
    const map = new Map(all.map((c) => [c.kind + "|" + n(c.name) + "|" + n(c.city), c]));
    const ins: any[] = []; const stats: Record<string, number> = {};
    const F = ["address", "city", "state", "zip", "contact_name", "phone", "email", "notes"];
    for (const r of rows) {
      const key = r.kind + "|" + n(r.name) + "|" + n(r.city);
      const ex = map.get(key);
      if (!ex) { ins.push(r); map.set(key, r); stats[r.kind + " added"] = (stats[r.kind + " added"] ?? 0) + 1; continue; }
      if (!ex.id) { stats[r.kind + " dup in file"] = (stats[r.kind + " dup in file"] ?? 0) + 1; continue; }
      const patch: any = {}; for (const k of F) if (!ex[k] && r[k]) { patch[k] = r[k]; ex[k] = r[k]; }
      if (Object.keys(patch).length) { await supabaseAdmin.from("companies").update(patch).eq("id", ex.id); stats[r.kind + " filled"] = (stats[r.kind + " filled"] ?? 0) + 1; }
      else stats[r.kind + " unchanged"] = (stats[r.kind + " unchanged"] ?? 0) + 1;
    }
    for (let i = 0; i < ins.length; i += 500) { const { error } = await supabaseAdmin.from("companies").insert(ins.slice(i, i + 500) as any); if (error) throw error; }
    return Response.json(stats);
  } } },
});
