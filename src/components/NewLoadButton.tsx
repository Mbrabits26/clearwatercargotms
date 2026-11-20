import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { companiesQuery } from "@/lib/queries";
import { LoadBuilderDialog } from "@/components/LoadBuilderDialog";
import { Button } from "@/components/ui/button";

// Global "New load" button: opens the load builder from any page, then jumps to the new load on the Dispatch board.
export function NewLoadButton({ collapsed, className, beforeOpen }: { collapsed?: boolean; className?: string; beforeOpen?: () => void }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { data: companies = [] } = useQuery(companiesQuery);
  const start = () => { beforeOpen?.(); setOpen(true); };
  return (
    <>
      {collapsed ? (
        <Button size="icon" onClick={start} className={className} aria-label="New load" title="New load"><Plus className="h-4 w-4" /></Button>
      ) : (
        <Button onClick={start} className={className}><Plus className="mr-1.5 h-4 w-4" />New load</Button>
      )}
      {open && (
        <LoadBuilderDialog
          open
          onOpenChange={setOpen}
          companies={companies}
          onCreated={(id) => { setOpen(false); navigate({ to: "/dispatch", search: { load: id } }); }}
        />
      )}
    </>
  );
}
