import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

/** Load numbers like CW-10472 inside free text (chat notices, alerts). */
export const LOAD_NO_RE = /\b(CW-\d{3,7})\b/gi;
export const firstLoadNumber = (s: string) => s.match(/\bCW-\d{3,7}\b/i)?.[0]?.toUpperCase() ?? null;

export async function loadIdByNumber(num: string): Promise<string | null> {
  const { data } = await supabase.from("loads").select("id").ilike("load_number", num).limit(1).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/** Renders text with every load number as a link that opens the load on Dispatch. */
export function LoadText({ text, onOpen }: { text: string; onOpen?: () => void }) {
  const navigate = useNavigate();
  const parts = text.split(LOAD_NO_RE);
  return (
    <>
      {parts.map((p, i) => i % 2 === 1 ? (
        <button key={i} type="button" className="font-semibold underline underline-offset-2 hover:opacity-80"
          onClick={async (e) => {
            e.stopPropagation();
            const id = await loadIdByNumber(p);
            navigate({ to: "/dispatch", search: (id ? { load: id } : {}) as never });
            onOpen?.();
          }}>{p}</button>
      ) : <span key={i}>{p}</span>)}
    </>
  );
}
