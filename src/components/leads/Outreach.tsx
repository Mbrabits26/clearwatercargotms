import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Search, Send, Flame, Ban } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { findShipperProspects, enrollLead, type Prospect } from "@/lib/outreach.functions";
import { INDUSTRIES, EQUIPMENT, MAX_DAILY_CAP, isOptOut } from "@/lib/outreach";

type Sender = { id: string; user_id: string; from_email: string; display_name: string; title: string | null; phone: string | null; signature: string | null; daily_cap: number; require_approval: boolean; active: boolean };
type Msg = { id: string; lead_id: string; sender_id: string; step: number; subject: string; body: string; send_after: string; status: string; approved: boolean; sent_at: string | null; error: string | null; leads: { company_name: string; email: string | null } | null };

export function useMySender() {
  return useQuery({
    queryKey: ["outreach_sender_me"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const { data } = await supabase.from("outreach_senders").select("*").eq("user_id", u.user?.id ?? "").maybeSingle();
      return { me: u.user, sender: data as Sender | null };
    },
  });
}

/** Header buttons on Sales Leads: find shippers, review queue, sender settings. */
export function OutreachTools({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState<null | "find" | "queue" | "settings">(null);
  return (
    <>
      <div className="flex flex-wrap gap-1 border-b p-2">
        <Button size="sm" variant="secondary" onClick={() => setOpen("find")}><Search className="mr-1 h-4 w-4" />Find shippers</Button>
        <Button size="sm" variant="secondary" onClick={() => setOpen("queue")}><Send className="mr-1 h-4 w-4" />Email queue</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen("settings")}>Outreach settings</Button>
      </div>
      <Dialog open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-auto">
          {open === "find" && <FindShippers onAdded={onAdded} />}
          {open === "queue" && <Queue />}
          {open === "settings" && <Settings />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function FindShippers({ onAdded }: { onAdded: () => void }) {
  const find = useServerFn(findShipperProspects);
  const [f, setF] = useState({ industry: INDUSTRIES[0], equipment: "Flatbed", area: "within 150 miles of Greensboro, NC", count: 15 });
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<Prospect[]>([]);
  const [pick, setPick] = useState<Set<number>>(new Set());
  const run = async () => {
    setBusy(true);
    try {
      const r = await find({ data: f });
      if (r.error) toast.error(r.error);
      setRows(r.prospects);
      setPick(new Set(r.prospects.map((_, i) => i)));
    } catch (e) { toast.error(e instanceof Error ? e.message : "Search failed"); }
    setBusy(false);
  };
  const add = async () => {
    const { data: existing } = await supabase.from("leads").select("company_name");
    const have = new Set((existing ?? []).map((x) => x.company_name.toLowerCase().trim()));
    const { data: u } = await supabase.auth.getUser();
    const list = rows.filter((_, i) => pick.has(i)).filter((p) => !have.has(p.company_name.toLowerCase().trim()));
    if (!list.length) return toast.info("Those companies are already in your leads.");
    const { error } = await supabase.from("leads").insert(list.map((p) => ({
      company_name: p.company_name, city: p.city, state: p.state?.toUpperCase().slice(0, 2) ?? null, website: p.website, industry: p.industry, equipment: p.equipment,
      contact_name: p.contact_name, contact_title: p.contact_title, email: p.email, phone: p.phone, lanes: p.why, source: "AI shipper finder", owner_id: u.user?.id ?? null,
    })));
    if (error) return toast.error(error.message);
    toast.success(`${list.length} lead${list.length === 1 ? "" : "s"} added. Add an email to any that are missing one, then start outreach.`);
    onAdded();
    setRows([]);
  };
  return (
    <div className="space-y-3">
      <DialogHeader><DialogTitle>Find shippers</DialogTitle></DialogHeader>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="text-xs">Industry<Input list="ind" value={f.industry} onChange={(e) => setF({ ...f, industry: e.target.value })} /><datalist id="ind">{INDUSTRIES.map((x) => <option key={x} value={x} />)}</datalist></label>
        <label className="text-xs">Equipment<Input list="eq" value={f.equipment} onChange={(e) => setF({ ...f, equipment: e.target.value })} /><datalist id="eq">{EQUIPMENT.map((x) => <option key={x} value={x} />)}</datalist></label>
        <label className="text-xs">Area<Input value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} /></label>
        <label className="text-xs">How many (max 25)<Input type="number" min={1} max={25} value={f.count} onChange={(e) => setF({ ...f, count: Math.max(1, Math.min(25, Number(e.target.value) || 1)) })} /></label>
      </div>
      <Button onClick={run} disabled={busy}>{busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Search className="mr-1 h-4 w-4" />}Search the web</Button>
      <p className="text-xs text-muted-foreground">Results come from public web pages. Contacts and emails are only filled in when a page lists them — check them before emailing.</p>
      {rows.length > 0 && (
        <>
          <div className="divide-y rounded border">
            {rows.map((p, i) => (
              <label key={i} className="flex gap-2 p-2 text-sm">
                <Checkbox checked={pick.has(i)} onCheckedChange={(v) => { const n = new Set(pick); if (v) n.add(i); else n.delete(i); setPick(n); }} />
                <div className="min-w-0">
                  <div className="font-semibold">{p.company_name} <span className="text-xs text-muted-foreground">{[p.city, p.state].filter(Boolean).join(", ")}</span></div>
                  <div className="text-xs text-muted-foreground">{p.why}</div>
                  <div className="truncate text-xs">{[p.contact_name, p.contact_title, p.email, p.phone, p.website].filter(Boolean).join(" · ") || "No contact listed"}</div>
                </div>
              </label>
            ))}
          </div>
          <Button onClick={add}>Add {pick.size} to leads</Button>
        </>
      )}
    </div>
  );
}

function Queue() {
  const qc = useQueryClient();
  const { data: msgs = [] } = useQuery({ queryKey: ["outreach_queue"], queryFn: async () => (await supabase.from("outreach_messages").select("*, leads(company_name, email)").order("send_after").order("step").limit(300)).data as unknown as Msg[] ?? [] });
  const [edit, setEdit] = useState<Msg | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["outreach_queue"] });
  const upd = async (ids: string[], patch: Partial<Omit<Msg, "leads">>) => { const { error } = await supabase.from("outreach_messages").update(patch).in("id", ids); if (error) toast.error(error.message); refresh(); };
  const pending = msgs.filter((m) => m.status === "pending");
  const waiting = pending.filter((m) => !m.approved);
  return (
    <div className="space-y-3">
      <DialogHeader><DialogTitle>Email queue</DialogTitle></DialogHeader>
      <p className="text-xs text-muted-foreground">Approved emails go out one at a time, at least 5 minutes apart, weekdays 8:00 AM–4:30 PM Eastern, up to each sender's daily limit.</p>
      {waiting.length > 0 && <Button size="sm" onClick={() => upd(waiting.map((m) => m.id), { approved: true })}>Approve all {waiting.length} waiting</Button>}
      <div className="divide-y rounded border">
        {msgs.map((m) => (
          <div key={m.id} className="flex flex-col gap-1 p-2 text-sm sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{m.leads?.company_name} · touch {m.step} <span className="text-xs text-muted-foreground">{m.status === "sent" ? `sent ${new Date(m.sent_at!).toLocaleString()}` : m.status === "skipped" ? "skipped" : `on/after ${m.send_after}`}</span></div>
              <div className="truncate text-xs text-muted-foreground">{m.subject} — {m.body.slice(0, 90)}</div>
              {m.error && <div className="text-xs text-destructive">{m.error}</div>}
            </div>
            {m.status === "pending" && (
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setEdit(m)}>Edit</Button>
                {!m.approved ? <Button size="sm" onClick={() => upd([m.id], { approved: true })}>Approve</Button> : <span className="self-center text-xs text-gold">Approved</span>}
                <Button size="sm" variant="ghost" onClick={() => upd([m.id], { status: "skipped" })}>Skip</Button>
              </div>
            )}
          </div>
        ))}
        {!msgs.length && <div className="p-4 text-center text-sm text-muted-foreground">Nothing queued. Open a lead and click Start outreach.</div>}
      </div>
      {edit && (
        <div className="space-y-2 rounded border p-3">
          <Input value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} />
          <textarea value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} className="h-40 w-full rounded border bg-background p-2 text-sm" />
          <div className="flex gap-2"><Button size="sm" onClick={async () => { await upd([edit.id], { subject: edit.subject, body: edit.body }); setEdit(null); }}>Save</Button><Button size="sm" variant="ghost" onClick={() => setEdit(null)}>Cancel</Button></div>
        </div>
      )}
    </div>
  );
}

