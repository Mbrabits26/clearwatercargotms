import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { FileSignature, Copy, Mail } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { composeEmail } from "@/lib/email";
import { CREDIT_SECTIONS, creditAppUrl, creditEmailBody } from "@/lib/creditApp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Props = { companyId?: string | null; companyName?: string | null; email?: string | null; contact?: string | null; quoteId?: string | null; bidId?: string | null; label?: boolean };
const usd = (n: number | null) => (n == null ? "—" : Number(n).toLocaleString("en-US", { style: "currency", currency: "USD" }));

/** Send a customer credit application link (from Directory, Quotes or Bid Desk) and review returned ones. */
export function CreditAppButton(p: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant={p.label ? "outline" : "ghost"} onClick={() => setOpen(true)} aria-label="Credit application" title="Credit application">
        <FileSignature className="h-4 w-4" />{p.label && <span className="ml-1">Credit application</span>}
      </Button>
      {open && <CreditAppDialog {...p} onClose={() => setOpen(false)} />}
    </>
  );
}

function CreditAppDialog({ companyId, companyName, email, contact, quoteId, bidId, onClose }: Props & { onClose: () => void }) {
  const qc = useQueryClient();
  const { isAdmin, isFinance } = useRouteContext({ from: "/_authenticated" });
  const [to, setTo] = useState(email ?? "");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<string | null>(null);
  const key = ["credit_apps", companyId ?? quoteId ?? bidId ?? ""];
  const { data: apps = [] } = useQuery({
    queryKey: key,
    queryFn: async () => {
      let q = supabase.from("credit_applications").select("*").order("created_at", { ascending: false }).limit(20);
      q = companyId ? q.eq("company_id", companyId) : quoteId ? q.eq("quote_id", quoteId) : bidId ? q.eq("bid_id", bidId) : q.eq("company_name", companyName ?? "");
      const { data, error } = await q; if (error) throw error; return data;
    },
  });

  const create = async () => {
    const { data: u } = await supabase.auth.getUser();
    const { data, error } = await supabase.from("credit_applications").insert({
      company_id: companyId ?? null, company_name: companyName ?? null, email: to.trim() || null,
      quote_id: quoteId ?? null, bid_id: bidId ?? null, created_by: u.user?.id ?? null,
    }).select("token").single();
    if (error) { toast.error(error.message); return null; }
    qc.invalidateQueries({ queryKey: key });
    return creditAppUrl(window.location.origin, data.token);
  };
  const send = async () => {
    if (!to.trim()) return toast.error("Add the customer's email.");
    setBusy(true); const url = await create(); setBusy(false);
    if (!url) return;
    await composeEmail(to.trim(), "Clearwater Cargo LLC — Credit application", creditEmailBody(url, contact));
    toast.success("Email opened with the credit application link");
  };
  const copy = async () => {
    setBusy(true); const url = await create(); setBusy(false);
    if (!url) return;
    await navigator.clipboard.writeText(url); toast.success("Link copied — paste it into a text or email");
  };
  const review = async (id: string, status: "approved" | "declined", limit?: string, terms?: string, note?: string) => {
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("credit_applications").update({
      status, approved_limit: status === "approved" ? Number(limit) || null : null, approved_terms: terms || null,
      review_note: note || null, reviewed_by: u.user?.id ?? null, reviewed_at: new Date().toISOString(),
    }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(status === "approved" ? "Credit approved" : "Credit declined");
    qc.invalidateQueries({ queryKey: key });
  };
  const shown = apps.find((a) => a.id === view);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>Credit application{companyName ? ` — ${companyName}` : ""}</DialogTitle></DialogHeader>
        <div className="space-y-2 rounded border p-3">
          <div className="text-sm text-muted-foreground">Send our standard credit application. The customer fills it out and signs online.</div>
          <div className="flex flex-wrap gap-2">
            <Input className="min-w-56 flex-1" placeholder="Customer email" value={to} onChange={(e) => setTo(e.target.value)} />
            <Button disabled={busy} onClick={send}><Mail className="mr-1 h-4 w-4" />Email link</Button>
            <Button variant="outline" disabled={busy} onClick={copy}><Copy className="mr-1 h-4 w-4" />Copy link</Button>
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-xs uppercase text-muted-foreground">Applications</div>
          {!apps.length && <div className="text-sm text-muted-foreground">None sent yet.</div>}
          {apps.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center gap-2 rounded border p-2 text-sm">
              <span className="font-medium capitalize">{a.status}</span>
              <span className="text-muted-foreground">{a.email ?? "link"} · sent {new Date(a.created_at).toLocaleDateString()}{a.submitted_at ? ` · signed ${new Date(a.submitted_at).toLocaleDateString()} by ${a.signer_name}` : ""}</span>
              {a.requested_limit != null && <span>asks {usd(a.requested_limit)}</span>}
              {a.approved_limit != null && <span className="text-success">approved {usd(a.approved_limit)}</span>}
              <span className="flex-1" />
              {!a.submitted_at && <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(creditAppUrl(window.location.origin, a.token)); toast.success("Link copied"); }}><Copy className="h-4 w-4" /></Button>}
              {a.submitted_at && <Button size="sm" variant="outline" onClick={() => setView(view === a.id ? null : a.id)}>{view === a.id ? "Hide" : "View"}</Button>}
            </div>
          ))}
        </div>
        {shown && <AppDetail app={shown} canReview={isAdmin || isFinance} onReview={review} />}
      </DialogContent>
    </Dialog>
  );
}

