import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { qbFinishConnect } from "@/lib/quickbooks.functions";

export const Route = createFileRoute("/oauth/quickbooks/return")({
  head: () => ({ meta: [{ title: "Connecting QuickBooks — Clearwater Cargo TMS" }, { name: "description", content: "Finishing the QuickBooks Online connection." }, { name: "robots", content: "noindex" }] }),
  component: QbReturn,
});

function QbReturn() {
  const [msg, setMsg] = useState("Finishing the QuickBooks connection…");
  const finish = useServerFn(qbFinishConnect);
  const nav = useNavigate();
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const p = new URLSearchParams(window.location.search);
    const code = p.get("code"), state = p.get("state"), realmId = p.get("realmId");
    if (p.get("error") || !code || !state || !realmId) { setMsg(`QuickBooks did not finish connecting${p.get("error") ? ` (${p.get("error")})` : ""}.`); return; }
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) { setMsg("Please sign in to the TMS first, then click Connect QuickBooks again."); return; }
      try {
        const r = await finish({ data: { code, state, realmId } });
        setMsg(`Connected${r.company ? ` to ${r.company}` : ""}! Taking you back to Accounting…`);
        setTimeout(() => nav({ to: "/quickbooks" }), 1500);
      } catch (e) { setMsg((e as Error).message); }
    })();
  }, [finish, nav]);
  return <p className="p-6 text-sm text-muted-foreground">{msg}</p>;
}
