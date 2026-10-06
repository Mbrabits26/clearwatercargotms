import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
import logo from "@/assets/clearwater-logo.jpg.asset.json";
import { getInvite, submitPacket } from "@/lib/onboarding.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/onboard/$token")({
  head: () => ({
    meta: [
      { title: "Carrier Onboarding — Clearwater Cargo" },
      { name: "description", content: "Submit your carrier packet to haul with Clearwater Cargo, LLC." },
      { property: "og:title", content: "Carrier Onboarding — Clearwater Cargo" },
      { property: "og:description", content: "Submit your carrier packet to haul with Clearwater Cargo, LLC." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Portal,
});

type Kind = "w9" | "coi" | "agreement" | "noa" | "voided_check";
const toB64 = (f: File) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] ?? "");
    r.onerror = rej;
    r.readAsDataURL(f);
  });

function Portal() {
  const { token } = Route.useParams();
  const fetchInvite = useServerFn(getInvite);
  const send = useServerFn(submitPacket);
  const { data, isLoading } = useQuery({ queryKey: ["invite", token], queryFn: () => fetchInvite({ data: { token } }) });
  const [f, setF] = useState<Record<string, string>>({ auto_liability: "1000000", cargo_insurance: "100000" });
  const [files, setFiles] = useState<Partial<Record<Kind, File>>>({});
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (data?.ok) setF((p) => ({ ...p, email: data.email ?? "", ...Object.fromEntries(Object.entries(data.carrier ?? {}).map(([k, v]) => [k, v ?? ""])) }));
  }, [data]);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  const submit = async () => {
    if (!f.legal_name || !f.email || (!f.mc_number && !f.dot_number)) return toast.error("Legal name, email and MC or DOT number are required.");
    if (!f.auto_expires || !f.cargo_expires) return toast.error("Enter both insurance expiration dates.");
    if (!files.w9 || !files.coi) return toast.error("Attach your W-9 and certificate of insurance.");
    if (f.factoring_company && !files.noa) return toast.error("Attach your factoring Notice of Assignment.");
    if (!agree || !f.signer_name) return toast.error("Accept the broker-carrier agreement and type your name to sign.");
    const list = Object.entries(files) as [Kind, File][];
    if (list.some(([, x]) => x.size > 10 * 1024 * 1024)) return toast.error("Each file must be under 10 MB.");
    setBusy(true);
    try {
      const payload = await Promise.all(list.map(async ([kind, x]) => ({ kind, name: x.name, type: x.type, base64: await toB64(x) })));
      const r = await send({
        data: {
          token,
          info: {
            legal_name: f.legal_name, dba: f.dba, mc_number: f.mc_number, dot_number: f.dot_number, contact_name: f.contact_name,
            phone: f.phone, email: f.email!, city: f.city, state: f.state?.slice(0, 2), equipment: f.equipment,
          },
          insurance: { auto_liability: Number(f.auto_liability) || 0, auto_expires: f.auto_expires, cargo_insurance: Number(f.cargo_insurance) || 0, cargo_expires: f.cargo_expires },
          factoring_company: f.factoring_company,
          agreement_accepted: true,
          signer_name: f.signer_name,
          files: payload,
        },
      });
      if (!r.ok) toast.error(r.problem);
      else setDone(true);
    } catch {
      toast.error("Something went wrong. Please check your entries and try again.");
    } finally {
      setBusy(false);
    }
  };

  const shell = (body: React.ReactNode) => (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 text-center">
          <img src={logo.url} alt="Clearwater Cargo" className="mx-auto mb-3 w-32 rounded bg-foreground p-2" />
          <h1 className="text-3xl font-bold uppercase">Carrier Onboarding</h1>
          <p className="text-sm text-muted-foreground">Clearwater Cargo, LLC · Staley, NC</p>
        </div>
        {body}
      </div>
    </div>
  );

  if (isLoading) return shell(<p className="text-center text-muted-foreground">Loading…</p>);
  if (!data?.ok) return shell(<p className="rounded border bg-card p-6 text-center">{data?.problem ?? "This link is not valid."}</p>);
  if (done)
    return shell(
      <div className="rounded border bg-card p-8 text-center">
        <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-success" />
        <h2 className="text-2xl font-bold">Packet received</h2>
        <p className="text-muted-foreground">Thank you. Our team will review your documents and reach out once you're approved to haul.</p>
      </div>,
    );

  const field = (k: string, label: string, type = "text") => (
    <label className="text-xs text-muted-foreground">{label}<Input className="mt-1" type={type} value={f[k] ?? ""} onChange={set(k)} /></label>
  );
  const fileIn = (k: Kind, label: string, req?: boolean) => (
    <label className="block text-xs text-muted-foreground">{label}{req && " *"}
      <Input className="mt-1" type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setFiles((p) => ({ ...p, [k]: e.target.files?.[0] }))} />
    </label>
  );

  return shell(
    <div className="space-y-5">
      <section className="rounded border bg-card p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-gold">1. Company</h2>
        <div className="grid grid-cols-2 gap-3">
          {field("legal_name", "Legal name *")}{field("dba", "DBA")}
          {field("mc_number", "MC #")}{field("dot_number", "DOT #")}
          {field("contact_name", "Contact name")}{field("phone", "Phone")}
          {field("email", "Email *", "email")}{field("equipment", "Equipment")}
          {field("city", "City")}{field("state", "State (2 letters)")}
        </div>
      </section>
      <section className="rounded border bg-card p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-gold">2. Insurance</h2>
        <div className="grid grid-cols-2 gap-3">
          {field("auto_liability", "Auto liability limit ($)", "number")}{field("auto_expires", "Auto liability expires *", "date")}
          {field("cargo_insurance", "Cargo limit ($)", "number")}{field("cargo_expires", "Cargo expires *", "date")}
        </div>
        <div className="mt-3">{fileIn("coi", "Certificate of insurance (Clearwater Cargo as certificate holder)", true)}</div>
      </section>
      <section className="rounded border bg-card p-5 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-gold">3. Tax & payment</h2>
        {fileIn("w9", "W-9", true)}
        {field("factoring_company", "Factoring company (leave blank if we pay you directly)")}
        {f.factoring_company ? fileIn("noa", "Notice of Assignment (NOA)", true) : fileIn("voided_check", "Voided check for direct deposit")}
      </section>
      <section className="rounded border bg-card p-5 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-gold">4. Broker-carrier agreement</h2>
        <p className="text-sm text-muted-foreground">
          By signing, the carrier agrees to haul loads tendered by Clearwater Cargo, LLC under the rates and terms on each rate confirmation; not to re-broker, double-broker or hold freight hostage; to maintain the insurance listed above; and to provide proof of delivery for payment.
        </p>
        {fileIn("agreement", "Upload a signed copy instead (optional)")}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />I have read and accept the broker-carrier agreement.</label>
        {field("signer_name", "Type your full name to sign *")}
      </section>
      <Button className="w-full" size="lg" disabled={busy} onClick={submit}>{busy ? "Submitting…" : "Submit packet"}</Button>
    </div>,
  );
}
