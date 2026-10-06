import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Ban, Plus, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { carriersQuery } from "@/lib/queries";
import { carrierCompliance, DNU_REASONS, type Carrier } from "@/lib/tms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/carriers")({
  head: () => ({
    meta: [
      { title: "Carriers — Clearwater Cargo TMS" },
      { name: "description", content: "Carrier vetting, compliance and Do Not Use list." },
      { property: "og:title", content: "Carriers — Clearwater Cargo TMS" },
      { property: "og:description", content: "Carrier vetting, compliance and Do Not Use list." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(carriersQuery),
  component: Carriers,
});

function Carriers() {
  const { data } = useSuspenseQuery(carriersQuery);
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(data[0]?.id ?? null);
  const [adding, setAdding] = useState(false);
  const rows = data.filter((c) => `${c.legal_name} ${c.dba ?? ""} ${c.mc_number} ${c.dot_number}`.toLowerCase().includes(q.toLowerCase()));
  const c = data.find((x) => x.id === sel);
  const refresh = () => qc.invalidateQueries({ queryKey: ["carriers"] });

  return (
    <div className="grid h-full grid-cols-[380px_1fr]">
      <aside className="flex min-h-0 flex-col border-r">
        <div className="flex gap-2 border-b p-3">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Name, MC or DOT" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Button size="icon" onClick={() => setAdding(true)} aria-label="Add carrier"><Plus className="h-4 w-4" /></Button>
        </div>
        <ul className="min-h-0 flex-1 overflow-auto">
          {rows.map((r) => (
            <li key={r.id} onClick={() => setSel(r.id)} className={cn("cursor-pointer border-b px-3 py-2.5 hover:bg-muted/50", sel === r.id && "bg-muted")}>
              <div className="flex items-center justify-between">
                <span className="font-medium">{r.legal_name}</span>
                <StatusPill c={r} />
              </div>
              <div className="text-xs text-muted-foreground">MC {r.mc_number} · DOT {r.dot_number} · {r.equipment}</div>
            </li>
          ))}
        </ul>
      </aside>
      <section className="overflow-auto p-6">{c ? <CarrierDetail key={c.id} c={c} refresh={refresh} /> : <p className="text-muted-foreground">Select a carrier.</p>}</section>
      <AddCarrier open={adding} onOpenChange={setAdding} onDone={(id) => { refresh(); setSel(id); }} />
    </div>
  );
}

function StatusPill({ c }: { c: Carrier }) {
  const cls = c.status === "dnu" ? "border-destructive text-destructive" : c.status === "vetted" ? "border-success text-success" : "border-warning text-warning";
  return <span className={cn("rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider", cls)}>{c.status === "dnu" ? "Do not use" : c.status}</span>;
}

function CarrierDetail({ c, refresh }: { c: Carrier; refresh: () => void }) {
  const [reason, setReason] = useState<string>("Double-brokering");
  const [factor, setFactor] = useState(c.factoring_company ?? "");
  const comp = carrierCompliance(c);
  const update = async (patch: Partial<Carrier>, msg: string) => {
    const { error } = await supabase.from("carriers").update(patch).eq("id", c.id);
    if (error) return toast.error(error.message);
    toast.success(msg);
    refresh();
  };
  const docs = [
    ["w9_received", "W-9"],
    ["coi_received", "Certificate of insurance"],
    ["agreement_signed", "Broker-carrier agreement"],
  ] as const;
  const docsDone = c.w9_received && c.coi_received && c.agreement_signed;

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold">{c.legal_name}</h1>
          <p className="text-muted-foreground">{c.dba && `DBA ${c.dba} · `}MC {c.mc_number} · DOT {c.dot_number} · {c.city}, {c.state} · {c.phone}</p>
        </div>
        <StatusPill c={c} />
      </div>
      {c.status === "dnu" && (
        <div className="rounded border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
          On the Do Not Use list: <b>{c.dnu_reason}</b>. Assignment is locked for every broker.
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded border bg-card p-4">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-widest text-gold">Authority & safety</h3>
          <Row k="Operating authority" v={c.authority_status} bad={c.authority_status !== "Authorized"} />
          <Row k="Safety rating" v={c.safety_rating ?? "—"} />
          <Row k="Insurance expires" v={c.insurance_expires ?? "—"} bad={!c.insurance_expires || new Date(c.insurance_expires) < new Date()} />
          <Row k="Auto liability" v={`$${Number(c.auto_liability).toLocaleString()}`} />
          <Row k="Cargo" v={`$${Number(c.cargo_insurance).toLocaleString()}`} />
        </div>
        <div className="rounded border bg-card p-4">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-widest text-gold">Onboarding packet</h3>
          {docs.map(([k, l]) => (
            <label key={k} className="flex items-center gap-2 py-1 text-sm">
              <input type="checkbox" checked={c[k]} onChange={(e) => update({ [k]: e.target.checked } as Partial<Carrier>, `${l} updated`)} />
              {l}
            </label>
          ))}
          <Button
            size="sm" className="mt-3" disabled={!docsDone || c.status !== "pending"}
            onClick={() => update({ status: "vetted" }, "Carrier marked vetted")}
          >
            Mark vetted
          </Button>
        </div>
      </div>
      <div className="rounded border bg-card p-4">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-widest text-gold">Factoring / notice of assignment</h3>
        <div className="flex gap-2">
          <Input placeholder="Factoring company (blank = pay carrier direct)" value={factor} onChange={(e) => setFactor(e.target.value)} />
          <Button variant="secondary" onClick={() => update({ factoring_company: factor || null }, "Pay-to updated")}>Save NOA</Button>
        </div>
      </div>
      <div className="rounded border bg-card p-4">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-widest text-gold">Compliance gate</h3>
        {comp.ok ? <p className="text-sm text-success">Cleared to book.</p> : (
          <ul className="list-inside list-disc text-sm text-muted-foreground">{comp.issues.map((i) => <li key={i}>{i}</li>)}</ul>
        )}
      </div>
      <div className="rounded border border-destructive/40 p-4">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-widest text-destructive">Do Not Use</h3>
        {c.status === "dnu" ? (
          <Button variant="outline" onClick={() => update({ status: "pending", dnu_reason: null }, "Removed from DNU — re-vet required")}>Remove from DNU</Button>
        ) : (
          <div className="flex gap-2">
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
              <SelectContent>{DNU_REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
            </Select>
            <Button variant="destructive" onClick={() => update({ status: "dnu", dnu_reason: reason }, "Carrier locked on DNU list")}>
              <Ban className="mr-1 h-4 w-4" />Add to DNU
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ k, v, bad }: { k: string; v: string; bad?: boolean }) {
  return <div className="flex justify-between py-0.5 text-sm"><span className="text-muted-foreground">{k}</span><span className={bad ? "text-destructive" : ""}>{v}</span></div>;
}

function AddCarrier({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: (id: string) => void }) {
  const [f, setF] = useState<Record<string, string>>({ authority_status: "Authorized" });
  const fields = [
    ["legal_name", "Legal name"], ["dba", "DBA"], ["mc_number", "MC #"], ["dot_number", "DOT #"],
    ["city", "City"], ["state", "State"], ["phone", "Phone"], ["email", "Email"],
    ["equipment", "Equipment"], ["insurance_expires", "Insurance expires (YYYY-MM-DD)"],
  ] as const;
  const save = async () => {
    if (!f.legal_name || (!f.mc_number && !f.dot_number)) return toast.error("Legal name and MC or DOT are required");
    const { data, error } = await supabase.from("carriers").insert({
      legal_name: f.legal_name, dba: f.dba || null, mc_number: f.mc_number || null, dot_number: f.dot_number || null,
      city: f.city || null, state: f.state?.toUpperCase() || null, phone: f.phone || null, email: f.email || null,
      equipment: f.equipment || null, insurance_expires: f.insurance_expires || null, authority_status: f.authority_status ?? "Authorized",
    }).select("id").single();
    if (error) return toast.error(error.message);
    toast.success("Carrier added as pending");
    onDone(data.id);
    setF({ authority_status: "Authorized" });
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle className="font-display text-2xl uppercase">Add carrier</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">Enter details from SAFER. Automatic FMCSA lookup by MC/DOT can be switched on once an FMCSA web key is added.</p>
        <div className="grid grid-cols-2 gap-3">
          {fields.map(([k, l]) => (
            <label key={k} className="text-xs text-muted-foreground">{l}
              <Input className="mt-1" value={f[k] ?? ""} onChange={(e) => setF((p) => ({ ...p, [k]: e.target.value }))} />
            </label>
          ))}
          <label className="text-xs text-muted-foreground">Authority status
            <Select value={f.authority_status} onValueChange={(v) => setF((p) => ({ ...p, authority_status: v }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{["Authorized", "Inactive", "Revoked"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </label>
        </div>
        <div className="flex justify-end"><Button onClick={save}>Save carrier</Button></div>
      </DialogContent>
    </Dialog>
  );
}
