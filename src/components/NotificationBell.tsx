import { firstLoadNumber, loadIdByNumber } from "@/components/LoadText";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Bell, Volume2, VolumeX, MonitorUp, Settings2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { isInvoicedNote } from "@/lib/invoiceReview";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type Prefs = Record<string, boolean>;
const PREF_ROWS: { key: string; label: string; group: "Email" | "In-app" }[] = [
  { key: "email_driver_status", label: "Driver status updates (from tracking link)", group: "Email" },
  { key: "email_driver_docs", label: "Driver POD / BOL uploads", group: "Email" },
  { key: "email_ratecon_signed", label: "Rate con signed", group: "Email" },
  { key: "email_mentions", label: "Someone tags me (or @team) in a load note", group: "Email" },
  { key: "app_mentions", label: "Someone tags me (@name, @team, @everyone)", group: "In-app" },
  { key: "app_driver", label: "Driver check-ins and updates", group: "In-app" },
  { key: "app_ratecon", label: "Rate con signed", group: "In-app" },
  { key: "app_carrier_packet", label: "Carrier onboarding packet submitted", group: "In-app" },
  { key: "app_invoiced", label: "Load moved to Invoiced (finance)", group: "In-app" },
  { key: "app_chat", label: "Chat messages", group: "In-app" },
];

type Alert = { id: string; title: string; body: string; to: string; search?: Record<string, unknown>; at: number; read: boolean };

function chime() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    [880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.18;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.start(t); o.stop(t + 0.32);
    });
  } catch { /* ignore */ }
}

