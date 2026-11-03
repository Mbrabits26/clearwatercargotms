import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";

export type Person = { id: string; full_name: string | null; email: string | null };
export const handle = (p: Person) => (p.full_name || p.email?.split("@")[0] || "user").replace(/\s+/g, "");

/** Group tags that notify everyone at once. */
export const GROUP_TAGS = [
  { tag: "team", label: "Tag the whole team" },
  { tag: "everyone", label: "Tag everyone" },
] as const;

/**
 * Returns ids of people tagged with @Handle in the text. @team / @everyone tag every person
 * in `groupPool` (defaults to everyone in `people`; pass a narrower pool for private chats).
 */
export function findMentions(text: string, people: Person[], groupPool: Person[] = people) {
  const tags = new Set((text.match(/@([\w.-]+)/g) ?? []).map((t) => t.slice(1).toLowerCase()));
  const ids = new Set(people.filter((p) => tags.has(handle(p).toLowerCase())).map((p) => p.id));
  if (GROUP_TAGS.some((g) => tags.has(g.tag))) groupPool.forEach((p) => ids.add(p.id));
  return [...ids];
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
  const q = m ? (m[1] ?? "").toLowerCase() : null;
  const list: { key: string; tag: string; note: string | null }[] = q === null ? [] : [
    ...GROUP_TAGS.filter((g) => g.tag.startsWith(q)).map((g) => ({ key: `group-${g.tag}`, tag: g.tag, note: g.label })),
    ...people.filter((p) => handle(p).toLowerCase().startsWith(q) || (p.email ?? "").toLowerCase().startsWith(q))
      .map((p) => ({ key: p.id, tag: handle(p), note: p.email })),
  ].slice(0, 8);
  const pick = (o: { tag: string }) => onChange(value.replace(/@([\w.-]*)$/, `@${o.tag} `));
  return (
    <div className="relative flex-1">
      {list.length > 0 && (
        <div className="absolute bottom-full left-0 z-50 mb-1 w-60 rounded border bg-popover p-1 text-sm shadow-lg">
          {list.map((o, i) => (
            <button key={o.key} type="button" onMouseDown={(e) => { e.preventDefault(); pick(o); }}
              className={`block w-full truncate rounded px-2 py-1 text-left ${i === hi ? "bg-accent text-accent-foreground" : ""}`}>
              @{o.tag} <span className="text-xs text-muted-foreground">{o.note}</span>
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
            if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(list[hi]!); return; }
          }
          if (onEnter && e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onEnter(); }
        }}
      />
    </div>
  );
}
