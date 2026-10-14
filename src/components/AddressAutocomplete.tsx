import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { MapPin } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { placeDetails, placesAutocomplete } from "@/lib/places.functions";

export type PlacePick = { name: string; phone: string; address: string; city: string; state: string; zip: string };

/** Street-address input with Google suggestions; picking one fills the other fields via onPick. */
export function AddressAutocomplete({ value, onChange, onPick, placeholder }: { value: string; onChange: (v: string) => void; onPick: (p: PlacePick) => void; placeholder?: string }) {
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
        const r = await auto({ data: { input: value, sessionToken: token.current } });
        if (n === seq.current) { setItems(r); setOpen(true); }
      } catch { if (n === seq.current) setItems([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [value, auto]);

  const pick = async (id: string) => {
    setOpen(false); setItems([]); typed.current = false;
    try {
      const p = await details({ data: { placeId: id, sessionToken: token.current } });
      onPick(p);
    } catch (e) { toast.error((e as Error).message); }
    token.current = crypto.randomUUID();
  };

  return (
    <div className="relative">
      <Input className="mt-1" value={value} placeholder={placeholder ?? "Start typing an address or business"} autoComplete="off"
        onChange={(e) => { typed.current = true; onChange(e.target.value); }}
        onFocus={() => items.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && items.length > 0 && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md">
          {items.map((s) => (
            <button key={s.id} type="button" className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-accent" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(s.id)}>
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{s.text}
            </button>
          ))}
          <div className="px-3 py-1 text-right text-[10px] text-muted-foreground">Powered by Google</div>
        </div>
      )}
    </div>
  );
}
