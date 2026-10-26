import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Download, FileDown, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Hint } from "@/components/ActionGuard";
import type { ReportSpec } from "@/lib/reportExport";

/**
 * Print / PDF / CSV buttons for any report or list. `build` runs only when clicked, using what's on screen.
 * `hotkey` makes Ctrl/Cmd+P print this plain report instead of the screen (use on one export per page).
 */
export function ReportExport({ build, size = "sm", className, hotkey }: { build: () => ReportSpec | null; size?: "sm" | "default"; className?: string; hotkey?: boolean }) {
  const [busy, setBusy] = useState(false);
  const go = async (how: "print" | "pdf" | "csv") => {
    const spec = build();
    if (!spec) return toast.info("Nothing to export yet.");
    setBusy(true);
    try {
      const m = await import("@/lib/reportExport");
      if (how === "csv") m.downloadReportCsv(spec);
      else if (how === "pdf") m.downloadReportPdf(spec);
      else m.printReport(spec);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    if (!hotkey) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "p") { e.preventDefault(); void goRef.current("print"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotkey]);
  return (
    <div className={cn("flex gap-1.5 print:hidden", className)}>
      <Hint text="Print this list as a plain report."><Button type="button" size={size} variant="outline" disabled={busy} onClick={() => go("print")}><Printer className="mr-1 h-4 w-4" />Print</Button></Hint>
      <Hint text="Download this list as a PDF file."><Button type="button" size={size} variant="outline" disabled={busy} onClick={() => go("pdf")}><FileDown className="mr-1 h-4 w-4" />PDF</Button></Hint>
      <Hint text="Download this list as a spreadsheet (CSV) file."><Button type="button" size={size} variant="outline" disabled={busy} onClick={() => go("csv")}><Download className="mr-1 h-4 w-4" />CSV</Button></Hint>
    </div>
  );
}
