import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { toast } from "sonner";
import { Plus, Pencil } from "lucide-react";
import { useReviewChanges, diff } from "@/components/ReviewChanges";
import { supabase } from "@/integrations/supabase/client";
import { companiesQuery, profilesQuery } from "@/lib/queries";
import { ConfirmDelete } from "@/components/ConfirmDelete";
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
  const [kind, setKind] = useState<string>("customer");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const { ask, dialog } = useReviewChanges();
  const rows = data.filter((c) => c.kind === kind && `${c.name} ${c.city}`.toLowerCase().includes(q.toLowerCase()));
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
      <div className="overflow-x-auto rounded-md border bg-card">
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Contact</TableHead><TableHead>Phone</TableHead><TableHead>Address</TableHead>{kind === "customer" && <TableHead>Brought in by</TableHead>}<TableHead /></TableRow></TableHeader>
          <TableBody>
            {rows.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell>{c.contact_name}</TableCell>
                <TableCell>{c.phone}</TableCell>
                <TableCell className="text-muted-foreground">{c.address}, {c.city}, {c.state} {c.zip}</TableCell>
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
            {!rows.length && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Nothing here yet.</TableCell></TableRow>}
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
