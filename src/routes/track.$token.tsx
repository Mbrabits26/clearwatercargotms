import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { MapPin, Camera, CheckCircle2, Truck, ShieldCheck, Images, X } from "lucide-react";
import { getTracking, postPing, uploadTrackingDoc, finishTrackingPod } from "@/lib/tracking.functions";
import { savePodPhotos, type PodPhoto } from "@/lib/podUpload";
import { buildPodPdf, podImageBytes } from "@/lib/podPdf";
import { Button } from "@/components/ui/button";
import { ScanReview } from "@/components/ScanReview";
import logo from "@/assets/clearwater-logo.jpg.asset.json";

export const Route = createFileRoute("/track/$token")({
  head: () => ({
    meta: [
      { title: "Load Tracking — Clearwater Cargo" },
      { name: "description", content: "Send load status, location and delivery documents to Clearwater Cargo." },
      { property: "og:title", content: "Load Tracking — Clearwater Cargo" },
      { property: "og:description", content: "Send load status, location and delivery documents to Clearwater Cargo." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TrackPage,
});

const STEPS = ["Arrived at shipper", "Loaded / rolling", "Arrived at receiver", "Delivered"];

function TrackPage() {
  const { token } = Route.useParams();
  const { data, isLoading, refetch } = useQuery({ queryKey: ["track", token], queryFn: () => getTracking({ data: { token } }) });
  const [note, setNote] = useState("");
  const [done, setDone] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [photos, setPhotos] = useState<(PodPhoto<File> & { preview?: string })[]>([]);
  const [progress, setProgress] = useState("");
  const [podPath, setPodPath] = useState<string>();
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const previews = useRef<string[]>([]);
  useEffect(() => () => { previews.current.forEach(url => URL.revokeObjectURL(url)); }, []);

  const [reviewQueue, setReviewQueue] = useState<File[]>([]);
  const addPhotos = (files: FileList | null) => {
    if (!files) return;
    const list = Array.from(files).filter(f => f.size <= 10 * 1024 * 1024 || (toast.error(`${f.name}: file too large (10 MB max).`), false));
    const images = list.filter(f => f.type.startsWith("image/"));
    if (images.length) setReviewQueue(q => [...q, ...images]);
    addReviewed(list.filter(f => !f.type.startsWith("image/")));
  };
  const reviewed = (result: File | null) => {
    setReviewQueue(q => q.slice(1));
    if (result) addReviewed([result]);
  };
  const addReviewed = (files: File[]) => {
    const added: typeof photos = [];
    for (const file of files) {
      if (file.size > 10 * 1024 * 1024) { toast.error(`${file.name}: file too large (10 MB max).`); continue; }
      const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
      if (preview) previews.current.push(preview);
      added.push({ id: crypto.randomUUID(), file, preview });
    }
    setPhotos(current => [...current, ...added]);
  };

  const finishPod = async () => {
    setBusy(true);
    try {
      await savePodPhotos([{ id: "pod-pdf", file: photos, path: podPath }], async selected => {
        setProgress("Creating POD PDF…");
        const files = [];
        for (const photo of selected) files.push({ name: photo.file.name, bytes: await podImageBytes(photo.file) });
        const bytes = await buildPodPdf(files);
        if (bytes.length > 10 * 1024 * 1024) throw new Error("Combined POD exceeds 10 MB. Choose smaller photos or a smaller PDF and try again.");
        setProgress("Uploading POD PDF…");
        let bin = "";
        bytes.forEach(byte => { bin += String.fromCharCode(byte); });
        const result = await uploadTrackingDoc({ data: { token, kind: "pod", fileName: "signed-POD.pdf", base64: btoa(bin), deferCompletion: true } });
        if (!result.ok) throw new Error(result.problem);
        return result.path;
      }, (_id, path) => setPodPath(path), async paths => {
        setProgress("Completing POD…");
        const result = await finishTrackingPod({ data: { token, paths } });
        if (!result.ok) throw new Error(result.problem);
      });
      toast.success("Signed POD uploaded as one PDF — thank you!");
      setPhotos([]);
      setPodPath(undefined);
      await refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload interrupted. Please try again.");
    } finally { setBusy(false); setProgress(""); }
  };
  // "unknown" until checked; buttons stay locked until location is turned on for this page.
  const [geo, setGeo] = useState<"unknown" | "granted" | "blocked" | "unsupported">("unknown");

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) { setGeo("unsupported"); return; }
    const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
    perms?.query({ name: "geolocation" as PermissionName }).then((st) => {
      const apply = () => setGeo(st.state === "granted" ? "granted" : st.state === "denied" ? "blocked" : "unknown");
      apply();
      st.onchange = apply;
    }).catch(() => {});
  }, []);

  const tryPos = (opts: PositionOptions): Promise<{ lat: number; lng: number } | null> =>
    new Promise((res) => {
      navigator.geolocation.getCurrentPosition(
        (p) => { setGeo("granted"); res({ lat: p.coords.latitude, lng: p.coords.longitude }); },
        (err) => { if (err.code === err.PERMISSION_DENIED) setGeo("blocked"); res(null); },
        opts,
      );
    });

  const getPos = async (): Promise<{ lat: number; lng: number } | null> => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return null;
    return (await tryPos({ maximumAge: 120000, timeout: 6000, enableHighAccuracy: false }))
      ?? (await tryPos({ maximumAge: 0, timeout: 20000, enableHighAccuracy: true }));
  };

  const enable = async () => {
    setBusy(true);
    const pos = await getPos();
    setBusy(false);
    if (pos) toast.success("Location turned on for this load.");
    else toast.error("Location is still off. Allow Location for this browser, then try again.");
  };

  const send = async (kind: "location" | "status", status?: string) => {
    setBusy(true);
    const pos = await getPos();
    if (!pos) {
      setBusy(false);
      return toast.error("Location is required to send updates. Turn on Location for this page and try again.");
    }
    const r = await postPing({ data: { token, kind, status, note: note || undefined, lat: pos.lat, lng: pos.lng } });
    setBusy(false);
    if (!r.ok) return toast.error(r.problem);
    if (status) setDone((d) => [...new Set([...d, status])]);
    toast.success(status ? `Update sent: ${status}` : "Location sent");
    if (r.delivered) { toast.success("Load marked Delivered — signed POD is on file. Tracking has ended."); refetch(); }
    if (r.needsPod) toast.warning("Please upload the signed POD below to complete delivery.");
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
    toast.success(`${kind === "pod" ? "POD" : "BOL"} uploaded — thank you!${r.delivered ? " Load marked Delivered." : ""}`);
    if (kind === "pod") refetch();
  };

  const nextScan = reviewQueue[0];
  if (nextScan) return <ScanReview key={reviewQueue.length + nextScan.name + nextScan.lastModified} file={nextScan} onDone={reviewed} />;
  if (isLoading) return <Shell><p className="text-center text-muted-foreground">Loading…</p></Shell>;
  if (!data?.ok) {
    if (data && "completed" in data && data.completed) return (
      <Shell>
        <div className="rounded-md border bg-card p-6 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-success" />
          <div className="mt-2 font-display text-xl font-bold uppercase tracking-wider">Load completed — tracking closed</div>
          <p className="mt-2 text-sm text-muted-foreground">This load was delivered and the signed POD is on file. All tracking has stopped and this link is no longer valid. Thank you for hauling with Clearwater Cargo!</p>
        </div>
      </Shell>
    );
    return <Shell><p className="text-center text-destructive">{data?.problem ?? "Invalid link"}</p></Shell>;
  }
  const l = data.load;
  const locked = geo !== "granted";

  return (
    <Shell>
      <div className="rounded-md border bg-card p-4">
        <div className="font-mono text-gold">{l.load_number}</div>
        <div className="mt-1 text-lg font-semibold">{l.origin_city}, {l.origin_state} → {l.dest_city}, {l.dest_state}</div>
        <div className="text-sm text-muted-foreground">{l.equipment}{l.commodity ? ` · ${l.commodity}` : ""}</div>
      </div>

      <div className="rounded-md border border-gold/40 bg-gold/10 p-3 text-xs">
        <div className="mb-1 flex items-center gap-1.5 font-semibold uppercase tracking-wider text-gold"><ShieldCheck className="h-4 w-4" /> Driver privacy notice</div>
        Location is used only for this load, and only when you send an update. Once the load is delivered and the signed POD is uploaded, <b>all tracking stops and this link is no longer valid</b>.
      </div>

      {locked && (
        <div className={`space-y-2 rounded-md border p-3 text-sm ${geo === "blocked" ? "border-destructive/50 bg-destructive/10" : "bg-card"}`}>
          <div className="font-semibold">Location access is required for this link</div>
          {geo === "unsupported" ? (
            <p className="text-xs text-muted-foreground">This browser can't share location. Open the link in Safari or Chrome on your phone.</p>
          ) : geo === "blocked" ? (
            <p className="text-xs text-muted-foreground">Location is blocked. In your phone settings, allow Location for this browser (Safari or Chrome), then reload this page.</p>
          ) : (
            <p className="text-xs text-muted-foreground">Tap below, then tap “Allow” when your phone asks.</p>
          )}
          {geo !== "unsupported" && (
            <Button className="w-full" disabled={busy} onClick={geo === "blocked" ? () => window.location.reload() : enable}>
              <MapPin className="mr-2 h-4 w-4" /> {geo === "blocked" ? "I turned it on — reload" : "Turn on location"}
            </Button>
          )}
        </div>
      )}

      <div className={`space-y-2 ${locked ? "pointer-events-none opacity-50" : ""}`} aria-disabled={locked}>
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status update</div>
        {STEPS.map((s) => (
          <Button key={s} variant="outline" className="w-full justify-start" disabled={busy || locked || photos.length > 0 || done.includes(s)} onClick={() => send("status", s)}>
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
          disabled={locked}
        />
        <Button variant="outline" className="w-full" disabled={busy || locked} onClick={() => send("location")}>
          <MapPin className="mr-2 h-4 w-4" /> Send my location
        </Button>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Documents</div>
        <div className="space-y-3 border-y py-3">
          <div className="text-sm font-semibold">Signed POD photos</div>
          <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden" disabled={busy} aria-label="Take POD photo" onChange={e => { addPhotos(e.target.files); e.target.value = ""; }} />
          <input ref={galleryInput} type="file" accept="image/*,application/pdf" multiple className="hidden" disabled={busy} aria-label="Choose POD photos" onChange={e => { addPhotos(e.target.files); e.target.value = ""; }} />
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" disabled={busy || !!podPath} onClick={() => cameraInput.current?.click()}><Camera className="mr-2 h-4 w-4" /> {photos.length ? "Take another" : "Take photo"}</Button>
            <Button variant="outline" disabled={busy || !!podPath} onClick={() => galleryInput.current?.click()}><Images className="mr-2 h-4 w-4" /> Add photos / PDF</Button>
          </div>
          {photos.length > 0 && <>
            <div className="grid grid-cols-2 gap-3">
              {photos.map((photo, index) => <div key={photo.id} className="min-w-0 space-y-1">
                <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-md border bg-muted">
                  {photo.preview ? <img src={photo.preview} alt={`POD photo ${index + 1}`} className="h-full w-full object-contain" /> : <span className="text-sm text-muted-foreground">PDF</span>}
                  {!podPath && <Button size="icon" variant="secondary" className="absolute right-1 top-1 h-7 w-7" disabled={busy} aria-label={`Remove POD photo ${index + 1}`} title="Remove photo" onClick={() => setPhotos(current => current.filter(item => item.id !== photo.id))}><X className="h-4 w-4" /></Button>}
                </div>
                <div className="break-all text-xs text-muted-foreground">{photo.file.name}{photo.path ? " · Uploaded" : ""}</div>
              </div>)}
            </div>
            <Button className="w-full" disabled={busy} onClick={finishPod}><CheckCircle2 className="mr-2 h-4 w-4" /> {busy ? progress : podPath ? "Retry finishing POD" : "Upload one PDF & finish POD"}</Button>
          </>}
        </div>
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
