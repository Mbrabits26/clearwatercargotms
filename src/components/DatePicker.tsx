import { useState } from "react";
import { format, parse, isValid } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Click-to-pick date (optionally with time). Value format matches native inputs:
 * "YYYY-MM-DD" or, with `withTime`, "YYYY-MM-DDTHH:mm".
 */
export function DatePicker({ value, onChange, withTime, min, placeholder = "Pick a date", className }: {
  value: string; onChange: (v: string) => void; withTime?: boolean; min?: string; placeholder?: string; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const datePart = (value ?? "").slice(0, 10);
  const timePart = withTime ? (value ?? "").slice(11, 16) : "";
  const d = datePart ? parse(datePart, "yyyy-MM-dd", new Date()) : undefined;
  const sel = d && isValid(d) ? d : undefined;
  const minD = min ? parse(min, "yyyy-MM-dd", new Date()) : undefined;
  const emit = (date: string, time: string) => {
    if (!date) return onChange("");
    onChange(withTime ? `${date}T${time || "08:00"}` : date);
  };
  return (
    <div className={cn("flex gap-2", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" className={cn("flex-1 justify-start font-normal", !sel && "text-muted-foreground")}>
            <CalendarIcon className="mr-2 h-4 w-4" />
            {sel ? format(sel, "EEE, MMM d, yyyy") : placeholder}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={sel}
            defaultMonth={sel}
            disabled={minD ? { before: minD } : undefined}
            onSelect={(x) => { emit(x ? format(x, "yyyy-MM-dd") : "", timePart); setOpen(false); }}
            className="pointer-events-auto p-3"
          />
          {sel && <div className="border-t p-2"><Button type="button" size="sm" variant="ghost" onClick={() => { emit("", ""); setOpen(false); }}>Clear date</Button></div>}
        </PopoverContent>
      </Popover>
      {withTime && (
        <Input type="time" className="w-28" value={timePart} disabled={!datePart} onChange={(e) => emit(datePart, e.target.value)} />
      )}
    </div>
  );
}
