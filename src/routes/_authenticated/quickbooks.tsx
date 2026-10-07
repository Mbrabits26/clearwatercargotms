import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Send, PlugZap, Pencil, Trash2, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { carriersQuery, companiesQuery, loadsQuery } from "@/lib/queries";
import { fmtDate, loadTotals, usd, type Load } from "@/lib/tms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadQuickLook } from "@/components/LoadQuickLook";
import { cn } from "@/lib/utils";

type SyncRow = {
  id: string;
  load_id: string;
  kind: string;
  payee: string | null;
  amount: number;
  status: string;
  qb_ref: string | null;
  error: string | null;
  created_at: string;
  sent_at: string | null;
};

export const Route = createFileRoute("/_authenticated/quickbooks")({
  head: () => ({
    meta: [
      { title: "Accounting — Clearwater Cargo TMS" },
      { name: "description", content: "Customer invoices (AR), carrier bills (AP) and the QuickBooks Online sync queue." },
      { property: "og:title", content: "Accounting — Clearwater Cargo TMS" },
      { property: "og:description", content: "Customer invoices (AR), carrier bills (AP) and the QuickBooks Online sync queue." },
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
  component: Accounting,
});

function Accounting() {
  const { data: loads } = useSuspenseQuery(loadsQuery);
  const { data: companies } = useSuspenseQuery(companiesQuery);
  const { data: carriers } = useSuspenseQuery(carriersQuery);
  const qc = useQueryClient();
  const { data: sync = [] } = useQuery({
    queryKey: ["qb_sync"],
    queryFn: async () => ((await supabase.from("qb_sync").select("*").order("created_at", { ascending: false })).data ?? []) as SyncRow[],
  });
  const [tab, setTab] = useState<"invoice" | "bill" | "log">("invoice");
  const [picked, setPicked] = useState<string[]>([]);
  const [editing, setEditing] = useState<SyncRow | null>(null);

  const synced = (id: string, kind: string) => sync.find((s) => s.load_id === id && s.kind === kind);
  const ar = loads.filter((l) => ["delivered", "invoiced"].includes(l.status));
  const ap = loads.filter((l) => l.carrier_id && l.pod_received && ["delivered", "invoiced", "paid"].includes(l.status));
  const rows = tab === "invoice" ? ar : ap;

  const payee = (l: Load, kind: string) => {
    if (kind === "invoice") return companies.find((c) => c.id === l.customer_id)?.name ?? "Unknown customer";
    const c = carriers.find((x) => x.id === l.carrier_id);
    return c?.factoring_company ? `${c.factoring_company} (for ${c.legal_name})` : c?.legal_name ?? "Unknown carrier";
  };

  const ageDays = (l: Load) => (l.delivery_at ? Math.max(0, Math.floor((Date.now() - new Date(l.delivery_at).getTime()) / 86400_000)) : null);

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

  const remove = async (s: SyncRow) => {
    if (!confirm(`Remove this ${s.kind === "invoice" ? "invoice" : "bill"} from the queue? The load itself is not changed.`)) return;
    const { error } = await supabase.from("qb_sync").delete().eq("id", s.id);
    if (error) return toast.error(error.message);
    toast.success("Removed from the queue.");
    qc.invalidateQueries({ queryKey: ["qb_sync"] });
  };

  const retry = async (s: SyncRow) => {
    const { error } = await supabase.from("qb_sync").update({ status: "queued", error: null }).eq("id", s.id);
    if (error) return toast.error(error.message);
    toast.success("Queued again for sending.");
    qc.invalidateQueries({ queryKey: ["qb_sync"] });
  };

  const arOpen = ar.filter((l) => !synced(l.id, "invoice"));
  const apOpen = ap.filter((l) => !synced(l.id, "bill"));

  return (
    <div className="space-y-5 p-3 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-3xl font-bold uppercase">Accounting</h1>
        {tab !== "log" && <Button onClick={send}><Send className="mr-1 h-4 w-4" />Send selected to QuickBooks</Button>}
      </div>
      <div className="flex items-center gap-3 rounded border border-warning/50 bg-warning/10 p-3 text-sm">
        <PlugZap className="h-4 w-4 text-warning" />
        <span>QuickBooks isn't connected yet. Items you send wait in the queue and go out automatically once your QuickBooks account is linked.</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <Stat k="Invoices ready (AR)" v={usd(arOpen.reduce((s, l) => s + loadTotals(l).revenue, 0))} />
        <Stat k="Carrier bills ready (AP)" v={usd(apOpen.reduce((s, l) => s + loadTotals(l).cost, 0))} />
        <Stat k="Waiting in queue" v={String(sync.filter((s) => s.status === "queued").length)} />
      </div>
      <Tabs value={tab} onValueChange={(v) => { setTab(v as typeof tab); setPicked([]); }}>
        <TabsList>
          <TabsTrigger value="invoice">Customer invoices (AR)</TabsTrigger>
          <TabsTrigger value="bill">Carrier bills (AP)</TabsTrigger>
          <TabsTrigger value="log">Sync log</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="overflow-x-auto rounded-md border bg-card">
        {tab === "log" ? (
          <Table>
            <TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Load</TableHead><TableHead>Payee / customer</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead>Queued</TableHead><TableHead className="w-24">Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {sync.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>{s.kind === "invoice" ? "Invoice (AR)" : "Bill (AP)"}</TableCell>
                  <TableCell>{loads.find((l) => l.id === s.load_id) ? <LoadQuickLook load={loads.find((l) => l.id === s.load_id)!} /> : "—"}</TableCell>
                  <TableCell>{s.payee}</TableCell>
                  <TableCell>{usd(Number(s.amount))}</TableCell>
                  <TableCell>
                    <Pill status={s.status} />
                    {s.error && <div className="mt-1 max-w-56 text-[10px] text-destructive">{s.error}</div>}
                  </TableCell>
                  <TableCell>{fmtDate(s.created_at)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" title="Edit amount / payee" onClick={() => setEditing(s)}><Pencil className="h-3.5 w-3.5" /></Button>
                      {s.status === "error" && <Button size="icon" variant="ghost" title="Retry" onClick={() => retry(s)}><RotateCcw className="h-3.5 w-3.5" /></Button>}
                      <Button size="icon" variant="ghost" title="Remove from queue" onClick={() => remove(s)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!sync.length && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Nothing sent yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <input type="checkbox" checked={picked.length > 0 && picked.length === rows.length} onChange={(e) => setPicked(e.target.checked ? rows.map((r) => r.id) : [])} />
                </TableHead>
                <TableHead>Load</TableHead><TableHead>Lane</TableHead><TableHead>{tab === "invoice" ? "Bill to" : "Pay to"}</TableHead><TableHead>Delivered</TableHead><TableHead>Age</TableHead><TableHead>Amount</TableHead><TableHead>QuickBooks</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((l) => {
                const s = synced(l.id, tab);
                const age = ageDays(l);
                return (
                  <TableRow key={l.id}>
                    <TableCell><input type="checkbox" checked={picked.includes(l.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, l.id] : p.filter((x) => x !== l.id)))} /></TableCell>
                    <TableCell><LoadQuickLook load={l} /></TableCell>
                    <TableCell>{l.origin_city}, {l.origin_state} → {l.dest_city}, {l.dest_state}</TableCell>
                    <TableCell>{payee(l, tab)}</TableCell>
                    <TableCell>{fmtDate(l.delivery_at)}</TableCell>
                    <TableCell className={cn(age !== null && age > 30 && tab === "invoice" && "text-destructive font-medium")}>{age !== null ? `${age}d` : "—"}</TableCell>
                    <TableCell>{usd(tab === "invoice" ? loadTotals(l).revenue : loadTotals(l).cost)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {s ? <Pill status={s.status} /> : <span className="text-xs text-muted-foreground">Not sent</span>}
                        {s && <Button size="icon" variant="ghost" title="Edit amount / payee" onClick={() => setEditing(s)}><Pencil className="h-3.5 w-3.5" /></Button>}
                        {s && s.status === "error" && <Button size="icon" variant="ghost" title="Retry" onClick={() => retry(s)}><RotateCcw className="h-3.5 w-3.5" /></Button>}
                        {s && <Button size="icon" variant="ghost" title="Remove from queue" onClick={() => remove(s)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!rows.length && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">{tab === "invoice" ? "No delivered loads to invoice." : "No loads with a signed POD yet."}</TableCell></TableRow>}
            </TableBody>
          </Table>
        )}
      </div>
      <EditSyncDialog row={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ["qb_sync"] }); }} />
    </div>
  );
}

function EditSyncDialog({ row, onClose, onSaved }: { row: SyncRow | null; onClose: () => void; onSaved: () => void }) {
  const [payee, setPayee] = useState("");
  const [amount, setAmount] = useState("");
  const [openFor, setOpenFor] = useState<string | null>(null);
  if (row && openFor !== row.id) {
    setOpenFor(row.id);
    setPayee(row.payee ?? "");
    setAmount(String(row.amount));
  }

  const save = async () => {
    if (!row) return;
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < 0) return toast.error("Enter a valid amount.");
    const { error } = await supabase.from("qb_sync").update({ payee: payee.trim() || null, amount: amt }).eq("id", row.id);
    if (error) return toast.error(error.message);
    toast.success("Updated.");
    onSaved();
  };

  return (
    <Dialog open={!!row} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Edit {row?.kind === "invoice" ? "invoice" : "bill"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <label className="text-xs text-muted-foreground">Payee / customer
            <Input className="mt-1" value={payee} onChange={(e) => setPayee(e.target.value)} />
          </label>
          <label className="text-xs text-muted-foreground">Amount
            <Input className="mt-1" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <Button className="w-full" onClick={save}>Save changes</Button>
        </div>
      </DialogContent>
    </Dialog>
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
