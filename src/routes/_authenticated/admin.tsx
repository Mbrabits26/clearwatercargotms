import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { setUserAdmin } from "@/lib/users.functions";
import { supabase } from "@/integrations/supabase/client";
import { loadsQuery, profilesQuery } from "@/lib/queries";
import { loadTotals, usd } from "@/lib/tms";
import { Input } from "@/components/ui/input";
import { UserManagement } from "@/components/UserManagement";
import { ItsSync } from "@/components/ItsSync";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Admin — Clearwater Cargo TMS" },
      { name: "description", content: "Company financials, broker roles and commission." },
      { property: "og:title", content: "Admin — Clearwater Cargo TMS" },
      { property: "og:description", content: "Company financials, broker roles and commission." },
    ],
  }),
  beforeLoad: ({ context }) => {
    if (!context.isAdmin) throw redirect({ to: "/dispatch" });
  },
  loader: ({ context }) => Promise.all([context.queryClient.ensureQueryData(loadsQuery), context.queryClient.ensureQueryData(profilesQuery)]),
  component: Admin,
});

function Admin() {
  const { data: loads } = useSuspenseQuery(loadsQuery);
  const { data: profiles } = useSuspenseQuery(profilesQuery);
  const qc = useQueryClient();
  const { user } = Route.useRouteContext();
  const { data: roles = [] } = useQuery({ queryKey: ["roles"], queryFn: async () => (await supabase.from("user_roles").select("*")).data ?? [] });
  const { data: comm = [] } = useQuery({ queryKey: ["commissions"], queryFn: async () => (await supabase.from("broker_commissions").select("*")).data ?? [] });

  const totals = loads.reduce((a, l) => { const t = loadTotals(l); return { rev: a.rev + t.revenue, margin: a.margin + t.margin }; }, { rev: 0, margin: 0 });
  const ar = loads.filter((l) => l.status === "invoiced").reduce((s, l) => s + loadTotals(l).revenue, 0);
  const ap = loads.filter((l) => ["delivered", "invoiced"].includes(l.status) && l.pod_received).reduce((s, l) => s + loadTotals(l).cost, 0);

  const setAdmin = useServerFn(setUserAdmin);
  const setRole = async (userId: string, role: "admin" | "broker") => {
    try { await setAdmin({ data: { userId, admin: role === "admin" } }); toast.success("Role updated"); } catch (e) { toast.error((e as Error).message); }
    qc.invalidateQueries({ queryKey: ["roles"] });
  };
  const setComm = async (userId: string, pct: number) => {
    const { error } = await supabase.from("broker_commissions").upsert({ user_id: userId, commission_pct: pct, updated_at: new Date().toISOString() });
    if (error) toast.error(error.message); else toast.success("Commission saved");
    qc.invalidateQueries({ queryKey: ["commissions"] });
  };

  return (
    <div className="space-y-6 p-3 sm:p-6">
      <h1 className="text-3xl font-bold uppercase">Admin</h1>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {[["Gross revenue", totals.rev], ["Gross margin", totals.margin], ["Open AR (invoiced)", ar], ["Carrier AP due", ap]].map(([k, v]) => (
          <div key={k as string} className="rounded border bg-card p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">{k}</div>
            <div className="font-display text-3xl text-gold">{usd(v as number)}</div>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto rounded border bg-card">
        <Table>
          <TableHeader><TableRow><TableHead>Team member</TableHead><TableHead>Role</TableHead><TableHead>Loads</TableHead><TableHead>Margin</TableHead><TableHead>Commission %</TableHead><TableHead>Commission earned</TableHead></TableRow></TableHeader>
          <TableBody>
            {profiles.map((p) => {
              const mine = loads.filter((l) => l.broker_id === p.id);
              const margin = mine.reduce((s, l) => s + loadTotals(l).margin, 0);
              const pct = Number(comm.find((c) => c.user_id === p.id)?.commission_pct ?? 0);
              const role = roles.find((r) => r.user_id === p.id)?.role ?? "broker";
              return (
                <TableRow key={p.id}>
                  <TableCell><div className="font-medium">{p.full_name}</div><div className="text-xs text-muted-foreground">{p.email}</div></TableCell>
                  <TableCell>
                    <Select value={role} onValueChange={(v) => setRole(p.id, v as "admin" | "broker")}>
                      <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="admin">Admin</SelectItem><SelectItem value="broker">Broker</SelectItem></SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>{mine.length}</TableCell>
                  <TableCell>{usd(margin)}</TableCell>
                  <TableCell><Input key={`${p.id}-${pct}`} className="h-8 w-20" type="number" min={0} max={100} defaultValue={pct}
                    onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                    onBlur={(e) => {
                      const next = Number(e.target.value);
                      if (next === pct) return;
                      if (isNaN(next) || next < 0 || next > 100) { toast.error("Enter 0–100"); e.target.value = String(pct); return; }
                      if (!window.confirm(`Change commission for ${p.full_name ?? p.email} from ${pct}% to ${next}%?`)) { e.target.value = String(pct); return; }
                      setComm(p.id, next);
                    }} /></TableCell>
                  <TableCell className="text-gold">{usd((margin * pct) / 100)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <UserManagement profiles={profiles} roles={roles} selfId={user.id} />
      <ItsSync profiles={profiles} />
      <DeletionLog names={Object.fromEntries(profiles.map((p) => [p.id, p.full_name ?? p.email ?? ""]))} />
    </div>
  );
}

const TABLE_LABEL: Record<string, string> = { companies: "Directory", carriers: "Carrier", carrier_documents: "Carrier document", drivers: "Driver", fleet_units: "Fleet unit", leads: "Lead", quotes: "Quote", loads: "Load", load_notes: "Load note", qb_sync: "Accounting entry", load_offers: "Load offer", load_tracking_tokens: "Tracking link" };

function DeletionLog({ names }: { names: Record<string, string> }) {
  const { data = [] } = useQuery({ queryKey: ["deletion_log"], queryFn: async () => (await supabase.from("deletion_log").select("id,table_name,label,deleted_by,deleted_at").order("deleted_at", { ascending: false }).limit(200)).data ?? [] });
  return (
    <div className="rounded border bg-card">
      <h2 className="border-b p-3 font-display text-xl uppercase">Deletion log</h2>
      <div className="max-h-96 overflow-auto">
        <Table>
          <TableHeader><TableRow><TableHead>When</TableHead><TableHead>What</TableHead><TableHead>Name</TableHead><TableHead>By</TableHead></TableRow></TableHeader>
          <TableBody>
            {data.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="text-xs">{new Date(d.deleted_at).toLocaleString()}</TableCell>
                <TableCell>{TABLE_LABEL[d.table_name] ?? d.table_name}</TableCell>
                <TableCell>{d.label}</TableCell>
                <TableCell className="text-muted-foreground">{d.deleted_by ? names[d.deleted_by] ?? "—" : "System"}</TableCell>
              </TableRow>
            ))}
            {!data.length && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Nothing deleted yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
