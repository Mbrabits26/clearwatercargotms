import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { companiesQuery } from "@/lib/queries";
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
  loader: ({ context }) => context.queryClient.ensureQueryData(companiesQuery),
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
  const [kind, setKind] = useState<string>("customer");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Record<string, string>>({});
  const rows = data.filter((c) => c.kind === kind && `${c.name} ${c.city}`.toLowerCase().includes(q.toLowerCase()));
  const label = KINDS.find((k) => k.v === kind)!.l.slice(0, -1);

  const [also, setAlso] = useState<string[]>([]);
  const save = async () => {
    if (!f.name) return toast.error("Business name is required");
    const kinds = [kind, ...also.filter((k) => k !== kind)];
    const norm = (s?: string | null) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const todo = kinds.filter((k) => !data.some((c) => c.kind === k && norm(c.name) === norm(f.name) && norm(c.city) === norm(f.city)));
    if (!todo.length) return toast.error("Already in the Directory");
    const base = { name: f.name, contact_name: f.contact_name, phone: f.phone, email: f.email, address: f.address, city: f.city, state: f.state?.toUpperCase(), zip: f.zip };
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
          <Button onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" />Add {label.toLowerCase()}</Button>
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
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Contact</TableHead><TableHead>Phone</TableHead><TableHead>Address</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell>{c.contact_name}</TableCell>
                <TableCell>{c.phone}</TableCell>
                <TableCell className="text-muted-foreground">{c.address}, {c.city}, {c.state} {c.zip}</TableCell>
              </TableRow>
            ))}
            {!rows.length && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Nothing here yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle className="font-display text-2xl uppercase">Add {label.toLowerCase()}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {FIELDS.map(([k, l]) => (
              <label key={k} className={`text-xs text-muted-foreground ${k === "name" || k === "address" ? "sm:col-span-2" : ""}`}>{l}
                <Input className="mt-1" value={f[k] ?? ""} onChange={(e) => setF((p) => ({ ...p, [k]: e.target.value }))} />
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <span className="text-muted-foreground">Also add as:</span>
            {KINDS.filter((k) => k.v !== kind).map((k) => (
              <label key={k.v} className="flex items-center gap-2">
                <input type="checkbox" checked={also.includes(k.v)} onChange={(e) => setAlso((p) => e.target.checked ? [...p, k.v] : p.filter((x) => x !== k.v))} />
                {k.l.slice(0, -1)}
              </label>
            ))}
          </div>
          <div className="flex justify-end"><Button onClick={save}>Save</Button></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
