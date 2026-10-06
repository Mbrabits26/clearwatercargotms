import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Download } from "lucide-react";
import { getRateConForSigning, signRateCon } from "@/lib/ratecon.functions";
import { buildRateConPdf, pdfBase64 } from "@/lib/ratecon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/sign/$token")({
  head: () => ({
    meta: [
      { title: "Sign Rate Confirmation — Clearwater Cargo" },
      { name: "description", content: "Review and sign your Clearwater Cargo rate confirmation." },
      { property: "og:title", content: "Sign Rate Confirmation — Clearwater Cargo" },
      { property: "og:description", content: "Review and sign your Clearwater Cargo rate confirmation." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SignPage,
});

function SignPage() {
  const { token } = Route.useParams();
  const fetchRc = useServerFn(getRateConForSigning);
  const sign = useServerFn(signRateCon);
  const { data, isLoading } = useQuery({ queryKey: ["rc-sign", token], queryFn: () => fetchRc({ data: { token } }) });
  const [url, setUrl] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!data?.ok) return;
    const u = URL.createObjectURL(buildRateConPdf(data.rc).output("blob"));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [data]);

  const submit = async () => {
    if (!data?.ok) return;
    if (name.trim().length < 2 || !agree) return toast.error("Type your full name and accept the terms to sign.");
    setBusy(true);
    try {
      const signedAt = new Date().toISOString();
      const doc = buildRateConPdf(data.rc, { name: name.trim(), title: title.trim() || undefined, signedAt });
      const r = await sign({ data: { token, name: name.trim(), title: title.trim() || undefined, signedAt, pdfBase64: pdfBase64(doc) } });
      if (!r.ok) return toast.error(r.problem);
      setSignedUrl(URL.createObjectURL(doc.output("blob")));
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const shell = (body: React.ReactNode) => (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="text-center">
          <h1 className="text-3xl font-bold uppercase">Rate Confirmation</h1>
          <p className="text-sm text-muted-foreground">Clearwater Cargo LLC · Staley, NC · 252-497-7916</p>
        </div>
        {body}
      </div>
    </div>
  );

  if (isLoading) return shell(<p className="text-center text-muted-foreground">Loading…</p>);
  if (!data?.ok) return shell(<p className="rounded border bg-card p-6 text-center">{data?.problem ?? "This link is not valid."}</p>);
  if (signedUrl)
    return shell(
      <div className="rounded border bg-card p-8 text-center">
        <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-success" />
        <h2 className="text-2xl font-bold">Signed — RC #{data.rc.rc}</h2>
        <p className="mb-4 text-muted-foreground">Thank you. A signed copy is on file with Clearwater Cargo.</p>
        <Button asChild><a href={signedUrl} download={`RateCon-${data.rc.rc}-signed.pdf`}><Download className="mr-1 h-4 w-4" />Download signed copy</a></Button>
      </div>,
    );

  return shell(
    <>
      <div className="grid grid-cols-3 gap-3 rounded border bg-card p-4 text-sm">
        <div><div className="text-xs text-muted-foreground">RC #</div><div className="font-mono text-gold">{data.rc.rc}</div></div>
        <div><div className="text-xs text-muted-foreground">Lane</div>{data.rc.lane}</div>
        <div><div className="text-xs text-muted-foreground">Total to carrier</div><div className="font-display text-2xl text-gold">${data.rc.total.toLocaleString("en-US", { minimumFractionDigits: 2 })}</div></div>
      </div>
      {url && <iframe title="Rate confirmation" src={url} className="h-[900px] w-full rounded border bg-foreground" />}
      <div className="space-y-3 rounded border bg-card p-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-muted-foreground">Full name *<Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="text-xs text-muted-foreground">Title<Input className="mt-1" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          I'm authorized to sign for {data.rc.carrier} and accept this rate confirmation.
        </label>
        <Button className="w-full" size="lg" disabled={busy} onClick={submit}>{busy ? "Signing…" : "Sign rate confirmation"}</Button>
      </div>
    </>,
  );
}
