import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Send, PlugZap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { carriersQuery, companiesQuery, loadsQuery } from "@/lib/queries";
import { fmtDate, loadTotals, usd, type Load } from "@/lib/tms";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/quickbooks")({
  head: () => ({
    meta: [
      { title: "QuickBooks — Clearwater Cargo TMS" },
      { name: "description", content: "Send customer invoices and carrier bills to QuickBooks Online." },
      { property: "og:title", content: "QuickBooks — Clearwater Cargo TMS" },
      { property: "og:description", content: "Send customer invoices and carrier bills to QuickBooks Online." },
    ],
  }),
  beforeLoad: ({ context }) => {
    if (!context.isAdmin) throw redirect({ to: "/dispatch" });
  },
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(loadsQuery),
      context.queryClient.ensureQueryData(companiesQuery),
      context.queryClient.ensureQueryData(carriersQuery),
    ]),
  component: QuickBooks,
});

function QuickBooks() {
  const { data: loads } = useSuspenseQuery(loadsQuery);
  const { data: companies } = useSuspenseQuery(companiesQuery);
  const { data: carriers } = useSuspenseQuery(carriersQuery);
  const qc = useQueryClient();
  const { data: sync = [] } = useQuery({
    queryKey: ["qb_sync"],
    queryFn: async () => (await supabase.from("qb_sync").select("*").order("created_at", { ascending: false })).data ?? [],
  });
  const [tab, setTab] = useState<"invoice" | "bill" | "log">("invoice");
  const [picked, setPicked] = useState<string[]>([]);

  const synced = (id: string, kind: string) => sync.find((s) => s.load_id === id && s.kind === kind);
  const ar = loads.filter((l) => ["delivered", "invoiced"].includes(l.status));
  const ap = loads.filter((l) => l.carrier_id && l.pod_received && ["delivered", "invoiced", "paid"].includes(l.status));
  const rows = tab === "invoice" ? ar : ap;

  const payee = (l: Load, kind: string) => {
    if (kind === "invoice") return companies.find((c) => c.id === l.customer_id)?.name ?? "Unknown customer";
    const c = carriers.find((x) => x.id === l.carrier_id);
    return c?.factoring_company ? `${c.factoring_company} (for ${c.legal_name})` : c?.legal_name ?? "Unknown carrier";
  };

  const send = async () => {
    const chosen = rows.filter((l) => picked.includes(l.id));
    if (!chosen.length) return toast.info("Select at least one load.");
    const kind = tab as "invoice" | "bill";
    const { error } = await supabase.from("qb_sync").upsert(
      chosen.map((l) => ({
        load_id: l.id,
        kind,
        payee: payee(l, kind),
        amount: kind === "invoice" ? loadTotals(l).revenue : loadTotals(l).cost,
        status: "queued",
        error: null,
      })),
      { onConflict: "load_id,kind" },
    );
    if (error) return toast.error(error.message);
    if (kind === "invoice") {
      await supabase.from("loads").update({ status: "invoiced" }).in("id", chosen.filter((l) => l.status === "delivered").map((l) => l.id));
      qc.invalidateQueries({ queryKey: ["loads"] });
    }
    toast.success(`${chosen.length} ${kind === "invoice" ? "invoice(s)" : "bill(s)"} queued for QuickBooks`);
    setPicked([]);
    qc.invalidateQueries({ queryKey: ["qb_sync"] });
  };

  return (
    <div className="space-y-5 p-3 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-3xl font-bold uppercase">QuickBooks Online</h1>
        {tab !== "log" && <Button onClick={send}><Send className="mr-1 h-4 w-4" />Send selected to QuickBooks</Button>}
      </div>
      <div className="flex items-center gap-3 rounded border border-warning/50 bg-warning/10 p-3 text-sm">
        <PlugZap className="h-4 w-4 text-warning" />
        <span>QuickBooks isn't connected yet. Items you send wait in the queue and go out automatically once your QuickBooks account is linked.</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <Stat k="Invoices ready (AR)" v={usd(ar.filter((l) => !synced(l.id, "invoice")).reduce((s, l) => s + loadTotals(l).revenue, 0))} />
        <Stat k="Carrier bills ready (AP)" v={usd(ap.filter((l) => !synced(l.id, "bill")).reduce((s, l) => s + loadTotals(l).cost, 0))} />
        <Stat k="Waiting in queue" v={String(sync.filter((s) => s.status === "queued").length)} />
      </div>
      <Tabs value={tab} onValueChange={(v) => { setTab(v as typeof tab); setPicked([]); }}>
        <TabsList>
          <TabsTrigger value="invoice">Customer invoices</TabsTrigger>
          <TabsTrigger value="bill">Carrier bills</TabsTrigger>
          <TabsTrigger value="log">Sync log</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="overflow-x-auto rounded-md border bg-card">
        {tab === "log" ? (
          <Table>
            <TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Load</TableHead><TableHead>Payee / customer</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead>Queued</TableHead></TableRow></TableHeader>
            <TableBody>
              {sync.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>{s.kind === "invoice" ? "Invoice (AR)" : "Bill (AP)"}</TableCell>
                  <TableCell className="font-mono text-gold">{loads.find((l) => l.id === s.load_id)?.load_number}</TableCell>
                  <TableCell>{s.payee}</TableCell>
                  <TableCell>{usd(Number(s.amount))}</TableCell>
                  <TableCell><Pill status={s.status} /></TableCell>
                  <TableCell>{fmtDate(s.created_at)}</TableCell>
                </TableRow>
              ))}
              {!sync.length && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Nothing sent yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <input type="checkbox" checked={picked.length > 0 && picked.length === rows.length} onChange={(e) => setPicked(e.target.checked ? rows.map((r) => r.id) : [])} />
                </TableHead>
                <TableHead>Load</TableHead><TableHead>Lane</TableHead><TableHead>{tab === "invoice" ? "Bill to" : "Pay to"}</TableHead><TableHead>Delivered</TableHead><TableHead>Amount</TableHead><TableHead>QuickBooks</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((l) => {
                const s = synced(l.id, tab);
                return (
                  <TableRow key={l.id}>
                    <TableCell><input type="checkbox" checked={picked.includes(l.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, l.id] : p.filter((x) => x !== l.id)))} /></TableCell>
                    <TableCell className="font-mono text-gold">{l.load_number}</TableCell>
                    <TableCell>{l.origin_city}, {l.origin_state} → {l.dest_city}, {l.dest_state}</TableCell>
                    <TableCell>{payee(l, tab)}</TableCell>
                    <TableCell>{fmtDate(l.delivery_at)}</TableCell>
                    <TableCell>{usd(tab === "invoice" ? loadTotals(l).revenue : loadTotals(l).cost)}</TableCell>
                    <TableCell>{s ? <Pill status={s.status} /> : <span className="text-xs text-muted-foreground">Not sent</span>}</TableCell>
                  </TableRow>
                );
              })}
              {!rows.length && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">{tab === "invoice" ? "No delivered loads to invoice." : "No loads with a signed POD yet."}</TableCell></TableRow>}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded border bg-card p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{k}</div>
      <div className="font-display text-3xl text-gold">{v}</div>
    </div>
  );
}
function Pill({ status }: { status: string }) {
  const cls = status === "sent" ? "border-success text-success" : status === "error" ? "border-destructive text-destructive" : "border-warning text-warning";
  return <span className={cn("rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider", cls)}>{status}</span>;
}
