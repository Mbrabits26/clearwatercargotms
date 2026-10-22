import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import logo from "@/assets/clearwater-logo.jpg.asset.json";
import { Button } from "@/components/ui/button";

type OAuthDetails = {
  client?: { name?: string; client_name?: string; uri?: string; client_uri?: string } | null;
  redirect_uri?: string;
  redirect_url?: string;
  redirect_to?: string;
  scope?: string;
  scopes?: string[];
  user?: { email?: string } | null;
};
type OAuthResult = { data: { redirect_url?: string; redirect_to?: string } | null; error: { message: string } | null };

// Typed wrapper around the beta OAuth helpers on the Cloud auth client.
const oauth = (supabase.auth as unknown as {
  oauth: {
    getAuthorizationDetails: (id: string) => Promise<{ data: OAuthDetails | null; error: { message: string } | null }>;
    approveAuthorization: (id: string) => Promise<OAuthResult>;
    denyAuthorization: (id: string) => Promise<OAuthResult>;
  };
}).oauth;

const SCOPE_LABELS: Record<string, string> = {
  openid: "Confirm who you are",
  email: "Share your email address",
  profile: "Share your basic profile",
};

export const Route = createFileRoute("/.lovable/oauth/consent")({
  // SSR has no browser session and would bounce signed-in users.
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  head: () => ({
    meta: [
      { title: "Connect an app — Clearwater Cargo TMS" },
      { name: "description", content: "Approve or deny an outside app connecting to your Clearwater Cargo TMS account." },
      { property: "og:title", content: "Connect an app — Clearwater Cargo TMS" },
      { property: "og:description", content: "Approve or deny an outside app connecting to your Clearwater Cargo TMS account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("This connection link is missing its request ID. Start the connection again from your AI app.");
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/auth", search: { access: undefined, next: location.href } });
    return { email: data.session.user.email ?? "" };
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.searchStr).get("authorization_id") ?? "";
    const { data, error } = await oauth.getAuthorizationDetails(authorizationId);
    if (error) throw new Error(error.message || "This connection request has expired or is invalid.");
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate });
    return data;
  },
  component: Consent,
  pendingComponent: () => <Shell><p className="text-center text-sm text-muted-foreground">Loading connection request…</p></Shell>,
  errorComponent: ({ error }) => (
    <Shell>
      <h1 className="text-center font-display text-xl font-bold uppercase tracking-wide">Can't load this request</h1>
      <p className="mt-3 text-center text-sm text-muted-foreground">{error instanceof Error ? error.message : String(error)}</p>
      <p className="mt-3 text-center text-xs text-muted-foreground">Start the connection again from your AI app.</p>
    </Shell>
  ),
});

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-lg border bg-card p-8">
        <img src={logo.url} alt="Clearwater Cargo" className="mx-auto mb-4 w-36 rounded bg-foreground p-2" />
        {children}
      </div>
    </div>
  );
}

function Consent() {
  const details = Route.useLoaderData();
  const { email } = Route.useRouteContext();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const client = details?.client?.name ?? details?.client?.client_name ?? "An outside app";
  const redirectHost = (() => {
    try { return details?.redirect_uri ? new URL(details.redirect_uri).host : null; } catch { return null; }
  })();
  const scopes = details?.scopes ?? (details?.scope ? details.scope.split(/\s+/).filter(Boolean) : []);

  async function decide(approve: boolean) {
    setBusy(approve ? "approve" : "deny");
    setError(null);
    const { data, error } = approve ? await oauth.approveAuthorization(authorization_id) : await oauth.denyAuthorization(authorization_id);
    if (error) { setBusy(null); setError(error.message || "Something went wrong. Please try again."); return; }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) { setBusy(null); setError("The sign-in server didn't say where to go next. Start the connection again."); return; }
    window.location.href = target;
  }

  const signOut = async () => {
    await supabase.auth.signOut();
    window.location.href = `/auth?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
  };

  return (
    <Shell>
      <h1 className="text-center font-display text-2xl font-bold uppercase tracking-wide">Connect {client} to Clearwater Cargo</h1>
      <p className="mt-3 text-center text-sm text-muted-foreground">
        {client} will be able to look up loads, carriers and customers in the TMS as you.
      </p>
      <dl className="mt-5 space-y-2 rounded border bg-muted/40 p-3 text-sm">
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Signed in as</dt><dd className="truncate font-medium">{email || "you"}</dd></div>
        {redirectHost && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Sends you back to</dt><dd className="truncate font-mono text-xs">{redirectHost}</dd></div>}
      </dl>
      {scopes.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm">
          {scopes.map((s) => <li key={s}>• {SCOPE_LABELS[s] ?? `Additional permission requested: ${s}`}</li>)}
        </ul>
      )}
      <p className="mt-4 text-xs text-muted-foreground">This doesn't get around your TMS permissions — it only sees what you can see.</p>
      {error && <p role="alert" className="mt-3 rounded border border-destructive/50 bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
      <div className="mt-6 flex gap-2">
        <Button variant="outline" className="flex-1" disabled={!!busy} onClick={() => decide(false)}>{busy === "deny" ? "Cancelling…" : "Cancel connection"}</Button>
        <Button className="flex-1" disabled={!!busy} onClick={() => decide(true)}>{busy === "approve" ? "Connecting…" : "Approve"}</Button>
      </div>
      <button type="button" onClick={signOut} className="mt-4 w-full text-center text-xs text-gold hover:underline">Not you? Use a different account</button>
    </Shell>
  );
}
