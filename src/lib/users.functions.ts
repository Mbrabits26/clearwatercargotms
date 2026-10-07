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
    const { error } = await admin.auth.admin.updateUserById(data.userId, { password: data.password });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
