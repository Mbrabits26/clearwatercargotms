import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Bell, Volume2, VolumeX, MonitorUp } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { isInvoicedNote } from "@/lib/invoiceReview";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

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

  useEffect(() => {
    try { setAlerts(JSON.parse(localStorage.getItem(key) || "[]")); } catch { /* */ }
    const s = localStorage.getItem("cw-alert-sound") !== "off"; setSound(s); soundRef.current = s;
    if ("Notification" in window) setPerm(Notification.permission);
    supabase.from("profiles").select("id, full_name, email").then(({ data }) => {
      (data ?? []).forEach((p) => { names.current[p.id] = p.full_name || p.email || "Teammate"; });
    });
  }, [key]);

  useEffect(() => {
    const push = (title: string, body: string, to: string, search?: Record<string, unknown>) => {
      const a: Alert = { id: crypto.randomUUID(), title, body, to, search, at: Date.now(), read: false };
      setAlerts((prev) => { const n = [a, ...prev].slice(0, 50); localStorage.setItem(key, JSON.stringify(n)); return n; });
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

    const ch = supabase.channel(`alerts-${userId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "ratecon_requests" }, async (p: any) => {
        if (p.new.status !== "signed" || p.old?.status === "signed") return;
        const l = await loadInfo(p.new.load_id); if (!l || !mine(l.broker_id)) return;
        push(`Rate con signed — ${l.load_number}`, `Signed by ${p.new.signer_name ?? "carrier"}`, "/dispatch");
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "carrier_invites" }, async (p: any) => {
        if (p.new.status !== "submitted" && !p.new.submitted_at) return;
        if (p.old?.submitted_at) return;
        if (!isAdmin && p.new.created_by !== userId) return;
        let name = p.new.email ?? "Carrier";
        if (p.new.carrier_id) { const { data } = await supabase.from("carriers").select("legal_name").eq("id", p.new.carrier_id).maybeSingle(); if (data) name = data.legal_name; }
        push("Carrier packet submitted", `${name} completed onboarding — review it`, "/carriers");
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "load_tracking_pings" }, async (p: any) => {
        const l = await loadInfo(p.new.load_id); if (!l || !mine(l.broker_id)) return;
        const what = p.new.kind === "pod" || p.new.kind === "doc" ? "Document uploaded" : p.new.status ? `Status: ${p.new.status}` : "Location check-in";
        push(`Driver update — ${l.load_number}`, `${what}${p.new.place ? ` · ${p.new.place}` : ""}`, "/dispatch");
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "load_notes" }, async (p: any) => {
        // Admins/accountants: a load moved to Invoiced → review it and sync with QuickBooks.
        if (!isFinance || !isInvoicedNote(p.new.body)) return;
        qc.invalidateQueries({ queryKey: ["qb_sync"] });
        if (p.new.author_id === userId) return;
        const l = await loadInfo(p.new.load_id); if (!l) return;
        const who = names.current[p.new.author_id] ?? "A teammate";
        push(`Load invoiced — ${l.load_number}`, `${who} moved it to Invoiced · review and sync with QuickBooks`, "/quickbooks", { q: l.load_number, review: true });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, (p: any) => {
        const m = p.new; if (m.author_id === userId) return;
        const isDm = m.channel.startsWith("dm:");
        if (isDm && !m.channel.includes(userId)) return;
        const who = names.current[m.author_id] ?? "Teammate";
        push(isDm ? `Message from ${who}` : `Team chat — ${who}`, String(m.body).slice(0, 140), "/dispatch");
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, isAdmin, isFinance, key, navigate, qc]);

  const unread = alerts.filter((a) => !a.read).length;
  const markAll = () => setAlerts((p) => { const n = p.map((a) => ({ ...a, read: true })); localStorage.setItem(key, JSON.stringify(n)); return n; });
  const toggleSound = () => { const s = !sound; setSound(s); soundRef.current = s; localStorage.setItem("cw-alert-sound", s ? "on" : "off"); if (s) chime(); };
  const askPerm = async () => { if ("Notification" in window) setPerm(await Notification.requestPermission()); };

  return (
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
  );
}
