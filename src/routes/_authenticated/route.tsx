import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { DEFAULT_PERMS } from "@/lib/tms";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth", search: { access: undefined } });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", data.user.id);
    if (!roles?.length) {
      await supabase.auth.signOut();
      throw redirect({ to: "/auth", search: { access: "pending" } });
    }
    const isAdmin = !!roles?.some((r) => r.role === "admin");
    const { data: pr } = await supabase.from("user_permissions").select("perms").eq("user_id", data.user.id).maybeSingle();
    const perms: string[] = isAdmin ? DEFAULT_PERMS : pr?.perms ?? DEFAULT_PERMS;
    return { user: data.user, isAdmin, perms };
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
