import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { STATUSES, statusMeta, loadTotals, type Company, type Load, type LoadStatus } from "@/lib/tms";
import { BULK_TARGETS, bulkStatusSkip, loadActSkip, statusWarnings, type LoadListAct } from "@/lib/bulkStatus";
import { invoiceable } from "@/lib/batchInvoice";
import { dayText } from "@/lib/reportExport";
import { BulkActionBar, exportAction, type BulkAction } from "@/components/BulkActionBar";
import { BatchInvoiceDialog } from "@/components/BatchInvoiceDialog";

/** Actions offered on a generated list of loads, in the order given. */
export type LoadListActionKey = "paid" | "paid_closeout" | "delivered" | "status" | "closeout" | "invoice" | "checkcall" | "pod" | "carrier_paid" | "export";

const STATUS_OPTIONS = STATUSES.filter((s) => BULK_TARGETS.includes(s.value)).map((s) => ({ value: s.value, label: s.label }));
const plural = (n: number) => `${n} load${n === 1 ? "" : "s"}`;

async function setStatus(l: Load, t: LoadStatus) {
  const skip = bulkStatusSkip(l, t);
  if (skip) return `${l.load_number}: skipped — ${skip}`;
  const { data, error } = await supabase.from("loads").update({ status: t }).eq("id", l.id).select("id");
  return error ? `${l.load_number}: ${error.message}` : !data?.length ? `${l.load_number}: not allowed to change this load` : null;
}

async function patch(l: Load, act: LoadListAct, row: Partial<Load>) {
  const skip = loadActSkip(l, act);
  if (skip) return `${l.load_number}: skipped — ${skip}`;
  const { data, error } = await supabase.from("loads").update(row as never).eq("id", l.id).select("id");
  return error ? `${l.load_number}: ${error.message}` : !data?.length ? `${l.load_number}: not allowed to change this load` : null;
}

const statusAction = (t: LoadStatus, value: string, label: string, hint: string): BulkAction<Load> => ({
  value, label, hint,
  points: (items) => [...statusWarnings(items, t, statusMeta(t).label)],
  each: (l) => setStatus(l, t),
});

