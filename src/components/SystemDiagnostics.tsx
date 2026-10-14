import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Activity, CheckCircle2, AlertTriangle, XCircle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

type Result = { name: string; status: "ok" | "slow" | "fail"; ms: number; detail: string };

const TABLES: [string, string][] = [
  ["loads", "Loads"], ["carriers", "Carriers"], ["companies", "Directory"], ["profiles", "Team"],
  ["fleet_units", "Fleet trucks"], ["drivers", "Drivers"], ["leads", "Leads"], ["quotes", "Quotes"],
  ["qb_sync", "Accounting"], ["chat_messages", "Team chat"], ["load_tracking_pings", "Driver check-ins"],
];

async function timed(name: string, fn: () => Promise<string>): Promise<Result> {
  const t = performance.now();
  try {
    const detail = await fn();
    const ms = Math.round(performance.now() - t);
    return { name, ms, detail, status: ms > 2500 ? "slow" : "ok" };
  } catch (e) {
    return { name, ms: Math.round(performance.now() - t), detail: (e as Error).message || "Failed", status: "fail" };
  }
}

/** Admin-only health check of the running app: sign-in, every data area, file storage, browser memory. */
export function SystemDiagnostics() {
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Result[]>([]);

  const run = async () => {
    setRunning(true);
    setResults([]);
    const out: Result[] = [];
    const push = (r: Result) => { out.push(r); setResults([...out]); };

    push(await timed("Sign-in session", async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) throw new Error("Not signed in");
      return data.user.email ?? "OK";
    }));
    for (const [table, label] of TABLES) {
      push(await timed(label, async () => {
        const { count, error } = await supabase.from(table as "loads").select("id", { count: "exact", head: true });
        if (error) throw error;
        return `${(count ?? 0).toLocaleString()} records`;
      }));
    }
    for (const bucket of ["carrier-docs", "load-docs"]) {
      push(await timed(`File storage (${bucket})`, async () => {
        const { error } = await supabase.storage.from(bucket).list("", { limit: 1 });
        if (error) throw error;
        return "Reachable";
      }));
    }
    push(await timed("Live updates (chat)", () => new Promise<string>((resolve, reject) => {
      const ch = supabase.channel(`diag-${Date.now()}`);
      const timer = setTimeout(() => { supabase.removeChannel(ch); reject(new Error("No response in 8s")); }, 8000);
      ch.subscribe((s) => {
        if (s === "SUBSCRIBED") { clearTimeout(timer); supabase.removeChannel(ch); resolve("Connected"); }
        if (s === "CHANNEL_ERROR" || s === "TIMED_OUT") { clearTimeout(timer); supabase.removeChannel(ch); reject(new Error(s)); }
      });
    })));
    push(await timed("This browser", async () => {
      const cached = qc.getQueryCache().getAll().length;
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      const mb = mem ? Math.round(mem.usedJSHeapSize / 1048576) : null;
      const channels = supabase.getChannels().length;
      if (mb && mb > 700) throw new Error(`High memory use: ${mb} MB — reload the page`);
      return `${cached} cached lists · ${channels} live connections${mb ? ` · ${mb} MB memory` : ""}`;
    }));
    setRunning(false);
  };

  const bad = results.filter((r) => r.status !== "ok").length;
  const Icon = { ok: CheckCircle2, slow: AlertTriangle, fail: XCircle };
  const tone = { ok: "text-primary", slow: "text-gold", fail: "text-destructive" };

  return (
    <div className="rounded border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-xl uppercase">System diagnostics</h2>
          <p className="text-sm text-muted-foreground">Checks sign-in, every section's data, file storage, live updates and this browser.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { qc.clear(); window.location.reload(); }}>Clear cache & reload</Button>
          <Button onClick={run} disabled={running}>
            {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Activity className="mr-2 h-4 w-4" />}Run check
          </Button>
        </div>
      </div>
      {results.length > 0 && (
        <div className="mt-4 space-y-1">
          {results.map((r) => {
            const I = Icon[r.status];
            return (
              <div key={r.name} className="flex items-center gap-3 rounded px-2 py-1 text-sm hover:bg-muted/40">
                <I className={`h-4 w-4 shrink-0 ${tone[r.status]}`} />
                <span className="w-48 shrink-0 font-medium">{r.name}</span>
                <span className="flex-1 text-muted-foreground">{r.detail}</span>
                <span className={`tabular-nums ${tone[r.status]}`}>{r.ms} ms</span>
              </div>
            );
          })}
          {!running && (
            <p className={`pt-2 text-sm ${bad ? "text-gold" : "text-primary"}`}>
              {bad ? `${bad} item(s) need attention (slow = over 2.5 s).` : "Everything is healthy."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
