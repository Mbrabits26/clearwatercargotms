import { useState } from "react";
import { Plus, X } from "lucide-react";
import type { BidAcc } from "@/lib/bidDesk";
import { usd } from "@/lib/tms";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export const BID_ACC_TYPES = ["Stop-off", "Tarp", "Hazmat", "Team", "Driver Assist", "Lumper", "Detention", "TONU", "Liftgate", "Border crossing", "Toll", "Other"];

/** Edits the list of extra charges added to a bid lane's all-in. */
export function AccList({ value, onChange }: { value: BidAcc[]; onChange: (v: BidAcc[]) => void }) {
  const [type, setType] = useState(BID_ACC_TYPES[0]!);
  const [amt, setAmt] = useState("");
  return (
    <div className="space-y-1 text-xs">
      {value.map((a, i) => (
        <div key={i} className="flex items-center gap-1">
          <span className="flex-1">{a.type}</span><b>{usd(a.amount)}</b>
          <button type="button" aria-label={`Remove ${a.type}`} className="text-muted-foreground hover:text-destructive" onClick={() => onChange(value.filter((_, j) => j !== i))}><X className="h-3 w-3" /></button>
        </div>
      ))}
      <div className="flex gap-1">
        <select value={type} onChange={(e) => setType(e.target.value)} className="h-7 flex-1 rounded border bg-background px-1">{BID_ACC_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
        <Input className="h-7 w-20" type="number" placeholder="$" value={amt} onChange={(e) => setAmt(e.target.value)} />
        <Button type="button" size="sm" variant="outline" className="h-7 px-2" disabled={!(Number(amt) > 0)} onClick={() => { onChange([...value, { type, amount: Number(amt) }]); setAmt(""); }}><Plus className="h-3 w-3" /></Button>
      </div>
    </div>
  );
}

/** Compact button showing the accessorial total; opens the editor. */
export function AccButton({ value, onChange }: { value: BidAcc[]; onChange: (v: BidAcc[]) => void }) {
  const total = value.reduce((s, a) => s + a.amount, 0);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="h-7 min-w-16 rounded border px-1.5 text-right text-xs hover:border-gold" title="Add extra charges like stop-offs or tarps">{total ? usd(total) : "+ add"}</button>
      </PopoverTrigger>
      <PopoverContent className="w-64"><div className="mb-1 text-xs font-semibold">Accessorials on this lane</div><AccList value={value} onChange={onChange} /></PopoverContent>
    </Popover>
  );
}
