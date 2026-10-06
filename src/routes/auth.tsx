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
  head: () => ({
    meta: [
      { title: "Sign in — Clearwater Cargo TMS" },
      { name: "description", content: "Broker and admin sign-in for the Clearwater Cargo TMS." },
      { property: "og:title", content: "Sign in — Clearwater Cargo TMS" },
      { property: "og:description", content: "Broker and admin sign-in for the Clearwater Cargo TMS." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dispatch" });
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => {
      if (s) navigate({ to: "/dispatch" });
    });
    return () => data.subscription.unsubscribe();
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    if (mode === "in") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) toast.error(error.message);
    } else {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin, data: { full_name: name } },
      });
      if (error) toast.error(error.message);
      else toast.success("Check your email to confirm your account.");
    }
    setBusy(false);
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
          {mode === "in" ? "Broker sign in" : "Create account"}
        </h1>
        <form onSubmit={submit} className="mt-6 space-y-3">
          {mode === "up" && (
            <div>
              <Label>Full name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
          )}
          <div>
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <Label>Password</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {mode === "in" ? "Sign in" : "Create account"}
          </Button>
        </form>
        <Button variant="outline" className="mt-3 w-full" onClick={google}>
          Continue with Google
        </Button>
        <button className="mt-4 w-full text-center text-sm text-muted-foreground hover:text-foreground" onClick={() => setMode(mode === "in" ? "up" : "in")}>
          {mode === "in" ? "New to the floor? Create an account" : "Have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}
