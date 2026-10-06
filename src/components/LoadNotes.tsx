import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { MentionInput, findMentions, saveMentions } from "@/components/MentionInput";

export function LoadNotes({ loadId }: { loadId: string }) {
  const qc = useQueryClient();
  const key = ["load_notes", loadId];
  const [text, setText] = useState("");
  const { data: notes = [] } = useQuery({
    queryKey: key,
    queryFn: async () => (await supabase.from("load_notes").select("*").eq("load_id", loadId).order("created_at", { ascending: false })).data ?? [],
  });
  const { data: people = [] } = useQuery({
    queryKey: ["chat-people"],
    queryFn: async () => (await supabase.from("profiles").select("id, full_name, email")).data ?? [],
  });
  useEffect(() => {
    const ch = supabase
      .channel(`notes-${loadId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "load_notes", filter: `load_id=eq.${loadId}` }, () => qc.invalidateQueries({ queryKey: key }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [loadId]);
  const name = (id: string) => {
    const p = people.find((x) => x.id === id);
    return p?.full_name || p?.email?.split("@")[0] || "Teammate";
  };
  const add = async () => {
    const body = text.trim();
    if (!body) return;
    const { error } = await supabase.from("load_notes").insert({ load_id: loadId, body });
    if (error) return toast.error(error.message);
    const { data: u } = await supabase.auth.getUser();
    if (u.user) await saveMentions(findMentions(body, people), body, { source: "note", load_id: loadId }, u.user.id);
    setText("");
    qc.invalidateQueries({ queryKey: key });
  };
  return (
    <div className="space-y-2 text-sm">
      <div className="flex gap-2">
        <MentionInput value={text} onChange={setText} people={people} placeholder="Add a note for the team… (@ to tag)" />
        <Button onClick={add}>Add</Button>
      </div>
      {notes.length === 0 && <div className="text-muted-foreground">No notes yet.</div>}
      {notes.map((n) => (
        <div key={n.id} className="rounded border bg-muted/40 p-2">
          <div className="text-[10px] text-muted-foreground">{name(n.author_id)} · {new Date(n.created_at).toLocaleString()}</div>
          <div className="whitespace-pre-wrap">{n.body}</div>
        </div>
      ))}
    </div>
  );
}
