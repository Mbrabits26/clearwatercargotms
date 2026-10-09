import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Set a new password — Clearwater Cargo TMS" },
      { name: "description", content: "Choose a new password for your Clearwater Cargo TMS account." },
      { property: "og:title", content: "Set a new password — Clearwater Cargo TMS" },
      { property: "og:description", content: "Choose a new password for your Clearwater Cargo TMS account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const navigate = useNavigate();
  const [pw, setPw] = useState(""); const [pw2, setPw2] = useState(""); const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) return toast.error("Use at least 8 characters.");
    if (pw !== pw2) return toast.error("The two passwords don't match.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Password updated");
    navigate({ to: "/dispatch" });
  };
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={save} className="w-full max-w-sm space-y-3 rounded-lg border bg-card p-8">
        <h1 className="font-display text-2xl font-bold uppercase">Set a new password</h1>
        <Input type="password" placeholder="New password (8+ characters)" value={pw} onChange={(e) => setPw(e.target.value)} />
        <Input type="password" placeholder="Type it again" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        <Button className="w-full" disabled={busy}>Save password</Button>
      </form>
    </div>
  );
}
