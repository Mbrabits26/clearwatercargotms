import { Link, useNavigate, useRouteContext } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Truck, Building2, ShieldCheck, Settings, LogOut, Container, BarChart3, BookOpen } from "lucide-react";
import type { ReactNode } from "react";
import logo from "@/assets/clearwater-logo.jpg.asset.json";
import { supabase } from "@/integrations/supabase/client";

export function AppShell({ children }: { children: ReactNode }) {
  const { user, isAdmin } = useRouteContext({ from: "/_authenticated" });
  const qc = useQueryClient();
  const navigate = useNavigate();
  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };
  const nav = [
    { to: "/dispatch", label: "Dispatch Board", icon: Truck },
    { to: "/directory", label: "Directory", icon: Building2 },
    { to: "/carriers", label: "Carriers", icon: ShieldCheck },
    { to: "/fleet", label: "Fleet", icon: Container },
    { to: "/reports", label: "Reports", icon: BarChart3 },
    ...(isAdmin ? [{ to: "/quickbooks", label: "QuickBooks", icon: BookOpen }, { to: "/admin", label: "Admin", icon: Settings }] : []),
  ] as const;
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
    </div>
  );
}
