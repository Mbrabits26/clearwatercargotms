import { useQuery } from "@tanstack/react-query";
import { Link, useRouteContext } from "@tanstack/react-router";
import { ClipboardList } from "lucide-react";
import { loadWorkQuery } from "@/lib/loadWorkQuery";
import { needsWork, type WorkFilter } from "@/lib/loadWork";

export function LoadWorkNotice() {
  const { user, isAdmin, isAccountant } = useRouteContext({ from: "/_authenticated" });
  const { data, error } = useQuery({ ...loadWorkQuery, refetchInterval: 60_000 });
  if (error) return <div role="alert" className="border-b px-4 py-2 text-xs text-warning">Unfinished-load notices could not load. Refresh to retry.</div>;
  if (!data) return null;
  const loads = data.loads.filter((load) => isAdmin || isAccountant || load.broker_id === user.id);
  const items = ([["delivery", "delivery overdue"], ["invoice", "need invoicing"], ["closeout", "ready for closeout"]] as const)
    .map(([filter, label]) => ({ filter, label, count: loads.filter((load) => needsWork(load, filter, data.invoiceIds)).length })).filter((item) => item.count);
  if (!items.length) return null;
  return <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-warning/10 px-4 py-2 text-xs">
    <span className="flex items-center gap-2 font-semibold text-warning"><ClipboardList className="h-4 w-4" />{isAdmin || isAccountant ? "Company loads" : "Your loads"}</span>
    {items.map((item) => <Link key={item.filter} to="/dispatch" search={{ work: item.filter as WorkFilter, owner: isAdmin || isAccountant ? undefined : user.id }} className="text-gold underline">{item.count} {item.label}</Link>)}
  </div>;
}