function Settings() {
  const qc = useQueryClient();
  const { data } = useMySender();
  const { data: all = [] } = useQuery({ queryKey: ["outreach_senders"], queryFn: async () => (await supabase.from("outreach_senders").select("*").order("display_name")).data as Sender[] ?? [] });
  const s = data?.sender;
  const [f, setF] = useState<Partial<Sender> | null>(null);
  const v = f ?? s ?? { from_email: data?.me?.email ?? "", display_name: "", title: "", phone: "", signature: "", daily_cap: 20, require_approval: true, active: true };
  const save = async () => {
    if (!v.from_email || !v.display_name) return toast.error("Email and name are required");
    const row = { user_id: data!.me!.id, from_email: v.from_email, display_name: v.display_name, title: v.title || null, phone: v.phone || null, signature: v.signature || null, daily_cap: Math.min(MAX_DAILY_CAP, Math.max(1, Number(v.daily_cap) || 20)), require_approval: !!v.require_approval, active: !!v.active };
    const { error } = await supabase.from("outreach_senders").upsert(row, { onConflict: "user_id" });
    if (error) return toast.error(error.message);
    toast.success("Sender saved");
    setF(null);
    qc.invalidateQueries({ queryKey: ["outreach_sender_me"] });
    qc.invalidateQueries({ queryKey: ["outreach_senders"] });
  };
  const set = (k: keyof Sender, val: unknown) => setF({ ...v, [k]: val });
  return (
    <div className="space-y-3">
      <DialogHeader><DialogTitle>Outreach settings — your sender</DialogTitle></DialogHeader>
      <p className="text-xs text-muted-foreground">Emails go out through the Gmail account you connected in the TMS, so the "from" address is that account. To move to a sister domain later, connect that mailbox and update the email here — lead history stays.</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="text-xs">Sending email<Input value={v.from_email ?? ""} onChange={(e) => set("from_email", e.target.value)} /></label>
        <label className="text-xs">Your name<Input value={v.display_name ?? ""} onChange={(e) => set("display_name", e.target.value)} /></label>
        <label className="text-xs">Title<Input value={v.title ?? ""} onChange={(e) => set("title", e.target.value)} /></label>
        <label className="text-xs">Phone<Input value={v.phone ?? ""} onChange={(e) => set("phone", e.target.value)} /></label>
        <label className="text-xs">Emails per day (max {MAX_DAILY_CAP}; 15–20 is safest on your main address)<Input type="number" min={1} max={MAX_DAILY_CAP} value={v.daily_cap ?? 20} onChange={(e) => set("daily_cap", Number(e.target.value))} /></label>
      </div>
      <label className="text-xs">Signature (blank = name, title, Clearwater Cargo, phone, email)<textarea value={v.signature ?? ""} onChange={(e) => set("signature", e.target.value)} className="h-20 w-full rounded border bg-background p-2 text-sm" /></label>
      <label className="flex items-center gap-2 text-sm"><Checkbox checked={!!v.require_approval} onCheckedChange={(x) => set("require_approval", x === true)} />I approve each email before it sends</label>
      <label className="flex items-center gap-2 text-sm"><Checkbox checked={!!v.active} onCheckedChange={(x) => set("active", x === true)} />Sending is on</label>
      <Button onClick={save}>Save sender</Button>
      {all.length > 0 && (
        <div className="rounded border p-2 text-xs">
          <div className="mb-1 font-semibold">Team senders</div>
          {all.map((x) => <div key={x.id}>{x.display_name} · {x.from_email} · {x.daily_cap}/day · {x.active ? "on" : "off"}{x.require_approval ? " · approves each" : " · autopilot"}</div>)}
          <div className="mt-1 text-muted-foreground">Each broker or admin sets up their own sender here after connecting their Gmail.</div>
        </div>
      )}
    </div>
  );
}

