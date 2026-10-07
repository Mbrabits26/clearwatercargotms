import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/leads")({
  head: () => ({
    meta: [
      { title: "Sales Leads — Clearwater Cargo TMS" },
      { name: "description", content: "Track prospective customers, conversations and follow-ups." },
      { property: "og:title", content: "Sales Leads — Clearwater Cargo TMS" },
      { property: "og:description", content: "Track prospective customers, conversations and follow-ups." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LeadsPage,
});

const STAGES = ["new", "contacted", "quoting", "negotiating", "won", "lost"] as const;
const METHODS = ["call", "email", "visit", "text"];
type Lead = { id: string; company_name: string; contact_name: string | null; phone: string | null; email: string | null; city: string | null; state: string | null; lanes: string | null; source: string | null; est_monthly_loads: number | null; stage: string; lost_reason: string | null; next_follow_up: string | null; owner_id: string | null; company_id: string | null; created_at: string };
type Act = { id: string; lead_id: string; method: string; notes: string | null; occurred_at: string; follow_up: string | null };
const today = () => new Date().toISOString().slice(0, 10);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function LeadsPage() {
  const qc = useQueryClient();
  const { data: leads = [] } = useQuery({ queryKey: ["leads"], queryFn: async () => (await supabase.from("leads").select("*").order("created_at", { ascending: false })).data as Lead[] ?? [] });
  const { data: team = [] } = useQuery({ queryKey: ["profiles"], queryFn: async () => (await supabase.from("profiles").select("id, full_name, email")).data ?? [] });
  const [sel, setSel] = useState<string | null>(null);
  const [stage, setStage] = useState<string>("all");
  const [adding, setAdding] = useState(false);
  const due = leads.filter((l) => l.next_follow_up && l.next_follow_up <= today() && !["won", "lost"].includes(l.stage));
  const shown = leads.filter((l) => stage === "all" || l.stage === stage);
  const lead = leads.find((l) => l.id === sel) ?? null;
  const refresh = () => qc.invalidateQueries({ queryKey: ["leads"] });
  const name = (id: string | null) => team.find((t) => t.id === id)?.full_name ?? "—";

  return (
    <div className="grid h-full grid-cols-[minmax(380px,1fr)_1.3fr] gap-0">
      <div className="flex flex-col overflow-hidden border-r">
        <div className="flex items-center gap-2 border-b p-3">
          <h1 className="font-display text-xl font-bold uppercase tracking-wide text-gold">Sales Leads</h1>
          <Button size="sm" className="ml-auto" onClick={() => { setAdding(true); setSel(null); }}><Plus className="mr-1 h-4 w-4" />New lead</Button>
        </div>
        {due.length > 0 && (
          <div className="border-b bg-warning/10 p-3 text-sm">
            <div className="mb-1 font-semibold">Follow-ups due ({due.length})</div>
            {due.map((l) => <button key={l.id} onClick={() => setSel(l.id)} className="block text-left hover:underline">{l.company_name} · {l.next_follow_up}{l.next_follow_up! < today() && " (overdue)"}</button>)}
          </div>
        )}
        <div className="flex flex-wrap gap-1 border-b p-2">
          {["all", ...STAGES].map((s) => (
            <button key={s} onClick={() => setStage(s)} className={`rounded px-2 py-0.5 text-xs ${stage === s ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
              {cap(s)} ({s === "all" ? leads.length : leads.filter((l) => l.stage === s).length})
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-auto">
          {shown.map((l) => (
            <button key={l.id} onClick={() => { setSel(l.id); setAdding(false); }} className={`block w-full border-b p-3 text-left text-sm hover:bg-muted/50 ${sel === l.id ? "bg-muted" : ""}`}>
              <div className="flex justify-between"><span className="font-semibold">{l.company_name}</span><span className="text-xs uppercase text-gold">{l.stage}</span></div>
              <div className="text-xs text-muted-foreground">{[l.contact_name, l.city && `${l.city}, ${l.state ?? ""}`, l.lanes].filter(Boolean).join(" · ")}</div>
              <div className="text-xs text-muted-foreground">Owner: {name(l.owner_id)}{l.next_follow_up && ` · Follow up ${l.next_follow_up}`}</div>
            </button>
          ))}
          {!shown.length && <div className="p-6 text-center text-sm text-muted-foreground">No leads yet.</div>}
        </div>
      </div>
      <div className="overflow-auto p-4">
        {adding ? <LeadForm onDone={(id) => { setAdding(false); refresh(); setSel(id); }} /> : lead ? <LeadDetail lead={lead} onChange={refresh} /> : <div className="text-sm text-muted-foreground">Pick a lead, or add a new one.</div>}
      </div>
    </div>
  );
}

const F = [["company_name", "Company *"], ["contact_name", "Contact"], ["phone", "Phone"], ["email", "Email"], ["city", "City"], ["state", "State"], ["lanes", "Lanes / freight"], ["source", "Lead source"], ["est_monthly_loads", "Est. loads / month"]] as const;

function LeadForm({ onDone }: { onDone: (id: string) => void }) {
  const [f, setF] = useState<Record<string, string>>({});
  const save = async () => {
    if (!f.company_name?.trim()) return toast.error("Company name is required");
    const row = { ...f, state: f.state?.toUpperCase().slice(0, 2) || null, est_monthly_loads: f.est_monthly_loads ? Number(f.est_monthly_loads) : null, company_name: f.company_name.trim() };
    const { data, error } = await supabase.from("leads").insert(row as never).select("id").single();
    if (error) return toast.error(error.message);
    toast.success("Lead added");
    onDone(data.id);
  };
  return (
    <div className="max-w-xl space-y-3">
      <h2 className="font-display text-lg font-bold uppercase">New lead</h2>
      <div className="grid grid-cols-2 gap-2">
        {F.map(([k, l]) => <label key={k} className="text-xs">{l}<Input value={f[k] ?? ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>)}
      </div>
      <Button onClick={save}>Save lead</Button>
    </div>
  );
}

function LeadDetail({ lead, onChange }: { lead: Lead; onChange: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: acts = [] } = useQuery({ queryKey: ["lead_acts", lead.id], queryFn: async () => (await supabase.from("lead_activities").select("*").eq("lead_id", lead.id).order("occurred_at", { ascending: false })).data as Act[] ?? [] });
  const [a, setA] = useState({ method: "call", notes: "", occurred_at: new Date().toISOString().slice(0, 16), follow_up: "" });
  const upd = async (patch: Partial<Lead>) => { const { error } = await supabase.from("leads").update(patch).eq("id", lead.id); if (error) toast.error(error.message); else onChange(); };

  const logContact = async () => {
    const { error } = await supabase.from("lead_activities").insert({ lead_id: lead.id, method: a.method, notes: a.notes || null, occurred_at: new Date(a.occurred_at).toISOString(), follow_up: a.follow_up || null });
    if (error) return toast.error(error.message);
    await upd({ next_follow_up: a.follow_up || null, ...(lead.stage === "new" ? { stage: "contacted" } : {}) });
    setA({ ...a, notes: "", follow_up: "" });
    qc.invalidateQueries({ queryKey: ["lead_acts", lead.id] });
    toast.success("Contact logged");
  };
  const setStage = async (s: string) => {
    if (s === "lost") { const r = prompt("Why was this lead lost?"); if (r === null) return; return upd({ stage: s, lost_reason: r }); }
    if (s === "won" && !lead.company_id) {
      const { data, error } = await supabase.from("companies").insert({ kind: "customer", name: lead.company_name, city: lead.city, state: lead.state, phone: lead.phone, email: lead.email, contact_name: lead.contact_name, notes: lead.lanes }).select("id").single();
      if (error) return toast.error(error.message);
      toast.success("Added to Directory as a customer");
      qc.invalidateQueries({ queryKey: ["companies"] });
      return upd({ stage: s, company_id: data.id });
    }
    upd({ stage: s });
  };
  const quote = async () => {
    const { error } = await supabase.from("quotes").insert({ customer_name: lead.company_name, customer_email: lead.email, customer_id: lead.company_id, origin_city: lead.city ?? "", origin_state: lead.state ?? "", dest_city: "", dest_state: "", equipment: "Dry Van", rate: 0, notes: `From lead: ${lead.lanes ?? ""}`.trim() } as never);
    if (error) return toast.error(error.message);
    if (lead.stage === "new" || lead.stage === "contacted") await upd({ stage: "quoting" });
    toast.success("Draft quote created");
    navigate({ to: "/quotes" });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold uppercase text-gold">{lead.company_name}</h2>
          <div className="text-sm text-muted-foreground">{[lead.contact_name, lead.phone, lead.email].filter(Boolean).join(" · ")}</div>
          <div className="text-sm text-muted-foreground">{[lead.city && `${lead.city}, ${lead.state ?? ""}`, lead.lanes, lead.source && `Source: ${lead.source}`, lead.est_monthly_loads && `~${lead.est_monthly_loads} loads/mo`].filter(Boolean).join(" · ")}</div>
          {lead.stage === "lost" && lead.lost_reason && <div className="text-sm text-destructive">Lost: {lead.lost_reason}</div>}
        </div>
        <div className="ml-auto flex gap-2">
          <select value={lead.stage} onChange={(e) => setStage(e.target.value)} className="rounded border bg-background px-2 py-1 text-sm">
            {STAGES.map((s) => <option key={s} value={s}>{cap(s)}</option>)}
          </select>
          <Button size="sm" variant="secondary" onClick={quote}>Create quote</Button>
        </div>
      </div>
      <div className="rounded border p-3">
        <div className="mb-2 font-semibold">Log a conversation</div>
        <div className="grid grid-cols-3 gap-2">
          <label className="text-xs">When<Input type="datetime-local" value={a.occurred_at} onChange={(e) => setA({ ...a, occurred_at: e.target.value })} /></label>
          <label className="text-xs">How<select value={a.method} onChange={(e) => setA({ ...a, method: e.target.value })} className="block h-9 w-full rounded border bg-background px-2 text-sm">{METHODS.map((m) => <option key={m} value={m}>{cap(m)}</option>)}</select></label>
          <label className="text-xs">Next follow-up<Input type="date" value={a.follow_up} onChange={(e) => setA({ ...a, follow_up: e.target.value })} /></label>
        </div>
        <textarea value={a.notes} onChange={(e) => setA({ ...a, notes: e.target.value })} placeholder="What did you talk about?" className="mt-2 h-20 w-full rounded border bg-background p-2 text-sm" />
        <Button size="sm" onClick={logContact}>Save</Button>
      </div>
      <div>
        <div className="mb-2 font-semibold">Contact history</div>
        {acts.map((x) => (
          <div key={x.id} className="border-b py-2 text-sm">
            <div className="text-xs text-muted-foreground">{new Date(x.occurred_at).toLocaleString()} · {cap(x.method)}{x.follow_up && ` · follow up ${x.follow_up}`}</div>
            <div className="whitespace-pre-wrap">{x.notes}</div>
          </div>
        ))}
        {!acts.length && <div className="text-sm text-muted-foreground">No conversations logged yet.</div>}
      </div>
    </div>
  );
}
