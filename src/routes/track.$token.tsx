import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { MapPin, Camera, CheckCircle2, Truck } from "lucide-react";
import { getTracking, postPing, uploadTrackingDoc } from "@/lib/tracking.functions";
import { Button } from "@/components/ui/button";
import logo from "@/assets/clearwater-logo.jpg.asset.json";

export const Route = createFileRoute("/track/$token")({
  head: () => ({
    meta: [
      { title: "Load Tracking — Clearwater Cargo" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TrackPage,
});

const STEPS = ["Arrived at shipper", "Loaded / rolling", "Arrived at receiver", "Delivered"];

function TrackPage() {
  const { token } = Route.useParams();
  const { data, isLoading } = useQuery({ queryKey: ["track", token], queryFn: () => getTracking({ data: { token } }) });
  const [note, setNote] = useState("");
  const [done, setDone] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const getPos = (): Promise<{ lat: number; lng: number } | null> =>
    new Promise((res) => {
      if (!navigator.geolocation) return res(null);
      navigator.geolocation.getCurrentPosition(
        (p) => res({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => res(null),
        { timeout: 8000 },
      );
    });

  const send = async (kind: "location" | "status", status?: string) => {
    setBusy(true);
    const pos = await getPos();
    const r = await postPing({ data: { token, kind, status, note: note || undefined, lat: pos?.lat, lng: pos?.lng } });
    setBusy(false);
    if (!r.ok) return toast.error(r.problem);
    if (status) setDone((d) => [...new Set([...d, status])]);
    toast.success(status ? `Update sent: ${status}` : "Location sent");
    setNote("");
  };

  const upload = async (kind: "pod" | "bol", f: File) => {
    if (f.size > 10 * 1024 * 1024) return toast.error("File too large (10 MB max).");
    setBusy(true);
    const buf = await f.arrayBuffer();
    let bin = "";
    new Uint8Array(buf).forEach((b) => (bin += String.fromCharCode(b)));
    const r = await uploadTrackingDoc({ data: { token, kind, fileName: f.name, base64: btoa(bin) } });
    setBusy(false);
    if (!r.ok) return toast.error(r.problem);
    toast.success(`${kind === "pod" ? "POD" : "BOL"} uploaded — thank you!`);
  };

  if (isLoading) return <Shell><p className="text-center text-muted-foreground">Loading…</p></Shell>;
  if (!data?.ok) return <Shell><p className="text-center text-destructive">{data?.problem ?? "Invalid link"}</p></Shell>;
  const l = data.load;

  return (
    <Shell>
      <div className="rounded-md border bg-card p-4">
        <div className="font-mono text-gold">{l.load_number}</div>
        <div className="mt-1 text-lg font-semibold">{l.origin_city}, {l.origin_state} → {l.dest_city}, {l.dest_state}</div>
        <div className="text-sm text-muted-foreground">{l.equipment}{l.commodity ? ` · ${l.commodity}` : ""}</div>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status update</div>
        {STEPS.map((s) => (
          <Button key={s} variant="outline" className="w-full justify-start" disabled={busy || done.includes(s)} onClick={() => send("status", s)}>
            {done.includes(s) ? <CheckCircle2 className="mr-2 h-4 w-4 text-success" /> : <Truck className="mr-2 h-4 w-4" />}
            {s}
          </Button>
        ))}
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional) — e.g. waiting at gate, detention started"
          className="w-full rounded-md border bg-background p-2 text-sm"
          rows={2}
        />
        <Button variant="outline" className="w-full" disabled={busy} onClick={() => send("location")}>
          <MapPin className="mr-2 h-4 w-4" /> Send my location
        </Button>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Documents</div>
        <DocButton label="Upload signed POD" busy={busy} onPick={(f) => upload("pod", f)} />
        <DocButton label="Upload BOL" busy={busy} onPick={(f) => upload("bol", f)} />
      </div>
      <p className="text-center text-xs text-muted-foreground">Photos and updates attach directly to load {l.load_number} at Clearwater Cargo.</p>
    </Shell>
  );
}

function DocButton({ label, busy, onPick }: { label: string; busy: boolean; onPick: (f: File) => void }) {
  return (
    <label className={`flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed p-3 text-sm ${busy ? "opacity-50" : "hover:bg-muted"}`}>
      <Camera className="h-4 w-4" /> {label}
      <input type="file" accept="image/*,application/pdf" capture="environment" className="hidden" disabled={busy}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ""; }} />
    </label>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col gap-4 p-4">
      <div className="flex items-center gap-2">
        <img src={logo.url} alt="Clearwater Cargo" className="h-9 w-9 rounded-sm bg-foreground object-contain" />
        <div className="font-display text-lg font-bold uppercase tracking-wider text-gold">Clearwater Cargo</div>
      </div>
      {children}
    </div>
  );
}
