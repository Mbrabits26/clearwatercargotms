import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";

export type Person = { id: string; full_name: string | null; email: string | null };
export const handle = (p: Person) => (p.full_name || p.email?.split("@")[0] || "user").replace(/\s+/g, "");

/** Returns ids of people tagged with @Handle in the text. */
export function findMentions(text: string, people: Person[]) {
  const tags = new Set((text.match(/@([\w.-]+)/g) ?? []).map((t) => t.slice(1).toLowerCase()));
  return people.filter((p) => tags.has(handle(p).toLowerCase())).map((p) => p.id);
}

export async function saveMentions(ids: string[], body: string, extra: { source: "chat" | "note"; channel?: string; load_id?: string }, self: string) {
  const rows = ids.filter((id) => id !== self).map((user_id) => ({ user_id, body: body.slice(0, 500), ...extra }));
  if (rows.length) await supabase.from("chat_mentions").insert(rows);
}

export function MentionInput({ value, onChange, people, onEnter, placeholder, rows = 2 }: {
  value: string; onChange: (v: string) => void; people: Person[]; onEnter?: () => void; placeholder?: string; rows?: number;
}) {
  const [hi, setHi] = useState(0);
  const m = value.match(/@([\w.-]*)$/);
  const q = m?.[1].toLowerCase() ?? null;
  const list = q === null ? [] : people.filter((p) => handle(p).toLowerCase().startsWith(q) || (p.email ?? "").toLowerCase().startsWith(q)).slice(0, 6);
  const pick = (p: Person) => onChange(value.replace(/@([\w.-]*)$/, `@${handle(p)} `));
  return (
    <div className="relative flex-1">
      {list.length > 0 && (
        <div className="absolute bottom-full left-0 z-50 mb-1 w-56 rounded border bg-popover p-1 text-sm shadow-lg">
          {list.map((p, i) => (
            <button key={p.id} type="button" onMouseDown={(e) => { e.preventDefault(); pick(p); }}
              className={`block w-full truncate rounded px-2 py-1 text-left ${i === hi ? "bg-accent text-accent-foreground" : ""}`}>
              @{handle(p)} <span className="text-xs text-muted-foreground">{p.email}</span>
            </button>
          ))}
        </div>
      )}
      <Textarea
        rows={rows}
        value={value}
        placeholder={placeholder}
        className="min-h-0 resize-none"
        onChange={(e) => { onChange(e.target.value); setHi(0); }}
        onKeyDown={(e) => {
          if (list.length) {
            if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => (h + 1) % list.length); return; }
            if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => (h - 1 + list.length) % list.length); return; }
            if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(list[hi]); return; }
          }
          if (onEnter && e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onEnter(); }
        }}
      />
    </div>
  );
}
