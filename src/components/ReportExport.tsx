import { useState } from "react";
import { toast } from "sonner";
import { Download, FileDown, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ReportSpec } from "@/lib/reportExport";

/** Print / PDF / CSV buttons for any report or list. `build` runs only when clicked, using what's on screen. */
export function ReportExport({ build, size = "sm", className }: { build: () => ReportSpec | null; size?: "sm" | "default"; className?: string }) {
  const [busy, setBusy] = useState(false);
  const go = async (how: "print" | "pdf" | "csv") => {
    const spec = build();
    if (!spec) return toast.info("Nothing to export yet.");
    setBusy(true);
    try {
      const m = await import("@/lib/reportExport");
      if (how === "csv") m.downloadReportCsv(spec);
      else if (how === "pdf") await m.downloadReportPdf(spec);
      else await m.printReport(spec);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className={cn("flex gap-1.5 print:hidden", className)}>
      <Button type="button" size={size} variant="outline" disabled={busy} onClick={() => go("print")}><Printer className="mr-1 h-4 w-4" />Print</Button>
      <Button type="button" size={size} variant="outline" disabled={busy} onClick={() => go("pdf")}><FileDown className="mr-1 h-4 w-4" />PDF</Button>
      <Button type="button" size={size} variant="outline" disabled={busy} onClick={() => go("csv")}><Download className="mr-1 h-4 w-4" />CSV</Button>
    </div>
  );
}
