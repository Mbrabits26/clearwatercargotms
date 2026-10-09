import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function requireAdmin(ctx: { supabase: any; userId: string }) {
  const { data } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  if (!data) throw new Error("Only admins can manage users.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export const createUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      email: z.string().trim().email().max(200),
      full_name: z.string().trim().min(1).max(120),
      password: z.string().min(8).max(72),
      role: z.enum(["admin", "broker"]),
      perms: z.array(z.string().max(30)).max(20),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const admin = await requireAdmin(context);
    const normalizedEmail = data.email.toLowerCase();
    const { error: approvalError } = await admin.from("approved_users").upsert({
      email: normalizedEmail,
      full_name: data.full_name,
      role: data.role,
      perms: data.perms,
      approved_by: context.userId,
    }, { onConflict: "email" });
    if (approvalError) throw new Error(approvalError.message);
    const { data: created, error } = await admin.auth.admin.createUser({
      email: normalizedEmail, password: data.password, email_confirm: true, user_metadata: { full_name: data.full_name },
    });
    if (error || !created.user) throw new Error(error?.message ?? "Couldn't create user");
    const id = created.user.id;
    // handle_new_user trigger already created a profile + broker role
    await admin.from("user_roles").delete().eq("user_id", id);
    await admin.from("user_roles").insert({ user_id: id, role: data.role });
    await admin.from("user_permissions").upsert({ user_id: id, perms: data.perms });
    return { id };
  });

export const approveUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    email: z.string().trim().email().max(200),
    full_name: z.string().trim().max(120).optional(),
    role: z.enum(["admin", "broker"]),
    perms: z.array(z.string().max(30)).max(20),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const admin = await requireAdmin(context);
    const { error } = await admin.from("approved_users").upsert({
      email: data.email.toLowerCase(), full_name: data.full_name || null, role: data.role,
      perms: data.perms, approved_by: context.userId,
    }, { onConflict: "email" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const revokeApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), userId: z.string().uuid().nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    if (data.userId === context.userId) throw new Error("You can't revoke your own access.");
    const admin = await requireAdmin(context);
    const { error } = await admin.from("approved_users").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    if (data.userId === context.userId) throw new Error("You can't delete your own account.");
    const admin = await requireAdmin(context);
    await admin.from("loads").update({ broker_id: null }).eq("broker_id", data.userId);
    await admin.from("user_roles").delete().eq("user_id", data.userId);
    await admin.from("user_permissions").delete().eq("user_id", data.userId);
    await admin.from("broker_commissions").delete().eq("user_id", data.userId);
    await admin.from("approved_users").delete().eq("user_id", data.userId);
    await admin.from("profiles").delete().eq("id", data.userId);
    const { error } = await admin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const resetUserPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ userId: z.string().uuid(), password: z.string().min(8).max(72) }).parse(d))
  .handler(async ({ data, context }) => {
    const admin = await requireAdmin(context);
    const { data: u, error } = await admin.auth.admin.updateUserById(data.userId, { password: data.password, email_confirm: true });
    if (error) throw new Error(error.message);
    const email = u.user?.email;
    if (!email) throw new Error("This user has no email address.");
    // Prove the new password signs in, using a throwaway client that never persists the session.
    const { createClient } = await import("@supabase/supabase-js");
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
    const test = createClient(process.env["SUPABASE_URL"]!, key, {
      auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
      global: { fetch: (input, init) => { const h = new Headers(init?.headers); if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization"); h.set("apikey", key); return fetch(input, { ...init, headers: h }); } },
    });
    const { data: s, error: signErr } = await test.auth.signInWithPassword({ email, password: data.password });
    if (signErr) throw new Error(`Password saved, but test sign-in failed: ${signErr.message}`);
    if (s.session) await test.auth.signOut().catch(() => {});
    return { ok: true, email };
  });

export const setUserAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ userId: z.string().uuid(), admin: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    if (data.userId === context.userId && !data.admin) throw new Error("You can't turn off your own admin access.");
    const admin = await requireAdmin(context);
    if (!data.admin) {
      const { data: admins } = await admin.from("user_roles").select("user_id").eq("role", "admin");
      if ((admins ?? []).filter((a) => a.user_id !== data.userId).length === 0) throw new Error("There must always be at least one admin.");
    }
    const role = data.admin ? "admin" : "broker";
    await admin.from("user_roles").delete().eq("user_id", data.userId);
    const { error } = await admin.from("user_roles").insert({ user_id: data.userId, role });
    if (error) throw new Error(error.message);
    await admin.from("approved_users").update({ role }).eq("user_id", data.userId);
    return { ok: true };
  });
