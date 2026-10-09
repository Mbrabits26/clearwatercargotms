import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import logo from "@/assets/clearwater-logo.jpg.asset.json";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>): { access?: "pending" } => ({ access: search.access === "pending" ? "pending" : undefined }),
  head: () => ({
    meta: [
      { title: "Sign in — Clearwater Cargo TMS" },
      { name: "description", content: "Broker and admin sign-in for the Clearwater Cargo TMS." },
      { property: "og:title", content: "Sign in — Clearwater Cargo TMS" },
      { property: "og:description", content: "Broker and admin sign-in for the Clearwater Cargo TMS." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { access } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) checkAccess();
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => {
      if (s) checkAccess();
    });
    return () => data.subscription.unsubscribe();
  }, [navigate]);

  const checkAccess = async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { data: approved } = await supabase.rpc("is_approved", { _uid: u.user.id });
    if (approved) navigate({ to: "/dispatch" });
    else {
      await supabase.auth.signOut();
      toast.error("This account has not been approved by an administrator.");
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) toast.error(error.message === "Invalid login credentials" ? "Wrong email or password. If you normally use Google, ask an admin to set a password or use Forgot password." : error.message);
    setBusy(false);
  };
  const forgot = async () => {
    if (!email) return toast.error("Type your email first.");
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + "/reset-password" });
    if (error) toast.error(error.message); else toast.success("Check your email for a reset link.");
  };

  const google = async () => {
    const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin + "/auth" });
    if (r.error) toast.error(String(r.error.message ?? r.error));
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-lg border bg-card p-8">
        <img src={logo.url} alt="Clearwater Cargo" className="mx-auto mb-4 w-40 rounded bg-foreground p-2" />
        <h1 className="text-center font-display text-2xl font-bold uppercase tracking-wide">
          Team sign in
        </h1>
        {access === "pending" && <p className="mt-3 rounded border border-warning/50 bg-warning/10 p-2 text-center text-sm text-warning">Your email must be approved by an administrator before you can enter.</p>}
        <form onSubmit={submit} className="mt-6 space-y-3">
          <div>
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <Label>Password</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            Sign in
          </Button>
        </form>
        <button type="button" onClick={forgot} className="mt-2 w-full text-center text-xs text-gold hover:underline">Forgot password?</button>
        <Button variant="outline" className="mt-3 w-full" onClick={google}>
          Continue with Google
        </Button>
        <p className="mt-4 text-center text-xs text-muted-foreground">Access is limited to team members approved by an administrator.</p>
      </div>
    </div>
  );
}
