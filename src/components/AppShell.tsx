import { DEFAULT_PERMS } from "@/lib/tms";
import { DueReminders } from "@/components/DueReminders";
import { CarrierPayDue } from "@/components/CarrierPayDue";
import { LoadWorkNotice } from "@/components/LoadWorkNotice";
import { InvoicedQbReview } from "@/components/InvoicedQbReview";
import { Link, useNavigate, useRouteContext } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Truck, Building2, ShieldCheck, Settings, LogOut, Container, BarChart3, BookOpen, Calculator, Users, MoreHorizontal, Gavel, Home, PanelLeftClose, PanelLeftOpen, Settings2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import logo from "@/assets/clearwater-logo.jpg.asset.json";
import { supabase } from "@/integrations/supabase/client";
import { ChatWidget } from "@/components/ChatWidget";
import { NewLoadButton } from "@/components/NewLoadButton";
import { QuickOnboardButton } from "@/components/QuickOnboard";
import { LandingPicker } from "@/components/LandingPicker";
import { LoadHoverPreview } from "@/components/LoadHoverPreview";
import { landingFor, type Landing } from "@/lib/landing";
import { AppWindowsProvider } from "@/lib/appWindows";
import { AppWindowHost } from "@/components/AppWindowHost";
import { NotificationBell } from "@/components/NotificationBell";
import { ConnectGmail } from "@/components/ConnectGmail";
import { getMailClient, setMailClient, type MailClient } from "@/lib/email";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

