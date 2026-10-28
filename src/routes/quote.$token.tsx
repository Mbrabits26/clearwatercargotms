import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { getQuoteForCustomer, respondQuote } from "@/lib/quoteAccept.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import logo from "@/assets/clearwater-logo.jpg.asset.json";

export const Route = createFileRoute("/quote/$token")({
  head: () => ({
    meta: [
      { title: "Your Freight Quote — Clearwater Cargo" },
      { name: "description", content: "Review and accept your freight rate quote from Clearwater Cargo LLC." },
      { property: "og:title", content: "Your Freight Quote — Clearwater Cargo" },
      { property: "og:description", content: "Review and accept your freight rate quote from Clearwater Cargo LLC." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: QuoteAcceptPage,
});

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

function QuoteAcceptPage() {
  const { token } = Route.useParams();
  const fetchQ = useServerFn(getQuoteForCustomer);
  const respond = useServerFn(respondQuote);
  const { data, refetch, isLoading } = useQuery({ queryKey: ["public-quote", token], queryFn: () => fetchQ({ data: { token } }) });
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const act = async (action: "accept" | "decline") => {
    if (!name.trim()) return setErr("Please enter your name.");
    setBusy(true); setErr(null);
    try { await respond({ data: { token, action, name, note: note || null } }); await refetch(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const q = data?.ok ? data.quote : null;
  const total = q ? q.rate + q.accessorials.reduce((s, a) => s + Number(a.amount || 0), 0) : 0;
  return (
    <div className="min-h-screen bg-background p-4">
      <div className="mx-auto max-w-lg space-y-4 rounded-lg border bg-card p-5">
        <div className="flex items-center gap-3">
          <img src={logo.url} alt="Clearwater Cargo" className="h-12 w-12 rounded" />
          <div>
            <div className="font-display text-xl font-bold uppercase tracking-wider text-gold">Clearwater Cargo</div>
            <div className="text-xs text-muted-foreground">Freight quote · 252-497-7916</div>
          </div>
        </div>
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {data && !data.ok && <p className="text-sm text-destructive">{data.problem}</p>}
        {q && (
          <>
            <div className="space-y-1 text-sm">
              <div className="text-xs uppercase text-muted-foreground">{q.kind} quote {q.quote_number}{q.customer_name ? ` · ${q.customer_name}` : ""}</div>
              <div className="text-lg font-semibold">{q.origin} → {q.dest}</div>
              <div className="text-muted-foreground">{q.equipment}{q.miles ? ` · ${q.miles.toLocaleString()} mi` : ""}{q.pickup_date ? ` · Pickup ${q.pickup_date}` : ""}</div>
            </div>
            <div className="space-y-1 rounded border p-3 text-sm">
              <div className="flex justify-between"><span>Linehaul (all-in)</span><span>{usd(q.rate)}</span></div>
              {q.accessorials.filter((a) => Number(a.amount)).map((a, i) => <div key={i} className="flex justify-between"><span>{a.type}</span><span>{usd(Number(a.amount))}</span></div>)}
              <div className="flex justify-between border-t pt-1 font-display text-2xl text-gold"><span>Total</span><span>{usd(total)}</span></div>
            </div>
            {q.notes && <p className="text-sm text-muted-foreground">{q.notes}</p>}
            {q.status === "won" ? (
              <p className="rounded border border-success/40 p-3 text-sm text-success">Accepted — thank you! A Clearwater dispatcher will reach out to confirm pickup details.</p>
            ) : q.status === "lost" ? (
              <p className="rounded border p-3 text-sm">This quote was declined. Call us anytime for a new rate.</p>
            ) : q.expired ? (
              <p className="rounded border border-warning/40 p-3 text-sm text-warning">This quote expired {new Date(q.expires_at).toLocaleString()}. Call 252-497-7916 for a fresh rate.</p>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Valid until {new Date(q.expires_at).toLocaleString()}.</p>
                <Input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
                <Textarea placeholder="Notes for dispatch (pickup #, hours, etc.) — optional" value={note} onChange={(e) => setNote(e.target.value)} />
                {err && <p className="text-sm text-destructive">{err}</p>}
                <div className="flex gap-2">
                  <Button className="flex-1" disabled={busy} onClick={() => act("accept")}>Accept & book</Button>
                  <Button variant="outline" disabled={busy} onClick={() => act("decline")}>Decline</Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
