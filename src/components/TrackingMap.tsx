import { useEffect, useRef, useState } from "react";

type Pt = { id: string; lat: number; lng: number; label: string };
type LL = { lat: number; lng: number };

/** Leaflet + OpenStreetMap (no API key). pts: newest first. focus: id to pan to. */
export function TrackingMap({ pts, focus, origin, dest }: { pts: Pt[]; focus: string | null; origin: LL | null; dest: LL | null }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const layer = useRef<any>(null);
  const Lr = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([import("leaflet"), import("leaflet/dist/leaflet.css")])
      .then(([mod]) => {
        if (cancelled || !el.current) return;
        const L = (mod as any).default ?? mod;
        Lr.current = L;
        map.current = L.map(el.current, { center: [39.5, -96], zoom: 4 });
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "&copy; OpenStreetMap contributors",
        }).addTo(map.current);
        layer.current = L.layerGroup().addTo(map.current);
        setReady(true);
      })
      .catch(() => setError(true));
    return () => { cancelled = true; map.current?.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const L = Lr.current, m = map.current;
    if (!ready || !L || !m) return;
    layer.current.clearLayers();
    const path = [...pts].reverse().map((p) => [p.lat, p.lng]);
    if (path.length > 1) L.polyline(path, { color: "#d4a017", opacity: 0.8, weight: 3 }).addTo(layer.current);
    pts.forEach((p, i) => {
      L.circleMarker([p.lat, p.lng], {
        radius: i === 0 ? 9 : 5, fillColor: i === 0 ? "#d4a017" : "#2a8c8c", fillOpacity: 1, color: "#000", weight: 1,
      }).bindTooltip(p.label).addTo(layer.current);
    });
    const ends = [origin, dest];
    ends.forEach((loc, i) => {
      if (!loc) return;
      const icon = L.divIcon({
        className: "",
        html: `<div style="background:#d4a017;color:#000;font-weight:700;border:2px solid #000;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:12px">${i === 0 ? "P" : "D"}</div>`,
        iconSize: [22, 22], iconAnchor: [11, 11],
      });
      L.marker([loc.lat, loc.lng], { icon, title: i === 0 ? "Pickup" : "Delivery" }).addTo(layer.current);
    });
    const all: [number, number][] = pts.map((p) => [p.lat, p.lng]);
    if (!pts.length) ends.forEach((e) => e && all.push([e.lat, e.lng]));
    if (all.length === 1) m.setView(all[0], pts.length ? 9 : 7);
    else if (all.length > 1) m.fitBounds(all, { padding: [24, 24] });
  }, [ready, pts, origin, dest]);

  useEffect(() => {
    const p = pts.find((x) => x.id === focus);
    if (p && map.current) map.current.setView([p.lat, p.lng], 11);
  }, [focus]);

  if (error) return <div className="flex h-48 items-center justify-center rounded border bg-muted text-xs text-muted-foreground">Map couldn't load.</div>;
  return <div ref={el} className="relative z-0 h-56 w-full rounded border" />;
}
