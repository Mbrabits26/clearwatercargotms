import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { placeDetails, placesAutocomplete } from "@/lib/places.functions";
import { cn } from "@/lib/utils";

/** "City, ST" input with Google city suggestions; picking one writes "City, ST" and calls onPick. */
export function CityInput({ value, onChange, onPick, placeholder, className }: { value: string; onChange: (v: string) => void; onPick?: (v: string) => void; placeholder?: string; className?: string }) {
  const auto = useServerFn(placesAutocomplete);
  const details = useServerFn(placeDetails);
  const [items, setItems] = useState<{ id: string; text: string }[]>([]);
  const [open, setOpen] = useState(false);
  const token = useRef(crypto.randomUUID());
  const seq = useRef(0);
  const typed = useRef(false);

  useEffect(() => {
    if (!typed.current || value.trim().length < 3) { setItems([]); return; }
    const n = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const r = await auto({ data: { input: value, sessionToken: token.current, cities: true } });
        if (n === seq.current) { setItems(r); setOpen(true); }
      } catch { if (n === seq.current) setItems([]); }
    }, 250);
    return () => clearTimeout(t);
  }, [value, auto]);

  const pick = async (s: { id: string; text: string }) => {
    setOpen(false); setItems([]); typed.current = false;
    let v = s.text.replace(/, (USA|United States)$/, "");
    try {
      const p = await details({ data: { placeId: s.id, sessionToken: token.current } });
      if (p.city && p.state) v = `${p.city}, ${p.state}`;
    } catch { /* keep suggestion text */ }
    token.current = crypto.randomUUID();
    onChange(v); onPick?.(v);
  };

  return (
    <div className={cn("relative", className)}>
      <Input value={value} placeholder={placeholder} autoComplete="off"
        onChange={(e) => { typed.current = true; onChange(e.target.value); }}
        onFocus={() => items.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && items.length > 0 && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md">
          {items.map((s) => (
            <button key={s.id} type="button" className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-accent" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(s)}>
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{s.text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
