import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppWindow, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { loadsQuery, companiesQuery } from "@/lib/queries";
import { qbStatus } from "@/lib/quickbooks.functions";
import { useAppWindows, type AppWindowKind } from "@/lib/appWindows";
import { QbReconcileDialog } from "@/components/QbReconcileDialog";
import { ReviewAssistantDialog } from "@/components/ReviewAssistantDialog";

const TITLES: Record<AppWindowKind, string> = { qbMatch: "QuickBooks match", reviewAssistant: "Review assistant" };

export function AppWindowHost() {
  const { windows, openWindow, minimizeWindow, closeWindow } = useAppWindows();
  const any = Object.keys(windows).length > 0;
  const qbStatusFn = useServerFn(qbStatus);
  const { data: loads } = useQuery({ ...loadsQuery, enabled: any });
  const { data: companies } = useQuery({ ...companiesQuery, enabled: any });
  const { data: sync } = useQuery({
    queryKey: ["qb_sync"], enabled: any,
    queryFn: async () => ((await supabase.from("qb_sync").select("*").order("created_at", { ascending: false })).data ?? []),
  });
  const { data: qbs } = useQuery({ queryKey: ["qb_status"], queryFn: () => qbStatusFn(), enabled: any });
  if (!any) return null;
  const ready = loads && companies && sync;
  const kinds = Object.keys(windows) as AppWindowKind[];
  return <>
    {ready && windows.qbMatch && <QbReconcileDialog open={windows.qbMatch === "open"} onOpenChange={(o) => { if (!o) closeWindow("qbMatch"); }} onMinimize={() => minimizeWindow("qbMatch")}
      loads={loads} companies={companies} sync={sync} available={{ brokerage: !!qbs?.brokerage.connected, fleet: !!qbs?.fleet.connected }} />}
    {ready && windows.reviewAssistant && <ReviewAssistantDialog open={windows.reviewAssistant === "open"} onOpenChange={(o) => { if (!o) closeWindow("reviewAssistant"); }} onMinimize={() => minimizeWindow("reviewAssistant")}
      loads={loads} companies={companies} sync={sync} />}
    <div className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] left-3 z-40 flex flex-col gap-2 print:hidden lg:bottom-4">
      {!ready && <div className="rounded border bg-card px-3 py-2 text-xs text-muted-foreground shadow">Opening window…</div>}
      {kinds.filter((k) => windows[k] === "min").map((k) => (
        <button key={k} type="button" onClick={() => openWindow(k)} className="flex items-center gap-2 rounded border border-gold/60 bg-card px-3 py-2 text-xs font-medium text-gold shadow-lg hover:bg-accent">
          {k === "reviewAssistant" ? <Sparkles className="h-4 w-4" /> : <AppWindow className="h-4 w-4" />}{TITLES[k]} — click to reopen
        </button>
      ))}
    </div>
  </>;
}
