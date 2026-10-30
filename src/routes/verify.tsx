import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { CheckCircle2, FileSearch, XCircle } from "lucide-react";
import { verifySignedDocument } from "@/lib/verify.functions";
import { sha256Hex } from "@/lib/esign";

export const Route = createFileRoute("/verify")({
  head: () => ({
    meta: [
      { title: "Verify a Signed Document — Clearwater Cargo" },
      { name: "description", content: "Check that a signed Clearwater Cargo rate confirmation or carrier agreement is the original, unchanged copy." },
      { property: "og:title", content: "Verify a Signed Document — Clearwater Cargo" },
      { property: "og:description", content: "Check that a signed Clearwater Cargo document is the original, unchanged copy." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: VerifyPage,
});

type Result = Awaited<ReturnType<typeof verifySignedDocument>>;

function VerifyPage() {
  const verify = useServerFn(verifySignedDocument);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [drag, setDrag] = useState(false);

  const check = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true); setResult(null); setFile(f.name);
    try {
      const h = await sha256Hex(await f.arrayBuffer());
      setHash(h);
      setResult(await verify({ data: { sha256: h } }));
    } catch {
      setResult({ found: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background px-3 py-8 sm:px-4">
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold uppercase sm:text-3xl">Verify a signed document</h1>
          <p className="text-sm text-muted-foreground">Clearwater Cargo LLC · Staley, NC · 252-497-7916</p>
        </div>
        <p className="text-sm text-muted-foreground">
          Choose a signed rate confirmation or broker-carrier agreement PDF. Your device works out the file's fingerprint and we compare it with the
          one we saved when it was signed. The file itself is not uploaded.
        </p>
        <label
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); void check(e.dataTransfer.files[0]); }}
          className={`flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded border-2 border-dashed bg-card p-6 text-center ${drag ? "border-gold" : "border-border"}`}
        >
          <FileSearch className="h-8 w-8 text-gold" />
          <span className="font-semibold">{busy ? "Checking…" : file ?? "Drop the PDF here or tap to choose"}</span>
          <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => void check(e.target.files?.[0])} />
        </label>
        {result?.found && (
          <div className="space-y-1 rounded border border-success bg-card p-4 text-sm">
            <div className="flex items-center gap-2 text-base font-semibold text-success"><CheckCircle2 className="h-5 w-5" />Original signed copy — unchanged</div>
            <div><b>{result.document}</b>{result.detail ? ` · ${result.detail}` : ""}</div>
            <div>Carrier: {result.party || "—"}</div>
            <div>Signed by {result.signer ?? "—"}{result.signedAt ? ` on ${new Date(result.signedAt).toLocaleString("en-US", { timeZone: "America/New_York" })} ET` : ""}</div>
            {result.voided && <div className="font-semibold text-destructive">This rate confirmation was later cancelled by Clearwater Cargo.</div>}
          </div>
        )}
        {result && !result.found && (
          <div className="space-y-1 rounded border border-destructive bg-card p-4 text-sm">
            <div className="flex items-center gap-2 text-base font-semibold text-destructive"><XCircle className="h-5 w-5" />No match</div>
            <p>This file doesn't match any signed copy we have on record. It may have been changed, re-saved or printed to a new PDF, or it was signed before fingerprints were saved (October 30, 2026).</p>
          </div>
        )}
        {hash && <p className="break-all font-mono text-xs text-muted-foreground">File fingerprint (SHA-256): {hash}</p>}
      </div>
    </div>
  );
}
