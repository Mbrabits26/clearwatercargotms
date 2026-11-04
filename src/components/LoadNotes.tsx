import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MentionInput, findMentions, saveMentions } from "@/components/MentionInput";
import { useServerFn } from "@tanstack/react-start";
import { emailNoteMentions } from "@/lib/mentions.functions";

export function LoadNotes({ loadId }: { loadId: string }) {
  const qc = useQueryClient();
  const emailTags = useServerFn(emailNoteMentions);
  const key = ["load_notes", loadId];
  const [text, setText] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [me, setMe] = useState<{ id: string; admin: boolean } | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: admin } = await supabase.rpc("has_role", { _user_id: data.user.id, _role: "admin" });
      setMe({ id: data.user.id, admin: !!admin });
    });
  }, []);
  const saveEdit = async (id: string) => {
    const body = editText.trim();
    if (!body) return;
    const { error } = await supabase.from("load_notes").update({ body }).eq("id", id);
    if (error) return toast.error(error.message);
    setEditId(null);
    toast.success("Note updated");
    qc.invalidateQueries({ queryKey: key });
  };
  const remove = async (id: string) => {
    if (!window.confirm("Delete this note?")) return;
    const { error } = await supabase.from("load_notes").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Note deleted");
    qc.invalidateQueries({ queryKey: key });
  };
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
    setText("");
    qc.invalidateQueries({ queryKey: key });
    const { data: u } = await supabase.auth.getUser();
    const tagged = findMentions(body, people).filter((id) => id !== u.user?.id);
    if (!u.user || !tagged.length) return;
    const saved = await saveMentions(tagged, body, { source: "note", load_id: loadId }, u.user.id);
    if (saved.error) return toast.error(`Note saved, but the tag alerts didn't go out: ${saved.error}`);
    const who = tagged.length === 1 ? (people.find((p) => p.id === tagged[0])?.full_name ?? "1 person") : `${tagged.length} people`;
    try {
      const r = await emailTags({ data: { ids: saved.ids } });
      toast.success(`Tagged ${who} — alert sent${r.sent ? ` and ${r.sent} email${r.sent === 1 ? "" : "s"}` : ""}`);
    } catch {
      toast.warning(`Tagged ${who} in the app, but the email alert couldn't be sent.`);
    }
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
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{name(n.author_id)} · {new Date(n.created_at).toLocaleString()}</span>
            {me && (me.admin || me.id === n.author_id) && editId !== n.id && (
              <span className="flex gap-3">
                <button className="text-teal" onClick={() => { setEditId(n.id); setEditText(n.body); }}>Edit</button>
                <button className="text-destructive" onClick={() => remove(n.id)}>Delete</button>
              </span>
            )}
          </div>
          {editId === n.id ? (
            <div className="mt-1 space-y-1">
              <Textarea autoFocus value={editText} onChange={(e) => setEditText(e.target.value)} />
              <div className="flex gap-2"><Button size="sm" onClick={() => saveEdit(n.id)}>Save</Button><Button size="sm" variant="ghost" onClick={() => setEditId(null)}>Cancel</Button></div>
            </div>
          ) : <div className="whitespace-pre-wrap">{n.body}</div>}
        </div>
      ))}
    </div>
  );
}
