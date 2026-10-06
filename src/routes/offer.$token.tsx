import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { getOffer, respondOffer } from "@/lib/offers.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import logo from "@/assets/clearwater-logo.jpg.asset.json";

export const Route = createFileRoute("/offer/$token")({
  head: () => ({
    meta: [
      { title: "Load Offer — Clearwater Cargo" },
      { name: "description", content: "Review and respond to a load offer from Clearwater Cargo LLC." },
      { property: "og:title", content: "Load Offer — Clearwater Cargo" },
      { property: "og:description", content: "Review and respond to a load offer from Clearwater Cargo LLC." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OfferPage,
});

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const dt = (s: string | null) => (s ? new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "TBD");

function OfferPage() {
  const { token } = Route.useParams();
  const fetchOffer = useServerFn(getOffer);
  const respond = useServerFn(respondOffer);
  const { data, refetch, isLoading } = useQuery({ queryKey: ["offer", token], queryFn: () => fetchOffer({ data: { token } }) });
  const [counter, setCounter] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const act = async (action: "accepted" | "rejected" | "countered") => {
    setBusy(true); setErr(null);
    try {
      await respond({ data: { token, action, counter_rate: counter ? Number(counter) : null, note: note || null } });
      await refetch();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-xl space-y-5">
        <div className="flex items-center gap-3">
          <img src={logo.url} alt="Clearwater Cargo" className="h-12 w-12 rounded-sm bg-foreground object-contain" />
          <div>
            <div className="font-display text-xl font-bold uppercase tracking-wider text-gold">Clearwater Cargo</div>
            <div className="text-xs text-muted-foreground">Load offer · 252-497-7916</div>
          </div>
        </div>
        {isLoading && <div className="text-muted-foreground">Loading…</div>}
        {data && !data.ok && <div className="rounded border p-4">{data.problem}</div>}
        {data?.ok && (
          <div className="space-y-4 rounded-lg border bg-card p-5">
            <div>
              <div className="font-mono text-sm text-gold">{data.load.load_number}</div>
              <h1 className="text-2xl font-bold">{data.load.origin_city}, {data.load.origin_state} → {data.load.dest_city}, {data.load.dest_state}</h1>
              <div className="text-sm text-muted-foreground">Offered to {data.carrier}</div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>Pickup: <b>{dt(data.load.pickup_at)}</b></div>
              <div>Delivery: <b>{dt(data.load.delivery_at)}</b></div>
              <div>Equipment: <b>{data.load.equipment}</b></div>
              <div>Miles: <b>{data.load.miles ?? "—"}</b></div>
              <div>Weight: <b>{data.load.weight_lbs?.toLocaleString() ?? "—"} lbs</b></div>
              <div>Commodity: <b>{data.load.commodity ?? "—"}</b></div>
              {data.load.temperature && <div>Temp: <b>{data.load.temperature}</b></div>}
            </div>
            <div className="rounded border border-gold/40 p-3 text-center">
              <div className="text-xs uppercase text-muted-foreground">Offered rate (all-in)</div>
              <div className="font-display text-3xl text-gold">{usd(data.offer.offered_rate)}</div>
            </div>
            {data.covered ? (
              <div className="rounded border p-3 text-sm">This load has been covered. Thanks for your interest — we'll send more lanes your way.</div>
            ) : data.offer.status !== "sent" ? (
              <div className="rounded border p-3 text-sm">
                Response received: <b className="capitalize">{data.offer.status}</b>
                {data.offer.counter_rate ? ` at ${usd(Number(data.offer.counter_rate))}` : ""}. A Clearwater dispatcher will follow up. You can update your answer below.
              </div>
            ) : null}
            {!data.covered && (
              <div className="space-y-3">
                <Textarea placeholder="Notes (truck location, availability, questions)…" value={note} onChange={(e) => setNote(e.target.value)} />
                <div className="flex gap-2">
                  <Input type="number" placeholder="Counter rate $" value={counter} onChange={(e) => setCounter(e.target.value)} />
                  <Button variant="outline" disabled={busy} onClick={() => act("countered")}>Counter</Button>
                </div>
                <div className="flex gap-2">
                  <Button className="flex-1" disabled={busy} onClick={() => act("accepted")}>Accept load</Button>
                  <Button className="flex-1" variant="destructive" disabled={busy} onClick={() => act("rejected")}>Decline</Button>
                </div>
                {err && <div className="text-sm text-destructive">{err}</div>}
                <p className="text-xs text-muted-foreground">Accepting does not book the load until Clearwater confirms and sends a rate confirmation.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
