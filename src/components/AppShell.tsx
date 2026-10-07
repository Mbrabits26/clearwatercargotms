import { Link, useNavigate, useRouteContext } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Truck, Building2, ShieldCheck, Settings, LogOut, Container, BarChart3, BookOpen, Calculator } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import logo from "@/assets/clearwater-logo.jpg.asset.json";
import { supabase } from "@/integrations/supabase/client";
import { ChatWidget } from "@/components/ChatWidget";
import { getMailClient, setMailClient, type MailClient } from "@/lib/email";

export function AppShell({ children }: { children: ReactNode }) {
  const { user, isAdmin, perms } = useRouteContext({ from: "/_authenticated" });
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [mail, setMail] = useState<MailClient>("gmail");
  useEffect(() => setMail(getMailClient()), []);
  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };
  const nav = [
    { to: "/dispatch", label: "Dispatch Board", icon: Truck, p: "dispatch" },
    { to: "/directory", label: "Directory", icon: Building2, p: "directory" },
    { to: "/carriers", label: "Carriers", icon: ShieldCheck, p: "carriers" },
    { to: "/fleet", label: "Fleet", icon: Container, p: "fleet" },
    { to: "/quotes", label: "Quotes", icon: Calculator, p: "quotes" },
    { to: "/reports", label: "Reports", icon: BarChart3, p: "reports" },
    ...(isAdmin ? [{ to: "/quickbooks", label: "QuickBooks", icon: BookOpen, p: "" }, { to: "/admin", label: "Admin", icon: Settings, p: "" }] : []),
  ].filter((n) => !n.p || perms.includes(n.p));
  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-14 shrink-0 items-center gap-6 border-b bg-sidebar px-4">
        <Link to="/dispatch" className="flex items-center gap-2">
          <img src={logo.url} alt="Clearwater Cargo" className="h-10 w-10 rounded-sm bg-foreground object-contain" />
          <div className="leading-none">
            <div className="font-display text-lg font-bold uppercase tracking-wider text-gold">Clearwater Cargo</div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Staley, NC · TMS</div>
          </div>
        </Link>
        <nav className="flex gap-1">
          {nav.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              activeProps={{ className: "bg-sidebar-accent text-sidebar-accent-foreground" }}
            >
              <n.icon className="h-4 w-4" />
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <select
            value={mail}
            onChange={(e) => { const v = e.target.value as MailClient; setMail(v); setMailClient(v); }}
            className="rounded border bg-background px-1.5 py-0.5 text-xs"
            title="Which email to use for invites and rate cons"
          >
            <option value="gmail">Email: Gmail</option>
            <option value="default">Email: Default app</option>
          </select>
          <span className="rounded border border-gold/40 px-2 py-0.5 text-xs uppercase tracking-wider text-gold">
            {isAdmin ? "Admin" : "Broker"}
          </span>
          <span className="text-muted-foreground">{user.email}</span>
          <button onClick={signOut} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Sign out">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-auto">{children}</main>
      <ChatWidget userId={user.id} />
    </div>
  );
}
