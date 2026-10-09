import { ConfirmDelete } from "@/components/ConfirmDelete";
import { CarrierLanes } from "@/components/CarrierLanes";
import { createFileRoute, useRouteContext } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { findMatch, mergeFill, duplicateGroups } from "@/lib/carrierMerge";
import { mergeCarriers } from "@/lib/carriers.functions";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Ban, Copy as CopyIcon, Plus, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { carriersQuery } from "@/lib/queries";
import { carrierCompliance, carrierExpiry, DNU_REASONS, PAY_TERMS, payTermsOf, type Carrier } from "@/lib/tms";
import { DocumentsPanel, ExpiryBadge, InsurancePanel, InvitePanel, NewCarrierInvite } from "@/components/CarrierOnboarding";
import { Button } from "@/components/ui/button";
import { CarrierCheckButton } from "@/components/CarrierCheck";
import { SignatureRecords } from "@/components/PacketAppImport";
import { BulkImportButton } from "@/components/BulkImportDialog";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/DatePicker";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { FmcsaButton, FmcsaSummary } from "@/components/FmcsaLookup";
import type { FmcsaCarrier } from "@/lib/fmcsa.functions";

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
  const [mobileDetail, setMobileDetail] = useState(false);
  const [flt, setFlt] = useState<"all" | "expired" | "soon" | "docs">("all");
  const missingDocs = (c: Carrier) => !c.w9_received || !c.coi_received || !c.agreement_signed || (!!c.factoring_company && !c.noa_received);
  const test = {
    all: () => true,
    expired: (c: Carrier) => c.status !== "dnu" && ["expired", "missing"].includes(carrierExpiry(c)),
    soon: (c: Carrier) => c.status !== "dnu" && carrierExpiry(c) === "soon",
    docs: (c: Carrier) => c.status !== "dnu" && missingDocs(c),
  };
  const rows = data
    .filter(test[flt])
    .filter((c) => `${c.legal_name} ${c.dba ?? ""} ${c.mc_number} ${c.dot_number}`.toLowerCase().includes(q.toLowerCase()));
  const c = data.find((x) => x.id === sel);
  const refresh = () => qc.invalidateQueries({ queryKey: ["carriers"] });

  return (
    <div className="grid h-full md:grid-cols-[340px_1fr] xl:grid-cols-[380px_1fr]">
      <aside className={cn("min-h-0 flex-col border-r", mobileDetail ? "hidden md:flex" : "flex")}>
        <div className="flex gap-2 border-b p-3">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Name, MC or DOT" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Button size="icon" onClick={() => setAdding(true)} aria-label="Add carrier"><Plus className="h-4 w-4" /></Button>
        </div>
        <NewCarrierInvite />
        <div className="flex flex-wrap gap-2 border-b px-3 py-2"><BulkImportButton target="carrier" onDone={refresh} /><DuplicatesButton carriers={data} onDone={refresh} /><CarrierCheckButton carriers={data} onDone={refresh} /></div>
        <div className="flex flex-wrap gap-1 border-b p-2">
          {([["all", "All", ""], ["expired", "Expired / missing insurance", "text-destructive"], ["soon", "Expiring ≤30 days", "text-warning"], ["docs", "Missing documents", "text-destructive"]] as const).map(([k, l, cls]) => (
            <button key={k} onClick={() => setFlt(k)} className={cn("rounded border px-2 py-1 text-xs", flt === k ? "border-gold bg-gold/10 text-gold" : cls || "text-muted-foreground")}>
              {l} ({data.filter(test[k]).length})
            </button>
          ))}
        </div>
        <ul className="min-h-0 flex-1 overflow-auto">
          {rows.map((r) => (
            <li key={r.id} onClick={() => { setSel(r.id); setMobileDetail(true); }} className={cn("cursor-pointer border-b px-3 py-2.5 hover:bg-muted/50", sel === r.id && "bg-muted")}>
              <div className="flex items-center justify-between">
                <span className="font-medium">{r.legal_name}</span>
                <span className="flex gap-1">{r.status !== "dnu" && <ExpiryBadge s={carrierExpiry(r)} />}<StatusPill c={r} /></span>
              </div>
              <div className="text-xs text-muted-foreground">MC {r.mc_number} · DOT {r.dot_number} · {r.equipment}</div>
              {r.status !== "dnu" && missingDocs(r) && (
                <div className="text-[11px] text-destructive">Missing: {[!r.w9_received && "W-9", !r.coi_received && "COI", !r.agreement_signed && "Agreement", r.factoring_company && !r.noa_received && "NOA"].filter(Boolean).join(", ")}</div>
              )}
            </li>
          ))}
          {!rows.length && <li className="p-4 text-sm text-muted-foreground">No carriers match this filter.</li>}
        </ul>
      </aside>
      <section className={cn("overflow-auto p-3 sm:p-6", mobileDetail ? "block" : "hidden md:block")}><Button variant="ghost" className="mb-2 min-h-11 md:hidden" onClick={() => setMobileDetail(false)}><ArrowLeft className="mr-2 h-4 w-4" />Back to carriers</Button>{c ? <CarrierDetail key={c.id} c={c} refresh={refresh} /> : <p className="text-muted-foreground">Select a carrier.</p>}</section>
      <AddCarrier carriers={data} open={adding} onOpenChange={setAdding} onDone={(id) => { refresh(); setSel(id); }} />
    </div>
  );
}