/** Outreach controls on one lead: start sequence, log a reply (stops sequence + Team Chat), do-not-contact. */
export function LeadOutreach({ lead, onChange }: { lead: { id: string; company_name: string; email: string | null; outreach_status: string; do_not_contact: boolean; stage: string }; onChange: () => void }) {
  const enroll = useServerFn(enrollLead);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState("");
  const { data: msgs = [] } = useQuery({ queryKey: ["outreach_lead", lead.id], queryFn: async () => (await supabase.from("outreach_messages").select("id, step, status, send_after, sent_at, subject").eq("lead_id", lead.id).order("step")).data ?? [] });
  const refresh = () => { onChange(); qc.invalidateQueries({ queryKey: ["outreach_lead", lead.id] }); qc.invalidateQueries({ queryKey: ["outreach_queue"] }); };
  const stopPending = () => supabase.from("outreach_messages").update({ status: "skipped" }).eq("lead_id", lead.id).eq("status", "pending");
  const start = async () => {
    setBusy(true);
    try { await enroll({ data: { leadId: lead.id } }); toast.success("3 emails drafted and queued — review them in Email queue"); refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't start outreach"); }
    setBusy(false);
  };
  const logReply = async () => {
    await stopPending();
    if (isOptOut(reply)) {
      await supabase.from("leads").update({ outreach_status: "stopped", do_not_contact: true, stage: "lost", lost_reason: "Opted out of email" }).eq("id", lead.id);
      toast.success("Marked do-not-contact; no more emails will go out");
    } else {
      await supabase.from("leads").update({ outreach_status: "replied", stage: "quoting", next_follow_up: new Date().toISOString().slice(0, 10) }).eq("id", lead.id);
      await supabase.from("lead_activities").insert({ lead_id: lead.id, method: "email", notes: `Shipper replied: ${reply}`.slice(0, 2000), occurred_at: new Date().toISOString() });
      await supabase.from("chat_messages").insert({ channel: "team", body: `🔥 Shipper reply: ${lead.company_name} — "${reply.slice(0, 200)}"` });
      toast.success("Hot lead — follow-ups stopped and the team was notified");
    }
    setReply("");
    refresh();
  };
  const dnc = async () => { await stopPending(); await supabase.from("leads").update({ do_not_contact: true, outreach_status: "stopped" }).eq("id", lead.id); toast.success("Do-not-contact set"); refresh(); };
  return (
    <div className="space-y-2 rounded border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="font-semibold">Email outreach</div>
        <span className="text-xs uppercase text-gold">{lead.do_not_contact ? "do not contact" : lead.outreach_status}</span>
        <div className="ml-auto flex flex-wrap gap-1">
          {!lead.do_not_contact && lead.outreach_status !== "active" && <Button size="sm" onClick={start} disabled={busy || !lead.email} title={lead.email ? "AI writes 3 short plain-text emails (day 1, 4, 9) and queues them" : "Add an email address first"}>{busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Start outreach</Button>}
          {lead.outreach_status === "active" && <Button size="sm" variant="ghost" onClick={async () => { await stopPending(); await supabase.from("leads").update({ outreach_status: "stopped" }).eq("id", lead.id); refresh(); }}>Stop</Button>}
          {!lead.do_not_contact && <Button size="sm" variant="ghost" onClick={dnc}><Ban className="mr-1 h-4 w-4" />Do not contact</Button>}
        </div>
      </div>
      {msgs.length > 0 && <div className="text-xs text-muted-foreground">{msgs.map((m) => `Touch ${m.step}: ${m.status === "sent" ? `sent ${new Date(m.sent_at!).toLocaleDateString()}` : m.status === "pending" ? `queued for ${m.send_after}` : "skipped"}`).join(" · ")}</div>}
      {!lead.do_not_contact && msgs.some((m) => m.status === "sent") && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Paste their reply here when they answer" />
          <Button size="sm" disabled={!reply.trim()} onClick={logReply}><Flame className="mr-1 h-4 w-4" />Log reply</Button>
        </div>
      )}
    </div>
  );
}
