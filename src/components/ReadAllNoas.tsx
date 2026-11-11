import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { readAllNoas } from "@/lib/noa.functions";

/** Finance-only: reads every NOA on file and fills blank factoring/bank fields. */
export function ReadAllNoasButton({ carrierName }: { carrierName: (id: string) => string }) {
  const run = useServerFn(readAllNoas);
  const qc = useQueryClient();
  const [busy, setBusy] = useState("");
  const go = async () => {
    if (!confirm("Read every NOA on file? Only blank factoring and bank fields get filled — nothing already saved is changed.")) return;
    const lines: string[] = []; let off = 0; let total = 1; let updated = 0;
    try {
      while (off < total) {
        setBusy(`${off}/${total === 1 ? "…" : total}`);
        const r = await run({ data: { offset: off } });
        total = r.total; if (r.next === off) break; off = r.next;
        for (const x of r.results) {
          if (x.filled.length) { updated++; lines.push(`${carrierName(x.carrierId)}: ${x.filled.join(", ").replace(/_/g, " ")}`); }
          else if (x.error) lines.push(`${carrierName(x.carrierId)}: ${x.error}`);
        }
      }
      toast.success(`Read ${total} NOAs — ${updated} carriers updated`, { duration: 30000, description: lines.slice(0, 30).join(" · ") || "Nothing new to fill." });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't read NOAs"); }
    qc.invalidateQueries({ queryKey: ["carriers"] }); qc.invalidateQueries({ queryKey: ["carrier_payment_accounts"] });
    setBusy("");
  };
  return <Button size="sm" variant="secondary" disabled={!!busy} onClick={go}>{busy ? `Reading NOAs ${busy}` : "Read all NOAs"}</Button>;
}
