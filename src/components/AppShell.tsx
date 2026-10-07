import { DEFAULT_PERMS } from "@/lib/tms";
import { Link, useNavigate, useRouteContext } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Truck, Building2, ShieldCheck, Settings, LogOut, Container, BarChart3, BookOpen, Calculator, Users, MoreHorizontal } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import logo from "@/assets/clearwater-logo.jpg.asset.json";
import { supabase } from "@/integrations/supabase/client";
import { ChatWidget } from "@/components/ChatWidget";
import { ConnectGmail } from "@/components/ConnectGmail";
import { getMailClient, setMailClient, type MailClient } from "@/lib/email";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

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
    { to: "/leads", label: "Leads", icon: Users, p: "leads" },
    { to: "/quotes", label: "Quotes", icon: Calculator, p: "quotes" },
    { to: "/reports", label: "Reports", icon: BarChart3, p: "reports" },
    ...(isAdmin ? [{ to: "/quickbooks", label: "QuickBooks", icon: BookOpen, p: "" }, { to: "/admin", label: "Admin", icon: Settings, p: "" }] : []),
  ].filter((n) => !n.p || isAdmin || (perms ?? DEFAULT_PERMS).includes(n.p));
  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b bg-sidebar px-3 md:px-4">
        <Link to="/dispatch" className="flex shrink-0 items-center gap-2 whitespace-nowrap">
          <img src={logo.url} alt="Clearwater Cargo" className="h-9 w-9 shrink-0 rounded-sm bg-foreground object-contain md:h-10 md:w-10" />
          <div className="leading-none">
            <div className="font-display text-base font-bold uppercase tracking-wider text-gold sm:text-lg">Clearwater Cargo</div>
            <div className="hidden text-[10px] uppercase tracking-[0.2em] text-muted-foreground sm:block">Staley, NC · TMS</div>
          </div>
        </Link>
        <nav className="hidden min-w-0 flex-1 gap-1 overflow-x-auto md:flex">
          {nav.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-sm text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              activeProps={{ className: "bg-sidebar-accent text-sidebar-accent-foreground" }}
            >
              <n.icon className="h-4 w-4" />
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto hidden shrink-0 items-center gap-2 text-sm md:flex">
          <ConnectGmail />
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
          <span className="hidden text-muted-foreground xl:inline">{user.email}</span>
          <Button onClick={signOut} size="icon" variant="ghost" aria-label="Sign out">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-auto pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-30 grid h-[calc(4rem+env(safe-area-inset-bottom))] grid-cols-4 border-t bg-sidebar pb-[env(safe-area-inset-bottom)] md:hidden">
        {nav.filter((n) => ["/dispatch", "/carriers", "/directory"].includes(n.to)).map((n) => (
          <Link key={n.to} to={n.to} className="flex min-h-11 flex-col items-center justify-center gap-1 text-[11px] text-sidebar-foreground/70" activeProps={{ className: "text-gold bg-sidebar-accent" }}>
            <n.icon className="h-5 w-5" />{n.label.replace(" Board", "")}
          </Link>
        ))}
        <Sheet>
          <SheetTrigger asChild><Button variant="ghost" className="h-full min-h-11 rounded-none text-sidebar-foreground/70"><span className="flex flex-col items-center gap-1 text-[11px]"><MoreHorizontal className="h-5 w-5" />More</span></Button></SheetTrigger>
          <SheetContent side="bottom" className="max-h-[85dvh] overflow-auto pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
            <SheetHeader><SheetTitle className="font-display uppercase text-gold">Clearwater Cargo</SheetTitle></SheetHeader>
            <div className="mt-4 grid gap-2">
              {nav.filter((n) => !["/dispatch", "/carriers", "/directory"].includes(n.to)).map((n) => (
                <SheetClose key={n.to} asChild><Link to={n.to} className="flex min-h-11 items-center gap-3 rounded border px-3 text-sm"><n.icon className="h-5 w-5 text-gold" />{n.label}</Link></SheetClose>
              ))}
              <div className="mt-2 border-t pt-3"><ConnectGmail /></div>
              <label className="text-xs text-muted-foreground">Email service<select value={mail} onChange={(e) => { const v = e.target.value as MailClient; setMail(v); setMailClient(v); }} className="mt-1 h-11 w-full rounded border bg-background px-2 text-sm"><option value="gmail">Gmail</option><option value="default">Default app</option></select></label>
              <div className="text-xs text-muted-foreground">{user.email} · {isAdmin ? "Admin" : "Broker"}</div>
              <Button variant="outline" className="min-h-11 justify-start" onClick={signOut}><LogOut className="mr-2 h-4 w-4" />Sign out</Button>
            </div>
          </SheetContent>
        </Sheet>
      </nav>
      <ChatWidget userId={user.id} />
    </div>
  );
}
