import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { getCreditApp, submitCreditApp } from "@/lib/creditApp.functions";
import { CREDIT_SECTIONS, CREDIT_TERMS, requiredMissing } from "@/lib/creditApp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import logo from "@/assets/clearwater-logo.jpg.asset.json";

export const Route = createFileRoute("/credit/$token")({
  head: () => ({
    meta: [
      { title: "Credit Application — Clearwater Cargo" },
      { name: "description", content: "Apply for shipping credit terms with Clearwater Cargo LLC." },
      { property: "og:title", content: "Credit Application — Clearwater Cargo" },
      { property: "og:description", content: "Apply for shipping credit terms with Clearwater Cargo LLC." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CreditAppPage,
});

function CreditAppPage() {
  const { token } = Route.useParams();
  const fetchApp = useServerFn(getCreditApp);
  const submit = useServerFn(submitCreditApp);
  const { data, isLoading, refetch } = useQuery({ queryKey: ["public-credit", token], queryFn: () => fetchApp({ data: { token } }) });
  const [a, setA] = useState<Record<string, string>>({});
  const [signer, setSigner] = useState({ name: "", title: "" });
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const go = async () => {
    const missing = requiredMissing(a);
    if (missing.length) return setErr(`Please fill in: ${missing.join(", ")}`);
    if (!signer.name.trim() || !signer.title.trim()) return setErr("Please type your name and title to sign.");
    if (!agree) return setErr("Please check the box to agree to the terms.");
    setBusy(true); setErr(null);
    try { await submit({ data: { token, answers: a, signer_name: signer.name, signer_title: signer.title, agree: true } }); await refetch(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const app = data?.ok ? data.app : null;
  return (
    <div className="min-h-screen bg-background p-4">
      <div className="mx-auto max-w-2xl space-y-4 rounded-lg border bg-card p-5">
        <div className="flex items-center gap-3">
          <img src={logo.url} alt="Clearwater Cargo" className="h-12 w-12 rounded" />
          <div>
            <h1 className="font-display text-xl font-bold uppercase tracking-wider text-gold">Customer Credit Application</h1>
            <div className="text-xs text-muted-foreground">Clearwater Cargo LLC · Staley, NC · 252-497-7916</div>
          </div>
        </div>
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {data && !data.ok && <p className="text-sm text-destructive">{data.problem}</p>}
        {app && (app.submitted ? (
          <p className="rounded border border-success/40 p-3 text-sm text-success">Thank you — your credit application was received. Our accounting team will contact you shortly.</p>
        ) : app.expired ? (
          <p className="rounded border border-warning/40 p-3 text-sm text-warning">This link has expired. Call 252-497-7916 for a new one.</p>
        ) : (
          <>
            {CREDIT_SECTIONS.map((s) => (
              <fieldset key={s.title} className="space-y-2">
                <legend className="font-display text-sm font-bold uppercase tracking-wider text-gold">{s.title}</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {s.fields.map((f) => (
                    <label key={f.key} className={`text-xs text-muted-foreground ${f.wide ? "sm:col-span-2" : ""}`}>
                      {f.label}{f.required && <span className="text-destructive"> *</span>}
                      {f.type === "select" ? (
                        <select className="h-9 w-full rounded border bg-background px-2 text-sm text-foreground" value={a[f.key] ?? ""} onChange={(e) => setA({ ...a, [f.key]: e.target.value })}>
                          <option value="">Select…</option>{f.options!.map((o) => <option key={o}>{o}</option>)}
                        </select>
                      ) : (
                        <Input type={f.type ?? "text"} maxLength={500} value={a[f.key] ?? ""} onChange={(e) => setA({ ...a, [f.key]: e.target.value })} />
                      )}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
            <div className="whitespace-pre-line rounded border p-3 text-xs text-muted-foreground">{CREDIT_TERMS}</div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs text-muted-foreground">Your full name (signature) *<Input value={signer.name} onChange={(e) => setSigner({ ...signer, name: e.target.value })} /></label>
              <label className="text-xs text-muted-foreground">Title *<Input value={signer.title} onChange={(e) => setSigner({ ...signer, title: e.target.value })} /></label>
            </div>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={agree} onChange={(e) => setAgree(e.target.checked)} />I agree to the terms above, certify this information is true, and am authorized to sign for this company. Typing my name is my electronic signature.</label>
            {err && <p className="text-sm text-destructive">{err}</p>}
            <Button className="w-full" disabled={busy} onClick={go}>{busy ? "Submitting…" : "Sign & submit application"}</Button>
          </>
        ))}
      </div>
    </div>
  );
}