export function NotificationBell({ userId, isAdmin, isFinance = false }: { userId: string; isAdmin: boolean; isFinance?: boolean }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const go = (to: string, search?: Record<string, unknown>) => navigate({ to, search: search as never });
  const key = `cw-alerts:${userId}`;
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [sound, setSound] = useState(true);
  const [perm, setPerm] = useState<string>("default");
  const soundRef = useRef(true);
  const names = useRef<Record<string, string>>({});
  const [prefs, setPrefs] = useState<Prefs>({});
  const prefsRef = useRef<Prefs>({});
  const [openPrefs, setOpenPrefs] = useState(false);
  const on = (k: string) => prefsRef.current[k] !== false;

  useEffect(() => {
    supabase.from("notification_prefs" as never).select("*").eq("user_id", userId).maybeSingle().then(({ data }) => {
      if (data) { setPrefs(data as Prefs); prefsRef.current = data as Prefs; }
    });
  }, [userId]);

  const setPref = async (k: string, v: boolean) => {
    const next = { ...prefs, [k]: v }; setPrefs(next); prefsRef.current = next;
    const { error } = await supabase.from("notification_prefs" as never).upsert({ user_id: userId, [k]: v, updated_at: new Date().toISOString() } as never);
    if (error) toast.error("Could not save alert setting");
  };

  useEffect(() => {
    try { setAlerts(JSON.parse(localStorage.getItem(key) || "[]")); } catch { /* */ }
    const s = localStorage.getItem("cw-alert-sound") !== "off"; setSound(s); soundRef.current = s;
    if ("Notification" in window) setPerm(Notification.permission);
    supabase.from("profiles").select("id, full_name, email").then(({ data }) => {
      (data ?? []).forEach((p) => { names.current[p.id] = p.full_name || p.email || "Teammate"; });
    });
  }, [key]);

  useEffect(() => {
    /** Adds an alert. A fixed `id` is shown only once ever; `quiet` skips the chime and pop-ups. Returns false if it was a repeat. */
    const push = (title: string, body: string, to: string, search?: Record<string, unknown>, opts?: { id?: string; at?: number; quiet?: boolean }) => {
      const a: Alert = { id: opts?.id ?? crypto.randomUUID(), title, body, to, search, at: opts?.at ?? Date.now(), read: false };
      let stored: Alert[] = [];
      try { stored = JSON.parse(localStorage.getItem(key) || "[]"); } catch { /* */ }
      if (opts?.id && stored.some((x) => x.id === a.id)) return false;
      const n = [a, ...stored.filter((x) => x.id !== a.id)].sort((x, y) => y.at - x.at).slice(0, 50);
      localStorage.setItem(key, JSON.stringify(n));
      setAlerts(n);
      if (opts?.quiet) return true;
      if (soundRef.current) chime();
      toast(title, { description: body, action: { label: "View", onClick: () => go(to, search) } });
      if ("Notification" in window && Notification.permission === "granted" && document.visibilityState !== "visible") {
        const n = new Notification(title, { body, tag: a.id });
        n.onclick = () => { window.focus(); go(to, search); n.close(); };
      }
    };
    const loadInfo = async (loadId: string) => {
      const { data } = await supabase.from("loads").select("load_number, broker_id").eq("id", loadId).maybeSingle();
      return data;
    };
    const mine = (brokerId?: string | null) => isAdmin || brokerId === userId;
    // Someone tagged me — in a load note (links to the load) or in chat.
    const mentionAlert = async (m: { id: string; author_id: string; body: string; source: string; load_id: string | null; created_at: string }, quiet = false) => {
      const who = names.current[m.author_id] ?? "A teammate";
      const group = /@(team|everyone)\b/i.test(m.body);
      const opts = { id: `mention-${m.id}`, at: new Date(m.created_at).getTime(), quiet };
      if (m.source === "note" && m.load_id) {
        const l = await loadInfo(m.load_id);
        return push(`${who} tagged ${group ? "the team" : "you"} — ${l?.load_number ?? "load note"}`, String(m.body).slice(0, 140), "/dispatch", { load: m.load_id }, opts);
      }
      return push(`${who} tagged ${group ? "the team" : "you"} in chat`, String(m.body).slice(0, 140), "/dispatch", undefined, opts);
    };
    // Tags that came in while I was away land in the bell (one pop-up, no chime per tag) when I open the app.
    const names0 = supabase.from("profiles").select("id, full_name, email").then(({ data }) => {
      (data ?? []).forEach((p) => { names.current[p.id] = p.full_name || p.email || "Teammate"; });
    });
    supabase.from("chat_mentions").select("id, author_id, body, source, load_id, created_at").eq("user_id", userId).eq("read", false)
      .gte("created_at", new Date(Date.now() - 14 * 86_400_000).toISOString()).order("created_at").limit(20)
      .then(async ({ data }) => {
        await names0;
        if (!on("app_mentions") || !data?.length) return;
        const added = (await Promise.all(data.map((m) => mentionAlert(m, true)))).filter(Boolean).length;
        if (added) toast(`You were tagged ${added} time${added === 1 ? "" : "s"} while away`, { description: "Open the bell to see each one." });
      });

    // Driver updates and signed rate cons that happened while this tab was closed or asleep.
    const seenKey = `cw-alerts-seen:${userId}`;
    const catchUp = async () => {
      const since = new Date(Math.max(Number(localStorage.getItem(seenKey)) || 0, Date.now() - 3 * 86_400_000)).toISOString();
      localStorage.setItem(seenKey, String(Date.now()));
      const [pings, rcs] = await Promise.all([
        on("app_driver") ? supabase.from("load_tracking_pings").select("id, load_id, kind, status, place, created_at").gt("created_at", since).order("created_at").limit(50) : Promise.resolve({ data: [] as any[] }),
        on("app_ratecon") ? supabase.from("ratecon_requests").select("id, load_id, signer_name, signed_at").eq("status", "signed").gt("signed_at", since).limit(30) : Promise.resolve({ data: [] as any[] }),
      ]);
      let added = 0;
      for (const p of (pings.data ?? []) as any[]) {
        const l = await loadInfo(p.load_id); if (!l || !mine(l.broker_id)) continue;
        const what = p.kind === "pod" || p.kind === "doc" ? (p.status ?? "Document uploaded") : p.status ? `Status: ${p.status}` : "Location check-in";
        if (push(`Driver update — ${l.load_number}`, `${what}${p.place ? ` · ${p.place}` : ""}`, "/dispatch", { load: p.load_id }, { id: `ping-${p.id}`, at: new Date(p.created_at).getTime(), quiet: true }) !== false) added++;
      }
      for (const r of (rcs.data ?? []) as any[]) {
        const l = await loadInfo(r.load_id); if (!l || !mine(l.broker_id)) continue;
        if (push(`Rate con signed — ${l.load_number}`, `Signed by ${r.signer_name ?? "carrier"}`, "/dispatch", { load: r.load_id }, { id: `rc-${r.id}`, at: new Date(r.signed_at).getTime(), quiet: true }) !== false) added++;
      }
      if (added) toast(`${added} update${added === 1 ? "" : "s"} while you were away`, { description: "Open the bell to see each one." });
    };
    catchUp();
    const onVis = () => { if (document.visibilityState === "visible") catchUp(); };
    document.addEventListener("visibilitychange", onVis);
    const stamp = () => localStorage.setItem(seenKey, String(Date.now()));

    const ch = supabase.channel(`alerts-${userId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "ratecon_requests" }, async (p: any) => {
        if (!on("app_ratecon") || p.new.status !== "signed" || p.old?.status === "signed") return;
        const l = await loadInfo(p.new.load_id); if (!l || !mine(l.broker_id)) return;
        push(`Rate con signed — ${l.load_number}`, `Signed by ${p.new.signer_name ?? "carrier"}`, "/dispatch", { load: p.new.load_id }, { id: `rc-${p.new.id}` });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "carrier_invites" }, async (p: any) => {
        if (!on("app_carrier_packet")) return;
        if (p.new.status !== "submitted" && !p.new.submitted_at) return;
        if (p.old?.submitted_at) return;
        if (!isAdmin && p.new.created_by !== userId) return;
        let name = p.new.email ?? "Carrier";
        if (p.new.carrier_id) { const { data } = await supabase.from("carriers").select("legal_name").eq("id", p.new.carrier_id).maybeSingle(); if (data) name = data.legal_name; }
        push("Carrier packet submitted", `${name} completed onboarding — review it`, "/carriers");
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "load_tracking_pings" }, async (p: any) => {
        if (!on("app_driver")) return;
        const l = await loadInfo(p.new.load_id); if (!l || !mine(l.broker_id)) return;
        const what = p.new.kind === "pod" || p.new.kind === "doc" ? (p.new.status ?? "Document uploaded") : p.new.status ? `Status: ${p.new.status}` : "Location check-in";
        stamp(); push(`Driver update — ${l.load_number}`, `${what}${p.new.place ? ` · ${p.new.place}` : ""}`, "/dispatch", { load: p.new.load_id }, { id: `ping-${p.new.id}` });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "load_notes" }, async (p: any) => {
        // Admins/accountants: a load moved to Invoiced → review it and sync with QuickBooks.
        if (!isFinance || !isInvoicedNote(p.new.body)) return;
        qc.invalidateQueries({ queryKey: ["qb_sync"] });
        if (p.new.author_id === userId || !on("app_invoiced")) return;
        const l = await loadInfo(p.new.load_id); if (!l) return;
        const who = names.current[p.new.author_id] ?? "A teammate";
        push(`Load invoiced — ${l.load_number}`, `${who} moved it to Invoiced · review and sync with QuickBooks`, "/quickbooks", { q: l.load_number, review: true });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_mentions", filter: `user_id=eq.${userId}` }, (p: any) => {
        if (on("app_mentions")) mentionAlert(p.new);
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, async (p: any) => {
        const m = p.new; if (m.author_id === userId || !on("app_chat")) return;
        const isDm = m.channel.startsWith("dm:");
        if (isDm && !m.channel.includes(userId)) return;
        const who = names.current[m.author_id] ?? "Teammate";
        // Notices naming a load (rate con signed, signing warnings, low margin…) open that load.
        const num = firstLoadNumber(String(m.body));
        const id = num ? await loadIdByNumber(num) : null;
        push(isDm ? `Message from ${who}` : `Team chat — ${who}`, String(m.body).slice(0, 140), "/dispatch", id ? { load: id } : undefined);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); document.removeEventListener("visibilitychange", onVis); };
  }, [userId, isAdmin, isFinance, key, navigate, qc]);

  const unread = alerts.filter((a) => !a.read).length;
  const markAll = () => setAlerts((p) => { const n = p.map((a) => ({ ...a, read: true })); localStorage.setItem(key, JSON.stringify(n)); return n; });
  const toggleSound = () => { const s = !sound; setSound(s); soundRef.current = s; localStorage.setItem("cw-alert-sound", s ? "on" : "off"); if (s) chime(); };
  const askPerm = async () => { if ("Notification" in window) setPerm(await Notification.requestPermission()); };

  return (
    <>
    <Dialog open={openPrefs} onOpenChange={setOpenPrefs}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>My alert settings</DialogTitle></DialogHeader>
        {(["Email", "In-app"] as const).map((g) => (
          <div key={g} className="space-y-2">
            <div className="font-display text-xs uppercase tracking-wider text-gold">{g === "Email" ? "Email alerts" : "In-app alerts (bell, chime, pop-up)"}</div>
            {PREF_ROWS.filter((r) => r.group === g).map((r) => (
              <label key={r.key} className="flex items-center justify-between gap-3 text-sm">
                <span>{r.label}</span>
                <Switch checked={prefs[r.key] !== false} onCheckedChange={(v) => setPref(r.key, v)} />
              </label>
            ))}
          </div>
        ))}
        <p className="text-xs text-muted-foreground">Emails go to loads where you're the broker. These settings are just for you.</p>
      </DialogContent>
    </Dialog>
    <Popover onOpenChange={(o) => { if (!o) markAll(); }}>
      <PopoverTrigger asChild>
        <Button size="icon" variant="ghost" aria-label="Notifications" className="relative">
          <Bell className="h-4 w-4" />
          {unread > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-gold px-1 text-[10px] font-bold text-background">{unread > 9 ? "9+" : unread}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="font-display text-sm uppercase tracking-wider text-gold">Alerts</span>
          <div className="flex gap-1">
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setOpenPrefs(true)} title="Alert settings" aria-label="Alert settings"><Settings2 className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={toggleSound} title={sound ? "Sound on" : "Sound off"}>{sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}</Button>
            {perm !== "granted" && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={askPerm}><MonitorUp className="mr-1 h-3 w-3" />Enable pop-ups</Button>}
          </div>
        </div>
        <div className="max-h-96 overflow-auto">
          {alerts.length === 0 && <p className="p-4 text-center text-sm text-muted-foreground">No alerts yet</p>}
          {alerts.map((a) => (
            <button key={a.id} onClick={() => go(a.to, a.search)} className={`block w-full border-b px-3 py-2 text-left text-sm hover:bg-accent ${a.read ? "" : "bg-accent/40"}`}>
              <div className="font-medium">{a.title}</div>
              <div className="text-xs text-muted-foreground">{a.body}</div>
              <div className="text-[10px] text-muted-foreground">{new Date(a.at).toLocaleString()}</div>
            </button>
          ))}
        </div>
        {alerts.length > 0 && <div className="p-2 text-right"><Button size="sm" variant="ghost" className="text-xs" onClick={() => { setAlerts([]); localStorage.removeItem(key); }}>Clear all</Button></div>}
      </PopoverContent>
    </Popover>
    </>
  );
}
