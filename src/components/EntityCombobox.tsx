import { useMemo, useState } from "react";
import { Plus, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type ComboOption = { id: string; label: string; sub?: string; disabled?: boolean; search?: string };
export type ComboValue = { id: string | null; name: string };

/** Type to search; pick a match or keep the typed name as a new record. */
export function EntityCombobox({
  value, onChange, options, placeholder, newLabel = "new",
}: { value: ComboValue; onChange: (v: ComboValue, picked?: ComboOption) => void; options: ComboOption[]; placeholder?: string; newLabel?: string }) {
  const [open, setOpen] = useState(false);
  const q = value.name.trim().toLowerCase();
  const matches = useMemo(
    () => (q ? options.filter((o) => `${o.label} ${o.sub ?? ""} ${o.search ?? ""}`.toLowerCase().includes(q)) : options).slice(0, 30),
    [q, options],
  );
  const exact = options.find((o) => o.label.toLowerCase() === q);
  return (
    <div className="relative">
      <Input
        value={value.name}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { onChange({ id: null, name: e.target.value }); setOpen(true); }}
        className={cn(value.name && !value.id && "border-warning")}
      />
      {value.id && <Check className="absolute right-2 top-2.5 h-4 w-4 text-success" />}
      {value.name && !value.id && <div className="mt-0.5 text-[10px] uppercase text-warning">Will be added as {newLabel}</div>}
      {open && (matches.length > 0 || (q && !exact)) && (
        <ul className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover text-sm shadow-lg">
          {matches.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                disabled={o.disabled}
                onMouseDown={(e) => { e.preventDefault(); onChange({ id: o.id, name: o.label }, o); setOpen(false); }}
                className="w-full px-3 py-1.5 text-left hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                <div>{o.label}</div>
                {o.sub && <div className="text-[11px] text-muted-foreground">{o.sub}</div>}
              </button>
            </li>
          ))}
          {q && !exact && (
            <li>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); onChange({ id: null, name: value.name.trim() }); setOpen(false); }}
                className="flex w-full items-center gap-1 border-t px-3 py-1.5 text-left text-gold hover:bg-muted">
                <Plus className="h-3.5 w-3.5" />Add “{value.name.trim()}” as {newLabel}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
