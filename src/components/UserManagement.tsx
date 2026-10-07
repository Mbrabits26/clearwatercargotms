import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { KeyRound, Trash2, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { createUser, deleteUser, resetUserPassword } from "@/lib/users.functions";
import { DEFAULT_PERMS, PERMISSIONS, type Profile } from "@/lib/tms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function UserManagement({ profiles, roles, selfId }: { profiles: Profile[]; roles: { user_id: string; role: string }[]; selfId: string }) {
  const qc = useQueryClient();
  const del = useServerFn(deleteUser);
  const reset = useServerFn(resetUserPassword);
  const { data: perms = [] } = useQuery({ queryKey: ["user_permissions"], queryFn: async () => (await supabase.from("user_permissions").select("*")).data ?? [] });
  const permsOf = (id: string) => perms.find((p) => p.user_id === id)?.perms ?? DEFAULT_PERMS;

  const toggle = async (id: string, key: string) => {
    const cur = permsOf(id);
    const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
    const { error } = await supabase.from("user_permissions").upsert({ user_id: id, perms: next, updated_at: new Date().toISOString() });
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["user_permissions"] });
  };
  const remove = async (p: Profile) => {
    if (!confirm(`Delete ${p.email}? They lose access immediately. Their loads become unassigned.`)) return;
    try { await del({ data: { userId: p.id } }); toast.success("User deleted"); qc.invalidateQueries(); } catch (e) { toast.error((e as Error).message); }
  };
  const resetPw = async (p: Profile) => {
    const pw = prompt(`New temporary password for ${p.email} (8+ characters):`);
    if (!pw) return;
    try { await reset({ data: { userId: p.id, password: pw } }); toast.success("Password changed — share it with them securely"); } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="rounded border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-xl font-bold uppercase tracking-wider text-gold">Users & permissions</h2>
        <AddUser onDone={() => qc.invalidateQueries()} />
      </div>
      <p className="mb-2 text-xs text-muted-foreground">Admins always see everything. For brokers, unchecked areas are hidden from their menu. Brokers still only see their own loads and pay.</p>
      <div className="overflow-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted-foreground">
            <tr><th className="py-1">User</th><th>Role</th>{PERMISSIONS.map((p) => <th key={p.key} className="px-1 text-center">{p.label}</th>)}<th /></tr>
          </thead>
          <tbody>
            {profiles.map((p) => {
              const admin = roles.some((r) => r.user_id === p.id && r.role === "admin");
              const mine = permsOf(p.id);
              return (
                <tr key={p.id} className="border-t">
                  <td className="py-1"><div>{p.full_name}</div><div className="text-xs text-muted-foreground">{p.email}</div></td>
                  <td>{admin ? "Admin" : "Broker"}</td>
                  {PERMISSIONS.map((k) => (
                    <td key={k.key} className="text-center">
                      <input type="checkbox" disabled={admin} checked={admin || mine.includes(k.key)} onChange={() => toggle(p.id, k.key)} />
                    </td>
                  ))}
                  <td className="whitespace-nowrap text-right">
                    <Button size="sm" variant="ghost" onClick={() => resetPw(p)} aria-label="Reset password"><KeyRound className="h-4 w-4" /></Button>
                    {p.id !== selfId && <Button size="sm" variant="ghost" onClick={() => remove(p)} aria-label="Delete user"><Trash2 className="h-4 w-4 text-destructive" /></Button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AddUser({ onDone }: { onDone: () => void }) {
  const create = useServerFn(createUser);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ full_name: "", email: "", password: "", role: "broker" as "admin" | "broker" });
  const [perms, setPerms] = useState<string[]>(DEFAULT_PERMS);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await create({ data: { ...f, perms } });
      toast.success(`${f.email} added — share their temporary password securely`);
      setOpen(false); setF({ full_name: "", email: "", password: "", role: "broker" }); onDone();
    } catch (e) { toast.error((e as Error).message); }
    setBusy(false);
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><UserPlus className="mr-1 h-4 w-4" />Add user</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add user</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <Input placeholder="Full name" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} />
          <Input placeholder="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <Input placeholder="Temporary password (8+ characters)" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as "admin" | "broker" })} className="h-9 w-full rounded border bg-background px-2 text-sm">
            <option value="broker">Broker</option><option value="admin">Admin (full access)</option>
          </select>
          {f.role === "broker" && (
            <div className="grid grid-cols-2 gap-1 text-sm">
              {PERMISSIONS.map((p) => (
                <label key={p.key} className="flex items-center gap-2">
                  <input type="checkbox" checked={perms.includes(p.key)} onChange={() => setPerms((s) => (s.includes(p.key) ? s.filter((k) => k !== p.key) : [...s, p.key]))} />
                  {p.label}
                </label>
              ))}
            </div>
          )}
          <Button className="w-full" disabled={busy} onClick={save}>{busy ? "Adding…" : "Add user"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
