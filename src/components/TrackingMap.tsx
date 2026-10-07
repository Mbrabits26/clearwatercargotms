import { useEffect, useRef, useState } from "react";

type Pt = { id: string; lat: number; lng: number; label: string };
declare global { interface Window { __cwMapsReady?: () => void; google?: any } }

let loader: Promise<void> | null = null;
function loadMaps(): Promise<void> {
  if (window.google?.maps?.Map) return Promise.resolve();
  if (loader) return loader;
  loader = new Promise((res, rej) => {
    window.__cwMapsReady = () => res();
    const key = import.meta.env["VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY"];
    const ch = import.meta.env["VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID"];
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&loading=async&callback=__cwMapsReady&channel=${ch}`;
    s.async = true;
    s.onerror = () => { loader = null; rej(new Error("map load failed")); };
    document.head.appendChild(s);
  });
  return loader;
}

/** pts: newest first. focus: id to pan to. */
export function TrackingMap({ pts, focus, origin, dest }: { pts: Pt[]; focus: string | null; origin: { lat: number; lng: number } | null; dest: { lat: number; lng: number } | null }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const layers = useRef<any[]>([]);
  const [state, setState] = useState<"loading" | "ok" | "blocked" | "error">("loading");

  useEffect(() => {
    const h = window.location.hostname;
    if (h.endsWith("lovableproject.com") || h === "localhost") { setState("blocked"); return; }
    loadMaps().then(() => setState("ok")).catch(() => setState("error"));
  }, []);

  useEffect(() => {
    if (state !== "ok" || !el.current) return;
    const g = window.google.maps;
    if (!map.current) map.current = new g.Map(el.current, { center: { lat: 39.5, lng: -96 }, zoom: 4, clickableIcons: false, mapTypeControl: false, streetViewControl: false });
    layers.current.forEach((l) => l.setMap(null));
    layers.current = [];
    const m = map.current;
    const bounds = new g.LatLngBounds();
    const path = [...pts].reverse().map((p) => ({ lat: p.lat, lng: p.lng }));
    if (path.length > 1) layers.current.push(new g.Polyline({ map: m, path, strokeColor: "#d4a017", strokeOpacity: 0.8, strokeWeight: 3 }));
    pts.forEach((p, i) => {
      bounds.extend(p);
      layers.current.push(new g.Marker({
        map: m, position: p, title: p.label, zIndex: i === 0 ? 10 : 1,
        icon: { path: g.SymbolPath.CIRCLE, scale: i === 0 ? 9 : 5, fillColor: i === 0 ? "#d4a017" : "#2a8c8c", fillOpacity: 1, strokeColor: "#000", strokeWeight: 1 },
      }));
    });
    const ends = [origin, dest].filter(Boolean) as { lat: number; lng: number }[];
    [origin, dest].forEach((loc, i) => {
      if (!loc) return;
      layers.current.push(new g.Marker({ map: m, position: loc, label: { text: i === 0 ? "P" : "D", color: "#000", fontWeight: "700" }, title: i === 0 ? "Pickup" : "Delivery" }));
    });
    if (!pts.length && ends.length) { ends.forEach((e) => bounds.extend(e)); if (ends.length > 1) m.fitBounds(bounds); else { m.setCenter(ends[0]); m.setZoom(7); } }
    if (pts.length === 1) { m.setCenter(pts[0]); m.setZoom(9); } else if (pts.length > 1) m.fitBounds(bounds);
  }, [state, pts, origin, dest]);

  useEffect(() => {
    const p = pts.find((x) => x.id === focus);
    if (p && map.current) { map.current.panTo(p); map.current.setZoom(11); }
  }, [focus]);

  if (state === "blocked") return <div className="flex h-48 items-center justify-center rounded border bg-muted text-xs text-muted-foreground">Map shows on the published site.</div>;
  if (state === "error") return <div className="flex h-48 items-center justify-center rounded border bg-muted text-xs text-muted-foreground">Map couldn't load.</div>;
  return <div ref={el} className="h-56 w-full rounded border" />;
}
