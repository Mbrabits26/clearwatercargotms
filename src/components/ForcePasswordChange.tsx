import { useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Eye, EyeOff } from "lucide-react";
import { completePasswordChange } from "@/lib/users.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Shown when an admin set a temporary password — the user must pick their own before continuing. */
export function ForcePasswordChange() {
  const done = useServerFn(completePasswordChange);
  const [pw, setPw] = useState(""); const [pw2, setPw2] = useState(""); const [show, setShow] = useState(false); const [busy, setBusy] = useState(false);
  const save = async () => {
    if (pw.length < 8) return toast.error("Use at least 8 characters.");
    if (pw !== pw2) return toast.error("The two passwords don't match.");
    setBusy(true);
    try {
      await done({ data: { password: pw } });
      toast.success("Password updated — you're all set");
      window.location.reload();
    } catch (e) { toast.error((e as Error).message); setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent className="max-w-sm" onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader><DialogTitle>Choose your password</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">You signed in with a temporary password. Choose your own to continue.</p>
        <div className="relative">
          <Input type={show ? "text" : "password"} placeholder="New password (8+ characters)" value={pw} onChange={(e) => setPw(e.target.value)} />
          <button type="button" className="absolute right-2 top-2.5 text-muted-foreground" onClick={() => setShow(!show)} aria-label="Show password">{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
        </div>
        <Input type={show ? "text" : "password"} placeholder="Type it again" value={pw2} onChange={(e) => setPw2(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
        <Button disabled={busy} onClick={save}>{busy ? "Saving…" : "Set my password"}</Button>
      </DialogContent>
    </Dialog>
  );
}