/** Shared definitions keep accounting and generated load lists on the same safeguards. */
export function buildLoadListActions({ actions, companies, customerName, title = "Loads", onInvoice }: {
  actions: LoadListActionKey[]; companies?: Company[]; customerName?: (id: string | null) => string; title?: string; onInvoice?: (loads: Load[]) => void;
}) {
  const name = (id: string | null) => customerName?.(id) ?? companies?.find((c) => c.id === id)?.name ?? "";
  const all: Record<LoadListActionKey, BulkAction<Load> | null> = {
    paid: statusAction("paid", "paid", "Mark customer paid", "Changes the checked loads to Completed / Paid (the customer paid us). Needs a customer invoice on file. Carrier pay is not touched."),
    paid_closeout: {
      value: "paid_closeout", label: "Mark customer paid + close out", financeOnly: true,
      hint: "Records customer payment and closes out each checked load. Confirm the customer really paid; this does not read or change QuickBooks or mark the carrier paid.",
      input: { label: "Closeout note (required)" },
      points: (items) => [`${items.length} checked loads will be reviewed for customer Paid + Closeout.`, "Confirm customer payment was received. This is a manual TMS action, not a QuickBooks balance check.", "Loads without a customer invoice are refused. Cancelled loads are skipped. Already closed-out loads can still be marked customer paid; their original closeout record stays unchanged.", "A load is closed out only after its Paid update succeeds; if closeout fails it remains Paid and the error is listed.", "Carrier payment, invoice amounts and QuickBooks stay unchanged. Your closeout note is saved."],
      each: async (l, note) => {
        if (l.status === "cancelled") return `${l.load_number}: skipped — cancelled`;
        if (l.status !== "paid") {
          const error = await setStatus(l, "paid");
          if (error) return error;
        }
        if (l.closed_at) return null;
        const { data, error } = await supabase.rpc("batch_load_action", { _ids: [l.id], _action: "closeout", _note: note.trim() });
        const result = (data as unknown as { ok: boolean; error?: string }[] | null)?.[0];
        return error || !result?.ok ? `${l.load_number}: customer paid, but closeout failed — ${error?.message ?? result?.error ?? "could not close out"}` : null;
      },
    },
    delivered: statusAction("delivered", "delivered", "Mark delivered", "Changes the checked loads to Delivered. It does not mark the POD received or create invoices."),
    status: {
      value: "status", label: "Change status", hint: "Changes the checked loads to the status you pick. Each load still has to pass the normal load rules.",
      param: { label: "New status", options: STATUS_OPTIONS },
      points: (items, p) => (p ? statusWarnings(items, p as LoadStatus, statusMeta(p as LoadStatus).label) : []),
      each: (l, p) => setStatus(l, p as LoadStatus),
    },
    closeout: {
      value: "closeout", label: "Close out", hint: "Files the checked delivered/invoiced/paid loads away as finished. Money, invoices and QuickBooks don't change. Needs a note.",
      input: { label: "Closeout note (required)" },
      points: (items) => {
        const ok = items.filter((l) => !loadActSkip(l, "closeout")).length;
        return [`${plural(ok)} will be closed out${items.length - ok ? `; ${items.length - ok} skipped (not delivered yet or already closed out)` : ""}.`, "They leave the active Dispatch board. You can still find them with Show all, Closed out, or Reports.", "Status, customer invoice, carrier pay and QuickBooks don't change.", "Your note is saved on each load."];
      },
      each: async (l, note) => {
        const skip = loadActSkip(l, "closeout");
        if (skip) return `${l.load_number}: skipped — ${skip}`;
        const { data, error } = await supabase.rpc("batch_load_action", { _ids: [l.id], _action: "closeout", _note: note.trim() });
        if (error) return `${l.load_number}: ${error.message}`;
        const r = (data as unknown as { ok: boolean; error?: string }[])?.[0];
        return r?.ok ? null : `${l.load_number}: ${r?.error ?? "could not close out"}`;
      },
    },
    invoice: companies ? {
      value: "invoice", label: "Create invoices", hint: "Opens the invoice window for the checked delivered/invoiced loads so you can create them (one each or combined). Nothing is sent until you confirm there.",
      all: (items) => { const ok = items.filter((l) => invoiceable(l) && !l.closed_at); if (!ok.length) toast.error("None of the checked loads can be invoiced (they must be Delivered or Invoiced and not closed out)."); else onInvoice?.(ok); },
    } : null,
    checkcall: {
      value: "checkcall", label: "Log check call now", hint: "Records a check call at the current time on each checked load that is still moving.",
      points: (items) => [`${plural(items.filter((l) => !loadActSkip(l, "checkcall")).length)} get a check call logged for right now.`, "Delivered, cancelled and closed-out loads are skipped."],
      each: (l) => patch(l, "checkcall", { last_check_call: new Date().toISOString() }),
    },
    pod: {
      value: "pod", label: "Mark POD received", hint: "Marks the signed POD as received on each checked load. It doesn't upload a file or change the status.",
      points: (items) => [`${plural(items.filter((l) => !loadActSkip(l, "pod")).length)} will show POD received.`, "This does not upload a document — make sure the POD is really on file.", "For carrier loads, this starts the carrier's pay clock."],
      each: (l) => patch(l, "pod", { pod_received: true }),
    },
    carrier_paid: {
      value: "carrier_paid", label: "Mark carrier paid", financeOnly: true,
      hint: "Records the carrier as paid on each checked load (admin/accountant only). Doesn't send money or change QuickBooks.",
      input: { label: "Check / payment ref (optional)", optional: true },
      points: (items) => {
        const ok = items.filter((l) => !loadActSkip(l, "carrier_paid"));
        return [`${plural(ok.length)} will be marked paid to the carrier (${ok.reduce((s, l) => s + loadTotals(l).cost, 0).toLocaleString("en-US", { style: "currency", currency: "USD" })}).`, "Company-truck loads, loads already paid and loads not delivered are skipped.", "No money is sent and QuickBooks isn't changed. The customer invoice status stays the same."];
      },
      each: (l, ref) => patch(l, "carrier_paid", { carrier_paid_at: new Date().toISOString(), carrier_paid_ref: ref.trim() || null }),
    },
    export: exportAction<Load>(title, ["Load", "Customer", "Customer ref #", "Status", "Pickup", "Delivery", "Origin", "Destination", "Customer rate", "Carrier pay"],
      (l) => [l.load_number, name(l.customer_id), l.customer_ref, statusMeta(l.status).label, l.pickup_at ? dayText(l.pickup_at) : "", l.delivery_at ? dayText(l.delivery_at) : "",
        `${l.origin_city}, ${l.origin_state}`, `${l.dest_city}, ${l.dest_state}`, loadTotals(l).revenue.toFixed(2), loadTotals(l).cost.toFixed(2)]),
  };
  return actions.map((k) => all[k]).filter((a): a is BulkAction<Load> => !!a);
}

/** Check-box action bar for any generated list of loads (alerts, past-due lists, review lists). */
export function LoadListBar({ loads, total, onClear, actions, companies, customerName, title = "Loads" }: {
  loads: Load[]; total: number; onClear: () => void; actions: LoadListActionKey[]; companies?: Company[]; customerName?: (id: string | null) => string; title?: string;
}) {
  const [invoicing, setInvoicing] = useState<Load[] | null>(null);
  const list = buildLoadListActions({ actions, companies, customerName, title, onInvoice: setInvoicing });
  return (
    <>
      <BulkActionBar items={loads} total={total} actions={list} onClear={onClear} noun="loads"
        invalidate={["loads", "load-work", "due_reminders", "qb_sync", "carrier_pay_due", "carrier_payments", "load_notes"]} />
      {invoicing && companies && <BatchInvoiceDialog open loads={invoicing} companies={companies} onOpenChange={(o) => !o && setInvoicing(null)} onDone={() => { setInvoicing(null); onClear(); }} />}
    </>
  );
}