export function AppShell({ children }: { children: ReactNode }) {
  const { user, isAdmin, isAccountant, perms } = useRouteContext({ from: "/_authenticated" });
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [mail, setMail] = useState<MailClient>("gmail");
  useEffect(() => setMail(getMailClient()), []);
  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", search: { access: undefined }, replace: true });
  };
  const [home, setHome] = useState<Landing>("/dispatch");
  useEffect(() => setHome(landingFor(user.id, { isAdmin, isAccountant })), [user.id, isAdmin, isAccountant]);
  const [collapsed, setCollapsed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => setCollapsed(localStorage.getItem("cw-side-collapsed") === "1"), []);
  const toggleSide = () => setCollapsed((c) => { localStorage.setItem("cw-side-collapsed", c ? "0" : "1"); return !c; });
  const roleLabel = [isAdmin && "Admin", isAccountant && "Accountant"].filter(Boolean).join(" / ") || "Broker";
  const nav = [
    { to: "/home", label: "Home", icon: Home, p: "" },
    { to: "/dispatch", label: "Dispatch Board", icon: Truck, p: "dispatch" },
    { to: "/directory", label: "Directory", icon: Building2, p: "directory" },
    { to: "/carriers", label: "Carriers", icon: ShieldCheck, p: "carriers" },
    { to: "/fleet", label: "Fleet", icon: Container, p: "fleet" },
    { to: "/leads", label: "Leads", icon: Users, p: "leads" },
    { to: "/quotes", label: "Quotes", icon: Calculator, p: "quotes" },
    { to: "/bids", label: "Bid Desk", icon: Gavel, p: "quotes" },
    { to: "/reports", label: "Reports", icon: BarChart3, p: "reports" },
    { to: "/quickbooks", label: "Accounting", icon: BookOpen, p: "" },
    ...(isAdmin ? [{ to: "/admin", label: "Admin", icon: Settings, p: "" }] : []),
  ].filter((n) => !n.p || isAdmin || (perms ?? DEFAULT_PERMS).includes(n.p));
  return (
    <AppWindowsProvider>
    <div className="flex h-dvh flex-col print:block print:h-auto">
      <header className="flex h-14 print:hidden shrink-0 items-center gap-3 border-b bg-sidebar px-3 lg:px-4">
        <Button variant="ghost" size="icon" className="hidden shrink-0 lg:inline-flex" onClick={toggleSide} aria-label={collapsed ? "Expand menu" : "Collapse menu"} title={collapsed ? "Expand menu" : "Collapse menu"}>
          {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
        </Button>
        <Link to={home} className="flex min-w-0 items-center gap-2 whitespace-nowrap">
          <img src={logo.url} alt="Clearwater Cargo" className="h-9 w-9 shrink-0 rounded-sm bg-foreground object-contain lg:h-10 lg:w-10" />
          <div className="min-w-0 leading-none">
            <div className="truncate font-display text-base font-bold uppercase tracking-wider text-gold sm:text-lg">Clearwater Cargo</div>
            <div className="hidden text-[10px] uppercase tracking-[0.2em] text-muted-foreground sm:block">Staley, NC · TMS</div>
          </div>
        </Link>
        <div className="ml-auto hidden shrink-0 sm:block"><QuickOnboardButton label="Onboard" /></div>
        <div className="ml-auto shrink-0 sm:ml-0 lg:hidden"><NewLoadButton collapsed /></div>
        <div className="shrink-0"><NotificationBell userId={user.id} isAdmin={isAdmin} isFinance={isAdmin || isAccountant} /></div>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="hidden shrink-0 lg:inline-flex" aria-label="Settings" title="Settings"><Settings2 className="h-5 w-5" /></Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 space-y-3">
            <div className="text-sm">
              <div className="truncate font-medium">{user.email}</div>
              <span className="mt-1 inline-block rounded border border-gold/40 px-2 py-0.5 text-xs uppercase tracking-wider text-gold">{roleLabel}</span>
            </div>
            <div className="border-t pt-3"><ConnectGmail /></div>
            <label className="block text-xs text-muted-foreground">Email service
              <select value={mail} onChange={(e) => { const v = e.target.value as MailClient; setMail(v); setMailClient(v); }} className="mt-1 h-9 w-full rounded border bg-background px-2 text-sm text-foreground">
                <option value="gmail">Gmail</option><option value="default">Default app</option>
              </select>
            </label>
            <label className="block text-xs text-muted-foreground">Start screen
              <LandingPicker className="mt-1 h-9 w-full rounded border bg-background px-2 text-sm text-foreground" />
            </label>
            <Button variant="outline" className="w-full justify-start" onClick={signOut}><LogOut className="mr-2 h-4 w-4" />Sign out</Button>
          </PopoverContent>
        </Popover>
      </header>
      <div className="flex min-h-0 flex-1 print:block">
        <aside className={`hidden shrink-0 flex-col gap-1 overflow-y-auto border-r bg-sidebar p-2 print:hidden lg:flex ${collapsed ? "w-14" : "w-52"}`}>
          <NewLoadButton collapsed={collapsed} className={collapsed ? "mx-auto" : "w-full justify-start"} />
          {nav.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              title={n.label}
              className={`flex items-center gap-3 whitespace-nowrap rounded-md py-2 text-sm text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${collapsed ? "justify-center px-0" : "px-3"}`}
              activeProps={{ className: "bg-sidebar-accent text-gold" }}
            >
              <n.icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span className="truncate">{n.label}</span>}
            </Link>
          ))}
        </aside>
      <main className="min-h-0 min-w-0 flex-1 overflow-auto print:overflow-visible pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0"><div className="print:hidden"><LoadWorkNotice />{(isAdmin || isAccountant) && <><InvoicedQbReview /><CarrierPayDue /><DueReminders /></>}</div>{children}</main>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-30 print:hidden grid h-[calc(4rem+env(safe-area-inset-bottom))] grid-cols-4 border-t bg-sidebar pb-[env(safe-area-inset-bottom)] lg:hidden">
        {nav.filter((n) => ["/dispatch", "/carriers", "/directory"].includes(n.to)).map((n) => (
          <Link key={n.to} to={n.to} className="flex min-h-11 flex-col items-center justify-center gap-1 text-[11px] text-sidebar-foreground/70" activeProps={{ className: "text-gold bg-sidebar-accent" }}>
            <n.icon className="h-5 w-5" />{n.label.replace(" Board", "")}
          </Link>
        ))}
        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetTrigger asChild><Button variant="ghost" className="h-full min-h-11 rounded-none text-sidebar-foreground/70"><span className="flex flex-col items-center gap-1 text-[11px]"><MoreHorizontal className="h-5 w-5" />More</span></Button></SheetTrigger>
          <SheetContent side="bottom" className="max-h-[85dvh] overflow-auto pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
            <SheetHeader><SheetTitle className="font-display uppercase text-gold">Clearwater Cargo</SheetTitle></SheetHeader>
            <div className="mt-4 grid gap-2">
              <NewLoadButton className="min-h-11 w-full justify-start" beforeOpen={() => setMoreOpen(false)} />
              {nav.filter((n) => !["/dispatch", "/carriers", "/directory"].includes(n.to)).map((n) => (
                <SheetClose key={n.to} asChild><Link to={n.to} className="flex min-h-11 items-center gap-3 rounded border px-3 text-sm"><n.icon className="h-5 w-5 text-gold" />{n.label}</Link></SheetClose>
              ))}
              <div className="mt-2 border-t pt-3"><ConnectGmail /></div>
              <QuickOnboardButton className="min-h-11 justify-start" label="Onboard a carrier" />
              <LandingPicker className="h-11 w-full rounded border bg-background px-2 text-sm" />
              <label className="text-xs text-muted-foreground">Email service<select value={mail} onChange={(e) => { const v = e.target.value as MailClient; setMail(v); setMailClient(v); }} className="mt-1 h-11 w-full rounded border bg-background px-2 text-sm"><option value="gmail">Gmail</option><option value="default">Default app</option></select></label>
              <div className="text-xs text-muted-foreground">{user.email} · {[isAdmin && "Admin", isAccountant && "Accountant"].filter(Boolean).join(" / ") || "Broker"}</div>
              <Button variant="outline" className="min-h-11 justify-start" onClick={signOut}><LogOut className="mr-2 h-4 w-4" />Sign out</Button>
            </div>
          </SheetContent>
        </Sheet>
      </nav>
      <div className="print:hidden"><ChatWidget userId={user.id} /></div>
      <AppWindowHost />
      <LoadHoverPreview />
    </div>
    </AppWindowsProvider>
  );
}
