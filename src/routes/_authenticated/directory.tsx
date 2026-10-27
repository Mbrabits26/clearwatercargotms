import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useEffect, useState } from "react";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { toast } from "sonner";
import { Plus, Pencil } from "lucide-react";
import { CUSTOMER_TERMS } from "@/lib/tms";
import { useReviewChanges, diff } from "@/components/ReviewChanges";
import { supabase } from "@/integrations/supabase/client";
import { companiesQuery, profilesQuery } from "@/lib/queries";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { BulkActionBar, SelectAllBox, useSelection, deleteAction, exportAction, type BulkAction } from "@/components/BulkActionBar";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { BulkImportButton } from "@/components/BulkImportDialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/directory")({
  head: () => ({
    meta: [
      { title: "Directory — Clearwater Cargo TMS" },
      { name: "description", content: "Shared customers, shippers and consignees." },
      { property: "og:title", content: "Directory — Clearwater Cargo TMS" },
      { property: "og:description", content: "Shared customers, shippers and consignees." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context }) => Promise.all([context.queryClient.ensureQueryData(companiesQuery), context.queryClient.ensureQueryData(profilesQuery)]),
  component: Directory,
});

const KINDS = [
  { v: "customer", l: "Customers" },
  { v: "shipper", l: "Shippers" },
  { v: "consignee", l: "Consignees" },
] as const;
const FIELDS = [
  ["name", "Business name"], ["contact_name", "Contact"], ["phone", "Phone"], ["email", "Email"],
  ["address", "Street address"], ["city", "City"], ["state", "State"], ["zip", "ZIP"],
] as const;

function Directory() {
  const { data } = useSuspenseQuery(companiesQuery);
  const qc = useQueryClient();
  const { data: profiles } = useSuspenseQuery(profilesQuery);
  const setRep = async (id: string, rep: string) => {
    const { error } = await supabase.from("companies").update({ sales_broker_id: rep || null }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Saved");
    qc.invalidateQueries({ queryKey: ["companies"] });
  };
  const setTerms = async (id: string, t: string) => {
    const { error } = await supabase.from("companies").update({ pay_terms: t }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Payment terms saved");
    qc.invalidateQueries({ queryKey: ["companies"] });
  };
  const [kind, setKind] = useState<string>("customer");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const { ask, dialog } = useReviewChanges();
  const dq = useDeferredValue(q).toLowerCase();
  const rows = data.filter((c) => c.kind === kind && `${c.name} ${c.city}`.toLowerCase().includes(dq));
  // Draw the first rows only; "Show more" adds the rest so thousands of customers don't freeze the page.
  const [limit, setLimit] = useState(200);
  const bulk = useSelection();
  useEffect(() => { setLimit(200); }, [dq, kind]);
  useEffect(() => { bulk.clear(); }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps
  type Co = (typeof data)[number];
  const coUpdate = async (c: Co, patch: Record<string, unknown>) => {
    const { error, data: d } = await supabase.from("companies").update(patch as never).eq("id", c.id).select("id");
    return error ? `${c.name}: ${error.message}` : !d?.length ? `${c.name}: not allowed to change` : null;
  };
  const shownRows = rows.slice(0, limit);
  const picked = data.filter((c) => c.kind === kind && bulk.has(c.id));
  const coActions: BulkAction<Co>[] = [
    ...(kind === "customer" ? [
      { value: "terms", label: "Set payment terms", hint: "Changes the payment terms on the checked customers.", param: { label: "Terms", options: CUSTOMER_TERMS.map((t) => ({ value: t, label: t })) },
        points: (it: Co[], t: string) => [`${it.length} customers will be set to ${t}.`, "Invoices already created keep their terms."], each: (c: Co, t: string) => coUpdate(c, { pay_terms: t }) },
      { value: "bill", label: "Set bill-through company", hint: "Sets which company invoices these customers' loads by default.",
        param: { label: "Bill through", options: [{ value: "auto", label: "Automatic (by truck)" }, { value: "invoice", label: "Clearwater Cargo" }, { value: "fleet_invoice", label: "Foust Farms" }] },
        points: (it: Co[], b: string) => [`${it.length} customers will default to ${b === "auto" ? "Automatic (by truck)" : b === "invoice" ? "Clearwater Cargo" : "Foust Farms"} for billing.`, "Applies to their loads left on Automatic. Invoices already sent to QuickBooks don't move."],
        each: (c: Co, b: string) => coUpdate(c, { bill_through: b === "auto" ? null : b }) },
      { value: "rep", label: "Set brought in by", hint: "Sets the broker who brought in the checked customers.",
        param: { label: "Broker", options: [{ value: "none", label: "Not set" }, ...profiles.map((p) => ({ value: p.id, label: p.full_name ?? p.email ?? "" }))] },
        each: (c: Co, r: string) => coUpdate(c, { sales_broker_id: r === "none" ? null : r }) },
    ] : []),
    exportAction<Co>(`${label}s`, ["Name", "Contact", "Phone", "Email", "Address", "City", "State", "ZIP", ...(kind === "customer" ? ["Payment terms"] : [])],
      (c) => [c.name, c.contact_name, c.phone, c.email, c.address, c.city, c.state, c.zip, ...(kind === "customer" ? [c.pay_terms ?? "Net 30"] : [])]),
    deleteAction<Co>("companies", (c) => c.name, `${label.toLowerCase()}s`),
  ];
  const label = KINDS.find((k) => k.v === kind)!.l.slice(0, -1);
  const editing = editId ? data.find((c) => c.id === editId) : null;
  const startEdit = (c: (typeof data)[number]) => {
    setF(Object.fromEntries(FIELDS.map(([k]) => [k, String((c as Record<string, unknown>)[k] ?? "")])));
    setEditId(c.id); setOpen(true);
  };

  const [also, setAlso] = useState<string[]>([]);
  const save = async () => {
    if (!f.name) return toast.error("Business name is required");
    const base = { name: f.name, contact_name: f.contact_name, phone: f.phone, email: f.email, address: f.address, city: f.city, state: f.state?.toUpperCase(), zip: f.zip };
    if (editing) {
      const changes = diff(FIELDS.map(([k, l]) => ({ label: l, before: (editing as Record<string, unknown>)[k], after: (base as Record<string, unknown>)[k] })));
      if (!changes.length) return toast.info("No changes to save.");
      if (!(await ask(changes))) return;
      const { error } = await supabase.from("companies").update(Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v || null])) as never).eq("id", editing.id);
      if (error) return toast.error(error.message);
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["companies"] });
      setF({}); setEditId(null); setOpen(false);
      return;
    }
    const kinds = [kind, ...also.filter((k) => k !== kind)];
    const norm = (s?: string | null) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const todo = kinds.filter((k) => !data.some((c) => c.kind === k && norm(c.name) === norm(f.name) && norm(c.city) === norm(f.city)));
    if (!todo.length) return toast.error("Already in the Directory");
    const { error } = await supabase.from("companies").insert(todo.map((k) => ({ ...base, kind: k })));
    if (error) return toast.error(error.message);
    toast.success(`Added as ${todo.join(" and ")}`);
    qc.invalidateQueries({ queryKey: ["companies"] });
    setF({});
    setAlso([]);
    setOpen(false);
  };

  return (
    <div className="p-3 sm:p-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-3xl font-bold uppercase">Directory</h1>
        <div className="flex flex-wrap gap-2">
          <BulkImportButton target="company" onDone={() => qc.invalidateQueries({ queryKey: ["companies"] })} />
          <Button onClick={() => { setEditId(null); setF({}); setOpen(true); }}><Plus className="mr-1 h-4 w-4" />Add {label.toLowerCase()}</Button>
        </div>
      </div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <Tabs value={kind} onValueChange={setKind}>
          <TabsList>{KINDS.map((k) => <TabsTrigger key={k.v} value={k.v}>{k.l}</TabsTrigger>)}</TabsList>
        </Tabs>
        <Input className="sm:max-w-xs" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {picked.length > 0 && <div className="mb-3"><BulkActionBar items={picked} total={rows.length} actions={coActions} onClear={bulk.clear} invalidate={["companies"]} noun={`${label.toLowerCase()}s`} /></div>}
      <div className="overflow-x-auto rounded-md border bg-card">
        <Table>
          <TableHeader><TableRow><TableHead className="w-8"><SelectAllBox ids={shownRows.map((c) => c.id)} sel={bulk} /></TableHead><TableHead>Name</TableHead><TableHead>Contact</TableHead><TableHead>Phone</TableHead><TableHead>Address</TableHead>{kind === "customer" && <><TableHead>Payment terms</TableHead><TableHead>Brought in by</TableHead></>}<TableHead /></TableRow></TableHeader>
          <TableBody>
            {shownRows.map((c) => (
              <TableRow key={c.id}>
                <TableCell><Checkbox aria-label={`Select ${c.name}`} checked={bulk.has(c.id)} onCheckedChange={(v) => bulk.toggle(c.id, v === true)} /></TableCell>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell>{c.contact_name}</TableCell>
                <TableCell>{c.phone}</TableCell>
                <TableCell className="text-muted-foreground">{c.address}, {c.city}, {c.state} {c.zip}</TableCell>
                {kind === "customer" && <TableCell>
                  <select aria-label="Payment terms" className="h-8 rounded border bg-background px-2 text-sm" value={c.pay_terms ?? "Net 30"} onChange={(e) => setTerms(c.id, e.target.value)}>
                    {CUSTOMER_TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </TableCell>}
                {kind === "customer" && <TableCell>
                  <select className="h-8 rounded border bg-background px-2 text-sm" value={c.sales_broker_id ?? ""} onChange={(e) => setRep(c.id, e.target.value)}>
                    <option value="">Not set</option>
                    {profiles.map((p) => <option key={p.id} value={p.id}>{p.full_name ?? p.email}</option>)}
                  </select>
                </TableCell>}
                <TableCell className="w-10"><Button size="icon" variant="ghost" aria-label="Edit" onClick={() => startEdit(c)}><Pencil className="h-4 w-4" /></Button></TableCell>
                <TableCell className="w-10"><ConfirmDelete table="companies" id={c.id} label={c.name} what={label} invalidate={["companies"]} linked="Any loads or quotes using this company will keep their details but lose the link to it." /></TableCell>
              </TableRow>
            ))}
            {rows.length > limit && <TableRow><TableCell colSpan={9} className="text-center"><Button size="sm" variant="outline" onClick={() => setLimit((n) => n + 200)}>Show more ({rows.length - limit} more)</Button></TableCell></TableRow>}
            {!rows.length && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">Nothing here yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      {dialog}
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditId(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle className="font-display text-2xl uppercase">{editing ? `Edit ${editing.name}` : `Add ${label.toLowerCase()}`}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {FIELDS.map(([k, l]) => (
              <label key={k} className={`text-xs text-muted-foreground ${k === "name" || k === "address" ? "sm:col-span-2" : ""}`}>{l}
                {k === "address" ? (
                  <AddressAutocomplete value={f.address ?? ""} onChange={(v) => setF((p) => ({ ...p, address: v }))}
                    onPick={(pl) => setF((p) => ({ ...p, address: pl.address, city: pl.city, state: pl.state, zip: pl.zip, name: p.name || pl.name, phone: p.phone || pl.phone }))} />
                ) : (
                  <Input className="mt-1" value={f[k] ?? ""} onChange={(e) => setF((p) => ({ ...p, [k]: e.target.value }))} />
                )}
              </label>
            ))}
          </div>
          {!editing && <div className="flex flex-wrap gap-4 text-sm">
            <span className="text-muted-foreground">Also add as:</span>
            {KINDS.filter((k) => k.v !== kind).map((k) => (
              <label key={k.v} className="flex items-center gap-2">
                <input type="checkbox" checked={also.includes(k.v)} onChange={(e) => setAlso((p) => e.target.checked ? [...p, k.v] : p.filter((x) => x !== k.v))} />
                {k.l.slice(0, -1)}
              </label>
            ))}
          </div>}
          <div className="flex justify-end"><Button onClick={save}>Save</Button></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
