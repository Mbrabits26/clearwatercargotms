import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Only a file the uploader tagged "Signed POD" counts; rate cons, BOLs and other docs never do. */
export const marksPod = (docType: string) => docType === "pod";

/** Lists that show POD status: load lists, work notices and the invoiced/QuickBooks review lists. */
export const POD_QUERY_ROOTS = ["loads", "load-work", "qb_sync"];

/** After a Signed POD upload, tick the load's "Signed POD received" box (pod_received_at is DB-stamped) and refresh every POD indicator. */
export async function markPodReceived(loadId: string, qc: QueryClient): Promise<string | null> {
  const { error } = await supabase.from("loads").update({ pod_received: true }).eq("id", loadId).eq("pod_received", false);
  qc.invalidateQueries({ predicate: (q) => POD_QUERY_ROOTS.includes(String(q.queryKey[0])) });
  return error?.message ?? null;
}
