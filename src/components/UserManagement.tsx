import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Eye, EyeOff, KeyRound, Trash2, UserPlus } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { approveUser, createUser, deleteUser, resetUserPassword, revokeApproval, setUserAdmin } from "@/lib/users.functions";
import { DEFAULT_PERMS, PERMISSIONS, type Profile } from "@/lib/tms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function UserManagement({ profiles, roles, selfId }: { profiles: Profile[]; roles: { user_id: string; role: string }[]; selfId: string }) {
  const qc = useQueryClient();
  const del = useServerFn(deleteUser);
  const reset = useServerFn(resetUserPassword);
  const revoke = useServerFn(revokeApproval);
  const setAdmin = useServerFn(setUserAdmin);
  const [pwFor, setPwFor] = useState<Profile | null>(null);
  const flipAdmin = async (p: Profile, on: boolean) => {
    if (!confirm(on ? `Give ${p.email} full admin access?` : `Turn off admin access for ${p.email}? They become a Broker.`)) return;
    try { await setAdmin({ data: { userId: p.id, admin: on } }); toast.success(on ? "Admin access on" : "Admin access off"); qc.invalidateQueries(); } catch (e) { toast.error((e as Error).message); }
  };
  const { data: perms = [] } = useQuery({ queryKey: ["user_permissions"], queryFn: async () => (await supabase.from("user_permissions").select("*")).data ?? [] });
  const { data: approvals = [] } = useQuery({ queryKey: ["approved_users"], queryFn: async () => (await supabase.from("approved_users").select("*").order("created_at")).data ?? [] });
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
  const revokeAccess = async (a: (typeof approvals)[number]) => {
    if (!confirm(`Revoke access for ${a.email}?`)) return;
    try { await revoke({ data: { id: a.id, userId: a.user_id } }); toast.success("Access revoked"); qc.invalidateQueries(); } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="rounded border bg-card p-4">
      <SetPassword user={pwFor} onClose={() => setPwFor(null)} run={(pw) => reset({ data: { userId: pwFor!.id, password: pw } })} />
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-display text-xl font-bold uppercase tracking-wider text-gold">Users & permissions</h2>
        <div className="flex flex-wrap gap-2"><ApproveUser onDone={() => qc.invalidateQueries()} /><AddUser onDone={() => qc.invalidateQueries()} /></div>
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
                  <td><label className="flex items-center gap-2 text-xs"><Switch checked={admin} disabled={p.id === selfId} onCheckedChange={(v) => flipAdmin(p, v)} aria-label="Admin access" />{admin ? "Admin" : "Broker"}</label></td>
                  {PERMISSIONS.map((k) => (
                    <td key={k.key} className="text-center">
                      <input type="checkbox" disabled={admin} checked={admin || mine.includes(k.key)} onChange={() => toggle(p.id, k.key)} />
                    </td>
                  ))}
                  <td className="whitespace-nowrap text-right">
                    <Button size="sm" variant="ghost" onClick={() => setPwFor(p)} aria-label="Set password"><KeyRound className="h-4 w-4" /></Button>
                    {p.id !== selfId && <Button size="sm" variant="ghost" onClick={() => remove(p)} aria-label="Delete user"><Trash2 className="h-4 w-4 text-destructive" /></Button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-5 border-t pt-4">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider">Approved Google access</h3>
        <div className="space-y-2">
          {approvals.map((a) => <div key={a.id} className="flex flex-wrap items-center gap-2 rounded border p-2 text-sm"><div className="min-w-0 flex-1"><div className="truncate">{a.full_name || a.email}</div><div className="truncate text-xs text-muted-foreground">{a.email} · {a.role} · {a.user_id ? "joined" : "waiting for first sign-in"}</div></div>{a.user_id !== selfId && <Button size="sm" variant="outline" onClick={() => revokeAccess(a)}>Revoke</Button>}</div>)}
        </div>
      </div>
    </div>
  );
}

function ApproveUser({ onDone }: { onDone: () => void }) {
  const approve = useServerFn(approveUser);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ full_name: "", email: "", role: "broker" as "admin" | "broker" });
  const [perms, setPerms] = useState<string[]>(DEFAULT_PERMS);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await approve({ data: { ...f, perms } }); toast.success(`${f.email} approved for sign-in`); setOpen(false); setF({ full_name: "", email: "", role: "broker" }); onDone(); }
    catch (e) { toast.error((e as Error).message); }
    setBusy(false);
  };
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button size="sm" variant="outline"><UserPlus className="mr-1 h-4 w-4" />Approve Google user</Button></DialogTrigger>
    <DialogContent><DialogHeader><DialogTitle>Approve Google access</DialogTitle></DialogHeader><div className="space-y-3">
      <Input placeholder="Full name" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} />
      <Input placeholder="Google email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as "admin" | "broker" })} className="h-11 w-full rounded border bg-background px-2 text-sm"><option value="broker">Broker</option><option value="admin">Admin</option></select>
      {f.role === "broker" && <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{PERMISSIONS.map((p) => <label key={p.key} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={perms.includes(p.key)} onChange={() => setPerms((s) => s.includes(p.key) ? s.filter((k) => k !== p.key) : [...s, p.key])} />{p.label}</label>)}</div>}
      <Button className="w-full" disabled={busy || !f.email} onClick={save}>{busy ? "Approving…" : "Approve access"}</Button>
    </div></DialogContent>
  </Dialog>;
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
            <div className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
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

function SetPassword({ user, onClose, run }: { user: Profile | null; onClose: () => void; run: (pw: string) => Promise<unknown> }) {
  const [pw, setPw] = useState(""); const [pw2, setPw2] = useState(""); const [show, setShow] = useState(false); const [busy, setBusy] = useState(false);
  const close = () => { setPw(""); setPw2(""); onClose(); };
  const save = async () => {
    if (pw.length < 8) return toast.error("Use at least 8 characters.");
    if (pw !== pw2) return toast.error("The two passwords don't match.");
    setBusy(true);
    try { await run(pw); toast.success(`Password set and tested — ${user?.email} can sign in now`); close(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Set password</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">{user?.email} — works alongside Google sign-in.</p>
        <div className="relative"><Input type={show ? "text" : "password"} placeholder="New password (8+ characters)" value={pw} onChange={(e) => setPw(e.target.value)} />
          <button type="button" className="absolute right-2 top-2.5 text-muted-foreground" onClick={() => setShow(!show)} aria-label="Show password">{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div>
        <Input type={show ? "text" : "password"} placeholder="Type it again" value={pw2} onChange={(e) => setPw2(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
        <Button disabled={busy} onClick={save}>{busy ? "Saving and testing…" : "Save password"}</Button>
      </DialogContent>
    </Dialog>
  );
}
