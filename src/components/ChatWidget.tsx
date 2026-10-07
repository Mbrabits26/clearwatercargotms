import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessagesSquare, X, Send, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { MentionInput, findMentions, saveMentions } from "@/components/MentionInput";

type Msg = { id: string; channel: string; author_id: string; body: string; created_at: string };
const dmKey = (a: string, b: string) => `dm:${[a, b].sort().join(":")}`;

export function ChatWidget({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState("team");
  const [text, setText] = useState("");
  const autoOpened = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);

  const { data: people = [] } = useQuery({
    queryKey: ["chat-people"],
    queryFn: async () => (await supabase.from("profiles").select("id, full_name, email")).data ?? [],
  });
  const { data: msgs = [] } = useQuery({
    queryKey: ["chat-msgs"],
    queryFn: async () => ((await supabase.from("chat_messages").select("*").order("created_at", { ascending: false }).limit(500)).data ?? []).reverse() as Msg[],
  });
  const { data: reads = [] } = useQuery({
    queryKey: ["chat-reads"],
    queryFn: async () => (await supabase.from("chat_reads").select("*").eq("user_id", userId)).data ?? [],
  });

  const { data: mentions = [] } = useQuery({
    queryKey: ["chat-mentions"],
    queryFn: async () => (await supabase.from("chat_mentions").select("*").eq("user_id", userId).eq("read", false).order("created_at", { ascending: false })).data ?? [],
  });
  useEffect(() => {
    const ch = supabase
      .channel("mentions-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_mentions", filter: `user_id=eq.${userId}` }, (p) => {
        const m = p.new as { author_id: string; body: string; source: string };
        toast(`${name(m.author_id)} tagged you${m.source === "note" ? " on a load note" : ""}`, { description: m.body.slice(0, 120) });
        qc.invalidateQueries({ queryKey: ["chat-mentions"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, people]);
  const clearMentions = async () => {
    if (!mentions.length) return;
    await supabase.from("chat_mentions").update({ read: true }).eq("user_id", userId).eq("read", false);
    qc.invalidateQueries({ queryKey: ["chat-mentions"] });
  };

  const name = (id: string) => {
    const p = people.find((x) => x.id === id);
    return p?.full_name || p?.email?.split("@")[0] || "Teammate";
  };
  const readAt = (c: string) => reads.find((r) => r.channel === c)?.last_read_at ?? "1970-01-01";
  const unread = useMemo(() => {
    const m: Record<string, number> = {};
    for (const x of msgs) if (x.author_id !== userId && x.created_at > readAt(x.channel)) m[x.channel] = (m[x.channel] ?? 0) + 1;
    return m;
  }, [msgs, reads, userId]);
  const total = Object.values(unread).reduce((a, b) => a + b, 0) + mentions.length;

  // Pop open on login when there are unread messages
  useEffect(() => {
    if (!autoOpened.current && total > 0) {
      autoOpened.current = true;
      setOpen(true);
      const first = Object.keys(unread)[0];
      if (first) setChannel(first);
      toast(`You have ${total} unread message${total > 1 ? "s" : ""}`);
    }
  }, [total]);

  useEffect(() => {
    const ch = supabase
      .channel("chat-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, (p) => {
        const m = p.new as Msg;
        qc.setQueryData<Msg[]>(["chat-msgs"], (old = []) => (old.some((o) => o.id === m.id) ? old : [...old, m]));
        if (m.author_id !== userId) toast(`${name(m.author_id)}: ${m.body.slice(0, 80)}`);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, people]);

  const markRead = async (c: string) => {
    await supabase.from("chat_reads").upsert({ user_id: userId, channel: c, last_read_at: new Date().toISOString() });
    qc.invalidateQueries({ queryKey: ["chat-reads"] });
  };
  useEffect(() => {
    if (open) { if (unread[channel]) markRead(channel); bottom.current?.scrollIntoView(); }
  }, [open, channel, msgs.length]);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setText("");
    const { data, error } = await supabase.from("chat_messages").insert({ channel, body }).select().single();
    if (error) return toast.error(error.message);
    qc.setQueryData<Msg[]>(["chat-msgs"], (old = []) => (old.some((o) => o.id === data.id) ? old : [...old, data as Msg]));
    await saveMentions(findMentions(body, people), body, { source: "chat", channel }, userId);
  };

  const others = people.filter((p) => p.id !== userId);
  const list = msgs.filter((m) => m.channel === channel);
  const title = channel === "team" ? "Team" : name(channel.slice(3).split(":").find((x) => x !== userId) ?? "");

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-3 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg lg:bottom-5 lg:right-5"
        aria-label="Team chat"
      >
        {open ? <X className="h-5 w-5" /> : <MessagesSquare className="h-5 w-5" />}
        {total > 0 && !open && (
          <span className="absolute -right-1 -top-1 rounded-full bg-gold px-1.5 text-xs font-bold text-background">{total}</span>
        )}
      </button>
      {open && (
        <div className="fixed inset-x-2 bottom-[calc(8.25rem+env(safe-area-inset-bottom))] top-16 z-40 flex overflow-hidden rounded-lg border bg-card shadow-2xl lg:inset-auto lg:bottom-20 lg:right-5 lg:h-[480px] lg:w-[420px]">
          <aside className="w-24 shrink-0 overflow-auto border-r bg-sidebar p-1 text-sm sm:w-32">
            <Chan active={channel === "team"} onClick={() => setChannel("team")} n={unread.team}>
              <Users className="mr-1 inline h-3 w-3" />Team
            </Chan>
            <div className="px-2 pb-1 pt-3 text-[10px] uppercase tracking-wider text-muted-foreground">Direct</div>
            {others.map((p) => {
              const k = dmKey(userId, p.id);
              return <Chan key={p.id} active={channel === k} onClick={() => setChannel(k)} n={unread[k]}>{name(p.id)}</Chan>;
            })}
          </aside>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="border-b px-3 py-2 font-display text-sm font-bold uppercase tracking-wider text-gold">{title}</div>
            {mentions.length > 0 && (
              <div className="max-h-28 space-y-1 overflow-auto border-b bg-gold/10 p-2 text-xs">
                <div className="flex justify-between font-semibold text-gold"><span>You were tagged ({mentions.length})</span><button onClick={clearMentions} className="underline">Mark read</button></div>
                {mentions.map((m) => <div key={m.id}><b>{name(m.author_id)}</b>{m.source === "note" ? " (load note)" : ""}: {m.body}</div>)}
              </div>
            )}
            <div className="flex-1 space-y-2 overflow-auto p-3 text-sm">
              {list.length === 0 && <div className="text-muted-foreground">No messages yet.</div>}
              {list.map((m) => {
                const mine = m.author_id === userId;
                return (
                  <div key={m.id} className={mine ? "text-right" : ""}>
                    <div className="text-[10px] text-muted-foreground">
                      {mine ? "You" : name(m.author_id)} · {new Date(m.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    </div>
                    <div className={`inline-block max-w-[90%] whitespace-pre-wrap rounded-md px-2 py-1 text-left ${mine ? "bg-primary text-primary-foreground" : "bg-muted"}`}>{m.body}</div>
                  </div>
                );
              })}
              <div ref={bottom} />
            </div>
            <div className="flex gap-2 border-t p-2">
              <MentionInput value={text} onChange={setText} people={people} onEnter={send} placeholder="Message… (@ to tag)" />
              <Button size="icon" onClick={send} aria-label="Send"><Send className="h-4 w-4" /></Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Chan({ active, onClick, n, children }: { active: boolean; onClick: () => void; n?: number; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`flex w-full items-center justify-between truncate rounded px-2 py-1 text-left ${active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/75 hover:bg-sidebar-accent"}`}>
      <span className="truncate">{children}</span>
      {n ? <span className="ml-1 rounded-full bg-gold px-1.5 text-[10px] font-bold text-background">{n}</span> : null}
    </button>
  );
}