type App = { id: string; answers: unknown; status: string; requested_limit: number | null; approved_limit: number | null; approved_terms: string | null; signer_name: string | null; signer_title: string | null; signer_ip: string | null; submitted_at: string | null };
function AppDetail({ app, canReview, onReview }: { app: App; canReview: boolean; onReview: (id: string, s: "approved" | "declined", l?: string, t?: string, n?: string) => void }) {
  const a = (app.answers ?? {}) as Record<string, string>;
  const [limit, setLimit] = useState(String(app.approved_limit ?? app.requested_limit ?? ""));
  const [terms, setTerms] = useState(app.approved_terms ?? "Net 30");
  const [note, setNote] = useState("");
  return (
    <div className="space-y-3 rounded border p-3 text-sm">
      {CREDIT_SECTIONS.map((s) => {
        const rows = s.fields.filter((f) => a[f.key]);
        if (!rows.length) return null;
        return <div key={s.title}><div className="text-xs uppercase text-gold">{s.title}</div>
          <div className="grid grid-cols-2 gap-x-4">{rows.map((f) => <div key={f.key}><span className="text-muted-foreground">{f.label}: </span>{a[f.key]}</div>)}</div></div>;
      })}
      <div className="text-xs text-muted-foreground">Signed by {app.signer_name}, {app.signer_title} · {app.submitted_at && new Date(app.submitted_at).toLocaleString()}{app.signer_ip ? ` · IP ${app.signer_ip}` : ""}. Agreed to Net 30 terms, 1.5%/mo late charge and reference checks.</div>
      {canReview ? (
        <div className="flex flex-wrap items-end gap-2 border-t pt-2">
          <label className="text-xs text-muted-foreground">Approved limit $<Input className="w-32" type="number" value={limit} onChange={(e) => setLimit(e.target.value)} /></label>
          <label className="text-xs text-muted-foreground">Terms<Input className="w-28" value={terms} onChange={(e) => setTerms(e.target.value)} /></label>
          <label className="flex-1 text-xs text-muted-foreground">Note<Input value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <Button size="sm" onClick={() => onReview(app.id, "approved", limit, terms, note)}>Approve</Button>
          <Button size="sm" variant="outline" onClick={() => onReview(app.id, "declined", undefined, undefined, note)}>Decline</Button>
        </div>
      ) : <div className="text-xs text-muted-foreground">Accounting approves or declines the credit limit.</div>}
    </div>
  );
}
