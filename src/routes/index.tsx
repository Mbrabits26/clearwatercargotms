import { createFileRoute, Link } from "@tanstack/react-router";
import logo from "@/assets/clearwater-logo.jpg.asset.json";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Clearwater Cargo TMS — Brokerage & Fleet Operations" },
      { name: "description", content: "Dispatch, carrier vetting and rate confirmations for Clearwater Cargo, LLC of Staley, NC." },
      { property: "og:title", content: "Clearwater Cargo TMS" },
      { property: "og:description", content: "Dispatch, carrier vetting and rate confirmations for Clearwater Cargo, LLC." },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 px-4 text-center">
      <img src={logo.url} alt="Clearwater Cargo, LLC owl logo" className="w-72 rounded-lg bg-foreground p-4" />
      <div>
        <h1 className="font-display text-5xl font-bold uppercase tracking-wide text-gold">Operations Floor</h1>
        <p className="mt-2 text-muted-foreground">Brokerage dispatch, carrier compliance and rate confirmations.</p>
      </div>
      <Link to="/dispatch" className="rounded-md bg-primary px-6 py-3 font-medium text-primary-foreground hover:bg-primary/90">
        Enter the dispatch board
      </Link>
    </div>
  );
}