function StatusPill({ c }: { c: Carrier }) {
  if (c.status === "pending" && c.conditional_until && c.conditional_until >= new Date().toISOString().slice(0, 10))
    return <span className="rounded border border-gold px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-gold">Conditional</span>;
  const cls = c.status === "dnu" ? "border-destructive text-destructive" : c.status === "vetted" ? "border-success text-success" : "border-warning text-warning";
  return <span className={cn("rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider", cls)}>{c.status === "dnu" ? "Do not use" : c.status}</span>;
}

function CarrierDetail({ c, refresh }: { c: Carrier; refresh: () => void }) {
  const [reason, setReason] = useState<string>("Double-brokering");
  const [factor, setFactor] = useState(c.factoring_company ?? "");
  const [fm, setFm] = useState<FmcsaCarrier | null>(null);
  const comp = carrierCompliance(c);
  const update = async (patch: Partial<Carrier>, msg: string) => {
    const { error } = await supabase.from("carriers").update(patch).eq("id", c.id);
    if (error) return toast.error(error.message);
    toast.success(msg);
    refresh();
  };
  const docsDone = c.w9_received && c.coi_received && c.agreement_signed;

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold">{c.legal_name}</h1>
          <p className="text-muted-foreground">{c.dba && `DBA ${c.dba} · `}MC {c.mc_number} · DOT {c.dot_number} · {c.city}, {c.state} · {c.phone}</p>
          <p className="text-sm text-muted-foreground">{[c.contact_name, c.email, c.address && `${c.address}, ${c.city ?? ""} ${c.state ?? ""} ${c.zip ?? ""}`].filter(Boolean).join(" · ")}</p>
        </div>
        <StatusPill c={c} />
      </div>
      {c.status === "dnu" && (
        <div className="rounded border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
          On the Do Not Use list: <b>{c.dnu_reason}</b>. Assignment is locked for every broker.
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded border bg-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-gold">Authority & safety</h3>
            <FmcsaButton mc={c.mc_number} dot={c.dot_number} label="Re-check FMCSA" onResult={(r) => {
              setFm(r);
              update({
                authority_status: r.authority_status, safety_rating: r.safety_rating,
                ...mergeFill(c as unknown as Record<string, unknown>, {
                  legal_name: r.legal_name, dba: r.dba, dot_number: r.dot_number, mc_number: r.mc_number,
                  address: r.address, city: r.city, state: r.state, zip: r.zip, phone: r.phone ?? r.cell_phone,
                  email: r.email, contact_name: r.contact_name,
                }),
              }, "Updated from FMCSA");
            }} />
          </div>
          {fm && <div className="mb-2"><FmcsaSummary r={fm} /></div>}
          <Row k="Operating authority" v={c.authority_status} bad={c.authority_status !== "Authorized"} />
          <Row k="Safety rating" v={c.safety_rating ?? "—"} bad={c.safety_rating === "Unsatisfactory"} />
          <Button size="sm" className="mt-3" disabled={!docsDone || c.status !== "pending"} onClick={() => update({ status: "vetted" }, "Carrier marked vetted")}>
            Mark vetted
          </Button>
          {!docsDone && c.status === "pending" && <p className="mt-1 text-xs text-muted-foreground">Needs W-9, COI and signed agreement first.</p>}
          {c.status === "pending" && <ConditionalApproval c={c} update={update} />}
        </div>
        <InsurancePanel c={c} update={update} />
      </div>
      <DocumentsPanel c={c} update={update} />
      <SignatureRecords carrierId={c.id} />
      <InvitePanel c={c} />
      <CarrierLanes carrierId={c.id} />
      <div className="rounded border bg-card p-4">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-widest text-gold">Factoring / notice of assignment</h3>
        {c.factoring_company && !c.noa_received && <p className="mb-2 text-xs text-destructive">NOA not on file — upload it in the packet above before paying the factor.</p>}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input placeholder="Factoring company (blank = pay carrier direct)" value={factor} onChange={(e) => setFactor(e.target.value)} />
          <Button variant="secondary" onClick={() => update({ factoring_company: factor || null }, "Pay-to updated")}>Save NOA</Button>
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <span className="text-sm text-muted-foreground">Pay option (carrier's choice)</span>
          <Select value={payTermsOf(c.pay_terms).value} onValueChange={(v) => { if (confirm(`Change ${c.legal_name}'s pay option to "${payTermsOf(v).label}"?`)) update({ pay_terms: v }, "Pay option updated"); }}>
            <SelectTrigger className="sm:w-80"><SelectValue /></SelectTrigger>
            <SelectContent>{PAY_TERMS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <div className="rounded border bg-card p-4">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-widest text-gold">Compliance gate</h3>
        {comp.ok ? <p className="text-sm text-success">Cleared to book.</p> : (
          <ul className="list-inside list-disc text-sm text-muted-foreground">{comp.issues.map((i) => <li key={i}>{i}</li>)}</ul>
        )}
      </div>
      <div className="rounded border border-destructive/40 p-4">
        <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold uppercase tracking-widest text-destructive">Do Not Use</h3>
          <ConfirmDelete table="carriers" id={c.id} label={c.legal_name} what="Carrier" size="sm" invalidate={["carriers"]} linked="Its documents, signature records and offers are deleted. Loads it hauled keep their history but show no carrier. To block a bad carrier, use Do Not Use instead." /></div>
        {c.status === "dnu" ? (
          <Button variant="outline" onClick={() => update({ status: "pending", dnu_reason: null }, "Removed from DNU — re-vet required")}>Remove from DNU</Button>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger className="w-full sm:w-64"><SelectValue /></SelectTrigger>
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

function ConditionalApproval({ c, update }: { c: Carrier; update: (p: Partial<Carrier>, m: string) => void }) {
  const { isAdmin, user } = useRouteContext({ from: "/_authenticated" });
  const today = new Date().toISOString().slice(0, 10);
  const def = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const [until, setUntil] = useState(c.conditional_until ?? def);
  const [note, setNote] = useState(c.conditional_note ?? "");
  const active = !!c.conditional_until && c.conditional_until >= today;
  return (
    <div className="mt-3 space-y-2 rounded border border-gold/40 bg-gold/5 p-2 text-xs">
      <div className="font-semibold uppercase tracking-wider text-gold">Conditional approval</div>
      {active ? <p>Bookable until <b>{c.conditional_until}</b>{c.conditional_note && ` — ${c.conditional_note}`}. Missing documents still need to come in.</p>
        : <p className="text-muted-foreground">Lets this carrier be assigned to loads while documents are pending. Do Not Use and unauthorized carriers can never be approved.</p>}
      {isAdmin ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <DatePicker min={today} value={until} onChange={setUntil} className="sm:w-56" />
          <Input placeholder="Note, e.g. W-9 coming Friday" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button size="sm" disabled={c.authority_status !== "Authorized"} onClick={() => update({ conditional_until: until, conditional_note: note || null, conditional_by: user.id }, "Carrier conditionally approved")}>{active ? "Update" : "Approve"}</Button>
          {active && <Button size="sm" variant="ghost" onClick={() => update({ conditional_until: null, conditional_note: null, conditional_by: null }, "Conditional approval removed")}>Remove</Button>}
        </div>
      ) : <p className="text-muted-foreground">Ask an admin to approve.</p>}
    </div>
  );
}

function DuplicatesButton({ carriers, onDone }: { carriers: Carrier[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const merge = useServerFn(mergeCarriers);
  const [busy, setBusy] = useState<string | null>(null);
  const groups = open ? duplicateGroups(carriers) : [];
  const run = async (keep: Carrier, g: Carrier[]) => {
    setBusy(keep.id);
    try {
      await merge({ data: { keepId: keep.id, dropIds: g.filter((x) => x.id !== keep.id).map((x) => x.id) } });
      toast.success(`Merged into ${keep.legal_name}`);
      onDone();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Merge failed"); }
    setBusy(null);
  };
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}><CopyIcon className="mr-1 h-4 w-4" />Find duplicates</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-auto">
          <DialogHeader><DialogTitle className="font-display text-2xl uppercase">Duplicate carriers</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">Matched by DOT #, MC # or legal name. Choose which record to keep — details, documents, loads and offers from the others are merged into it.</p>
          {!groups.length && <p className="text-sm text-muted-foreground">No duplicates found.</p>}
          {groups.map((g) => (
            <div key={g[0]!.id} className="space-y-1 rounded border p-2">
              {g.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0"><b>{c.legal_name}</b> <span className="text-xs text-muted-foreground">MC {c.mc_number ?? "—"} · DOT {c.dot_number ?? "—"} · {c.phone ?? "no phone"} · {c.email ?? "no email"} · {c.status}</span></span>
                  <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => run(c, g)}>{busy === c.id ? "Merging…" : "Keep this"}</Button>
                </div>
              ))}
            </div>
          ))}
        </DialogContent>
      </Dialog>
    </>
  );
}

function AddCarrier({ carriers, open, onOpenChange, onDone }: { carriers: Carrier[]; open: boolean; onOpenChange: (o: boolean) => void; onDone: (id: string) => void }) {
  const [f, setF] = useState<Record<string, string>>({ authority_status: "Authorized" });
  const [fm, setFm] = useState<FmcsaCarrier | null>(null);
  const fields = [
    ["legal_name", "Legal name"], ["dba", "DBA"], ["mc_number", "MC #"], ["dot_number", "DOT #"],
    ["address", "Street address"], ["city", "City"], ["state", "State"], ["zip", "ZIP"],
    ["contact_name", "Contact name"], ["phone", "Phone"], ["email", "Email"], ["equipment", "Equipment"],
    ["insurance_expires", "Auto liability expires (YYYY-MM-DD)"], ["cargo_expires", "Cargo expires (YYYY-MM-DD)"],
  ] as const;
  const fill = (r: FmcsaCarrier) => {
    setFm(r);
    const pick = (v: string | null | undefined, cur?: string) => v || cur || "";
    setF((p) => ({
      ...p, legal_name: pick(r.legal_name, p.legal_name), dba: pick(r.dba, p.dba), dot_number: pick(r.dot_number, p.dot_number), mc_number: pick(r.mc_number, p.mc_number),
      address: pick(r.address, p.address), city: pick(r.city, p.city), state: pick(r.state, p.state), zip: pick(r.zip, p.zip),
      phone: pick(r.phone ?? r.cell_phone, p.phone), email: pick(r.email, p.email), contact_name: pick(r.contact_name, p.contact_name),
      authority_status: r.authority_status, safety_rating: r.safety_rating,
    }));
  };
  const close = (id: string) => { onDone(id); setF({ authority_status: "Authorized" }); setFm(null); onOpenChange(false); };
  const save = async () => {
    if (!f.legal_name || (!f.mc_number && !f.dot_number)) return toast.error("Legal name and MC or DOT are required");
    const row = {
      legal_name: f.legal_name, dba: f.dba || null, mc_number: f.mc_number || null, dot_number: f.dot_number || null,
      address: f.address || null, zip: f.zip || null, safety_rating: f.safety_rating || "Not Rated",
      city: f.city || null, state: f.state?.toUpperCase() || null, phone: f.phone || null, email: f.email || null,
      contact_name: f.contact_name || null, equipment: f.equipment || null,
      insurance_expires: f.insurance_expires || null, cargo_expires: f.cargo_expires || null, authority_status: f.authority_status ?? "Authorized",
    };
    const dup = findMatch(carriers, row);
    if (dup) {
      const patch = mergeFill(dup as unknown as Record<string, unknown>, row);
      if (Object.keys(patch).length) {
        const { error } = await supabase.from("carriers").update(patch as never).eq("id", dup.id);
        if (error) return toast.error(error.message);
      }
      toast.info(`${dup.legal_name} is already in the system — ${Object.keys(patch).length ? "added the new details to it" : "nothing new to add"}.`);
      return close(dup.id);
    }
    const { data, error } = await supabase.from("carriers").insert(row).select("id").single();
    if (error) return toast.error(error.message);
    toast.success("Carrier added as pending");
    close(data.id);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-auto">
        <DialogHeader><DialogTitle className="font-display text-2xl uppercase">Add carrier</DialogTitle></DialogHeader>
        <div className="flex items-center gap-2">
          <p className="flex-1 text-xs text-muted-foreground">Enter the MC # or DOT #, then pull the carrier's details straight from FMCSA / SAFER.</p>
          <FmcsaButton mc={f.mc_number} dot={f.dot_number} onResult={fill} />
        </div>
        {fm && <FmcsaSummary r={fm} />}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {fields.map(([k, l]) => (
            <label key={k} className="text-xs text-muted-foreground">{l}
              <Input className="mt-1" type={k.endsWith("expires") ? "date" : "text"} value={f[k] ?? ""} onChange={(e) => setF((p) => ({ ...p, [k]: e.target.value }))} />
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
