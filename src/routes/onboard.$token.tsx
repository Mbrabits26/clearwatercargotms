import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
import logo from "@/assets/clearwater-logo.jpg.asset.json";
import { getInvite, submitPacket } from "@/lib/onboarding.functions";
import { agreementLegalHtml } from "@/content/agreement-legal";
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
    const factored = f.pay_terms === "factoring" || f.pay_terms === "factored_quickpay";
    if (factored && (!f.factoring_company || !f.factoring_remit)) return toast.error("Enter your factoring company and remit-to address.");
    if (factored && !files.noa) return toast.error("Attach your factoring Notice of Assignment.");
    if (!agree || !f.signer_name) return toast.error("Accept the broker-carrier agreement and type your name to sign.");
    const list = (Object.entries(files) as [Kind, File | undefined][])
      .filter((e): e is [Kind, File] => !!e[1] && (e[0] === "noa" ? factored : e[0] === "voided_check" ? !factored : true));
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
          factoring_remit: f.factoring_remit,
          pay_terms: (f.pay_terms || "net30") as "net30" | "quickpay" | "factoring" | "factored_quickpay",
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
    <div className="min-h-screen bg-background px-3 py-6 pb-28 sm:px-4 sm:py-10">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 text-center">
          <img src={logo.url} alt="Clearwater Cargo" className="mx-auto mb-3 w-24 sm:w-32 rounded bg-foreground p-2" />
          <h1 className="text-2xl font-bold uppercase sm:text-3xl">Carrier Onboarding</h1>
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
    <label className="text-xs text-muted-foreground">{label}<Input className="mt-1 h-12 text-base sm:h-10 sm:text-sm" type={type} inputMode={k.includes("phone") ? "tel" : type === "number" ? "numeric" : undefined} value={f[k] ?? ""} onChange={set(k)} /></label>
  );
  const fileIn = (k: Kind, label: string, req?: boolean) => (
    <label key={k} className="block text-xs text-muted-foreground">{label}{req && " *"}
      <Input key={`in-${k}`} className="mt-1 h-14 cursor-pointer border-dashed py-3 text-base sm:h-10 sm:py-1 sm:text-sm" type="file" accept="application/pdf,image/*" onChange={(e) => {
        const file = e.target.files?.[0];
        setFiles((p) => { const n = { ...p }; if (file) n[k] = file; else delete n[k]; return n; });
      }} />
      {files[k] && <span className="mt-1 block text-success">Attached: {files[k]!.name} ({Math.ceil(files[k]!.size / 1024)} KB)</span>}
    </label>
  );

  return shell(
    <div className="space-y-5">
      <section className="rounded border bg-card p-4 sm:p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-gold">1. Company</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field("legal_name", "Legal name *")}{field("dba", "DBA")}
          {field("mc_number", "MC #")}{field("dot_number", "DOT #")}
          {field("contact_name", "Contact name")}{field("phone", "Phone")}
          {field("email", "Email *", "email")}{field("equipment", "Equipment")}
          {field("city", "City")}{field("state", "State (2 letters)")}
        </div>
      </section>
      <section className="rounded border bg-card p-4 sm:p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-gold">2. Insurance</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field("auto_liability", "Auto liability limit ($)", "number")}{field("auto_expires", "Auto liability expires *", "date")}
          {field("cargo_insurance", "Cargo limit ($)", "number")}{field("cargo_expires", "Cargo expires *", "date")}
        </div>
        <div className="mt-3">{fileIn("coi", "Certificate of insurance (Clearwater Cargo as certificate holder)", true)}</div>
      </section>
      <section className="rounded border bg-card p-4 sm:p-5 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-gold">3. Tax & payment</h2>
        <p className="text-xs text-muted-foreground">On a phone you can take a photo of each document or pick a PDF.</p>
        {fileIn("w9", "W-9", true)}
        <label className="block text-sm">How would you like to be paid?
          <select className="mt-1 h-12 w-full text-base sm:h-10 sm:text-sm rounded border bg-background px-2" value={f.pay_terms || "net30"} onChange={(e) => {
            const v = e.target.value; const fac = v === "factoring" || v === "factored_quickpay";
            setF((p) => ({ ...p, pay_terms: v }));
            // Drop the file that no longer applies so it can't land in the wrong slot.
            setFiles((p) => { const n = { ...p }; delete n[fac ? "voided_check" : "noa"]; return n; });
          }}>
            <option value="net30">Net 30 (no fee)</option>
            <option value="quickpay">Quick Pay – 5% fee, paid in 3 days</option>
            <option value="factoring">Factoring – Net 30, paid to my factoring company</option>
            <option value="factored_quickpay">Factored Quick Pay – 2.5% fee</option>
          </select>
        </label>
        {(f.pay_terms === "factoring" || f.pay_terms === "factored_quickpay") && (<>
          {field("factoring_company", "Factoring company *")}
          {field("factoring_remit", "Factoring remit-to address *")}
        </>)}
        {f.pay_terms === "factoring" || f.pay_terms === "factored_quickpay" ? fileIn("noa", "Notice of Assignment (NOA)", true) : fileIn("voided_check", "Voided check for direct deposit")}
      </section>
      <section className="rounded border bg-card p-4 sm:p-5 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-gold">4. Broker-carrier agreement</h2>
        <div className="legal-agreement max-h-72 overflow-auto rounded border bg-background p-3 text-sm sm:max-h-96 sm:p-4 leading-relaxed" dangerouslySetInnerHTML={{ __html: agreementLegalHtml }} />
        {fileIn("agreement", "Upload a signed copy instead (optional)")}
        <label className="flex min-h-11 items-start gap-3 text-sm"><input className="mt-0.5 h-5 w-5 shrink-0" type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />I have read and accept the broker-carrier agreement.</label>
        {field("signer_name", "Type your full name to sign *")}
      </section>
      <div className="fixed inset-x-0 bottom-0 z-10 border-t bg-background/95 p-3 backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0"><Button className="h-12 w-full text-base" size="lg" disabled={busy} onClick={submit}>{busy ? "Submitting…" : "Submit packet"}</Button></div>
    </div>,
  );
}
