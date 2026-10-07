import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Mail, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usd, type Carrier, type Load } from "@/lib/tms";
import { composeEmail } from "@/lib/email";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type SendFrom = "mine" | "dispatch";
const SF_KEY = "cw-offer-send-from";

export function OffersPanel({ load, carriers }: { load: Load; carriers: Carrier[] }) {
  const qc = useQueryClient();
  const key = ["load_offers", load.id];
  const [rate, setRate] = useState(String(load.carrier_rate || ""));
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [from, setFrom] = useState<SendFrom>("mine");
  useEffect(() => setFrom((localStorage.getItem(SF_KEY) as SendFrom) || "mine"), []);

  const { data: offers = [] } = useQuery({
    queryKey: key,
    queryFn: async () => (await supabase.from("load_offers").select("*").eq("load_id", load.id).order("created_at")).data ?? [],
  });
  const { data: history = [] } = useQuery({
    queryKey: ["lane-history", load.origin_state, load.dest_state],
    queryFn: async () => (await supabase.from("carrier_lane_history").select("*").eq("origin_state", load.origin_state).eq("dest_state", load.dest_state)).data ?? [],
  });
  useEffect(() => {
    const ch = supabase.channel(`offers-${load.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "load_offers", filter: `load_id=eq.${load.id}` }, (p) => {
        const o = p.new as { status: string; carrier_id: string };
        const c = carriers.find((x) => x.id === o.carrier_id);
        if (o.status !== "sent") toast(`${c?.legal_name ?? "Carrier"} ${o.status} load ${load.load_number}`);
        qc.invalidateQueries({ queryKey: key });
      }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load.id, carriers]);

  const suggestions = useMemo(() => {
    return carriers
      .filter((c) => c.status === "vetted")
      .map((c) => {
        const h = history.filter((x) => x.carrier_id === c.id);
        const runs = h.reduce((a, x) => a + (x.runs ?? 0), 0);
        const exact = h.some((x) => x.dest_city === load.dest_city && x.origin_city === load.origin_city);
        const equip = !!c.equipment && c.equipment.toLowerCase().includes(load.equipment.toLowerCase().split(" ")[0] ?? "");
        const region = c.state === load.origin_state;
        const score = (exact ? 100 : 0) + runs * 10 + (equip ? 5 : 0) + (region ? 3 : 0);
        return { c, runs, exact, equip, region, score };
      })
      .filter((x) => x.score > 0 || x.c.email)
      .sort((a, b) => b.score - a.score)
      .slice(0, 25);
  }, [carriers, history, load]);

  const link = (t: string) => `${window.location.origin}/offer/${t}`;
  const subject = `Load available: ${load.origin_city}, ${load.origin_state} → ${load.dest_city}, ${load.dest_state} (${load.load_number})`;
  const body = (t: string, name: string, r: number) =>
    `Hi ${name},\n\nClearwater Cargo has a load that fits your lanes:\n\n${load.origin_city}, ${load.origin_state} → ${load.dest_city}, ${load.dest_state}\nPickup: ${load.pickup_at ? new Date(load.pickup_at).toLocaleString() : "TBD"}\nEquipment: ${load.equipment}${load.weight_lbs ? ` · ${load.weight_lbs.toLocaleString()} lbs` : ""}\nRate: ${usd(r)} all-in\n\nAccept, decline or counter here:\n${link(t)}\n\nClearwater Cargo LLC · 252-497-7916`;

  const emailOne = (o: { token: string; carrier_id: string; email: string | null; offered_rate: number }) => {
    const c = carriers.find((x) => x.id === o.carrier_id);
    composeEmail(o.email ?? "", subject, body(o.token, c?.contact_name || c?.legal_name || "there", Number(o.offered_rate)));
  };

  const send = async () => {
    const r = Number(rate);
    if (!r) return toast.error("Enter the offered rate");
    if (!picked.size) return toast.error("Pick at least one carrier");
    const rows = [...picked].map((id) => ({ load_id: load.id, carrier_id: id, email: carriers.find((c) => c.id === id)?.email ?? null, offered_rate: r, status: "sent" }));
    const { data, error } = await supabase.from("load_offers").upsert(rows, { onConflict: "load_id,carrier_id" }).select();
    if (error) return toast.error(error.message);
    if (from === "dispatch") {
      toast.info("Dispatch email turns on once the email domain is set up — opening drafts from your email instead.");
    }
    data.forEach((o, i) => setTimeout(() => emailOne(o), i * 400));
    toast.success(`${data.length} offer${data.length > 1 ? "s" : ""} created. If your browser blocks some pop-ups, use the Email buttons below.`);
    setPicked(new Set());
    qc.invalidateQueries({ queryKey: key });
  };

  const book = async (o: (typeof offers)[number]) => {
    const { error } = await supabase.from("loads").update({ carrier_id: o.carrier_id, carrier_rate: Number(o.counter_rate ?? o.offered_rate), status: "booked" }).eq("id", load.id);
    if (error) return toast.error(error.message);
    toast.success("Carrier booked");
    qc.invalidateQueries({ queryKey: ["loads"] });
  };

  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Input className="w-32" type="number" placeholder="Offer $" value={rate} onChange={(e) => setRate(e.target.value)} />
        <select value={from} onChange={(e) => { const v = e.target.value as SendFrom; setFrom(v); localStorage.setItem(SF_KEY, v); }} className="h-9 rounded border bg-background px-2 text-xs">
          <option value="mine">Send from: my email</option>
          <option value="dispatch">Send from: dispatch@ (needs setup)</option>
        </select>
        <Button size="sm" onClick={send} disabled={!picked.size}><Send className="mr-1 h-3.5 w-3.5" />Offer to {picked.size || ""} carrier{picked.size === 1 ? "" : "s"}</Button>
      </div>
      <div className="max-h-48 overflow-auto rounded border">
        {suggestions.length === 0 && <div className="p-2 text-muted-foreground">No vetted carriers yet.</div>}
        {suggestions.map(({ c, runs, exact, equip, region }) => (
          <label key={c.id} className="flex cursor-pointer items-center gap-2 border-b px-2 py-1 last:border-0 hover:bg-muted/40">
            <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} />
            <span className="flex-1 truncate">{c.legal_name}{!c.email && <span className="text-xs text-warning"> · no email</span>}</span>
            {exact && <span className="rounded bg-gold/15 px-1 text-[10px] text-gold">ran this lane</span>}
            {runs > 0 && !exact && <span className="rounded bg-primary/15 px-1 text-[10px]">{runs} runs {load.origin_state}→{load.dest_state}</span>}
            {equip && <span className="text-[10px] text-muted-foreground">equip</span>}
            {region && <span className="text-[10px] text-muted-foreground">local</span>}
          </label>
        ))}
      </div>
      {offers.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs uppercase text-muted-foreground">Responses</div>
          {offers.map((o) => {
            const c = carriers.find((x) => x.id === o.carrier_id);
            const cls = o.status === "accepted" ? "text-success" : o.status === "rejected" ? "text-destructive" : o.status === "countered" ? "text-gold" : "text-muted-foreground";
            return (
              <div key={o.id} className="flex items-center gap-2 rounded border px-2 py-1">
                <div className="flex-1">
                  <div className="truncate">{c?.legal_name} · {usd(Number(o.offered_rate))}</div>
                  <div className={`text-xs capitalize ${cls}`}>{o.status}{o.counter_rate ? ` @ ${usd(Number(o.counter_rate))}` : ""}{o.note ? ` — "${o.note}"` : ""}</div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => emailOne(o)} aria-label="Email"><Mail className="h-3.5 w-3.5" /></Button>
                {(o.status === "accepted" || o.status === "countered") && load.carrier_id !== o.carrier_id && (
                  <Button size="sm" onClick={() => book(o)}>Book</Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
