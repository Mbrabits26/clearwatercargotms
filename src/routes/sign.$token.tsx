import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Download } from "lucide-react";
import { getRateConForSigning, signRateCon } from "@/lib/ratecon.functions";
import { buildRateConPdf } from "@/lib/ratecon";
import { ESIGN_CONSENT } from "@/lib/esign";
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
      const r = await sign({ data: { token, name: name.trim(), title: title.trim() || undefined, consent: true } });
      if (!r.ok) return toast.error(r.problem);
      setSignedUrl(r.downloadUrl ?? "");
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const shell = (body: React.ReactNode) => (
    <div className="min-h-screen bg-background px-3 py-5 pb-28 sm:px-4 sm:py-8">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold uppercase sm:text-3xl">Rate Confirmation</h1>
          <p className="text-sm text-muted-foreground">Clearwater Cargo LLC · Staley, NC · 252-497-7916</p>
        </div>
        {body}
      </div>
    </div>
  );

  if (isLoading) return shell(<p className="text-center text-muted-foreground">Loading…</p>);
  if (data && !data.ok && data.signed && !signedUrl)
    return shell(
      <div className="rounded border bg-card p-5 text-center sm:p-8">
        <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-success" />
        <h2 className="text-2xl font-bold">Signed — RC #{data.rcNumber}</h2>
        <p className="mb-4 text-muted-foreground">
          Signed by {data.signerName ?? "carrier"}{data.signedAt ? ` on ${new Date(data.signedAt).toLocaleString()}` : ""}.
        </p>
        {data.downloadUrl ? (
          <Button asChild><a href={data.downloadUrl} target="_blank" rel="noreferrer"><Download className="mr-1 h-4 w-4" />Download signed copy</a></Button>
        ) : (
          <p className="text-sm text-muted-foreground">Contact Clearwater Cargo for a copy.</p>
        )}
      </div>,
    );
  if (signedUrl !== null)
    return shell(
      <div className="rounded border bg-card p-5 text-center sm:p-8">
        <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-success" />
        <h2 className="text-2xl font-bold">Signed{data?.ok ? ` — RC #${data.rc.rc}` : ""}</h2>
        <p className="mb-4 text-muted-foreground">Thank you. A signed copy is on file with Clearwater Cargo, and a copy link has been emailed to you.</p>
        {signedUrl && <Button asChild><a href={signedUrl} target="_blank" rel="noreferrer"><Download className="mr-1 h-4 w-4" />Download signed copy</a></Button>}
      </div>,
    );
  if (!data?.ok) return shell(<p className="rounded border bg-card p-6 text-center">{data?.problem ?? "This link is not valid."}</p>);

  return shell(
    <>
      <div className="grid grid-cols-2 gap-3 rounded border bg-card p-4 sm:grid-cols-3 text-sm">
        <div><div className="text-xs text-muted-foreground">RC #</div><div className="font-mono text-gold">{data.rc.rc}</div></div>
        <div className="col-span-2 sm:col-span-1"><div className="text-xs text-muted-foreground">Lane</div>{data.rc.lane}</div>
        <div className="col-start-2 row-start-1 sm:col-start-auto sm:row-start-auto"><div className="text-xs text-muted-foreground">Total to carrier</div><div className="font-display text-2xl text-gold">${data.rc.total.toLocaleString("en-US", { minimumFractionDigits: 2 })}</div></div>
      </div>
      {url && (
        <>
          <Button asChild variant="secondary" className="h-12 w-full text-base md:hidden"><a href={url} target="_blank" rel="noreferrer"><Download className="mr-1 h-4 w-4" />Open full rate confirmation</a></Button>
          <iframe title="Rate confirmation" src={url} className="hidden h-[900px] w-full rounded border bg-foreground md:block" />
        </>
      )}
      <div className="space-y-3 rounded border bg-card p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-xs text-muted-foreground">Full name *<Input className="mt-1 h-12 text-base sm:h-10 sm:text-sm" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="text-xs text-muted-foreground">Title<Input className="mt-1 h-12 text-base sm:h-10 sm:text-sm" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        </div>
        <label className="flex min-h-11 items-start gap-3 text-sm">
          <input className="mt-0.5 h-5 w-5 shrink-0" type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>I'm authorized to sign for {data.rc.carrier} and accept this rate confirmation. {ESIGN_CONSENT}</span>
        </label>
        <p className="text-xs text-muted-foreground">When you sign, we record the time, your IP address and device, and add a signature certificate to the signed copy.</p>
        <div className="fixed inset-x-0 bottom-0 z-10 border-t bg-background/95 p-3 backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0"><Button className="h-12 w-full text-base" size="lg" disabled={busy} onClick={submit}>{busy ? "Signing…" : "Sign rate confirmation"}</Button></div>
      </div>
    </>,
  );
}
