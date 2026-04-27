import { createFileRoute, redirect, isRedirect, Outlet, Link, useLocation, useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Library, BarChart3, Network, ShieldAlert, RefreshCw, Gauge } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: async ({ location }) => {
    try {
      const { data: { session }, error: sessErr } = await supabase.auth.getSession();
      if (sessErr) throw sessErr;
      if (!session) {
        throw redirect({ to: "/auth", search: { redirect: location.href } });
      }
      const { data: roleRow, error: roleErr } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", session.user.id)
        .eq("role", "admin")
        .maybeSingle();
      if (roleErr) throw roleErr;
      if (!roleRow) {
        toast.error("Admin access required", {
          description: "Your account doesn't have administrator privileges.",
        });
        throw redirect({ to: "/" });
      }
    } catch (e) {
      if (isRedirect(e)) throw e;
      const msg = e instanceof Error ? e.message : "Failed to verify admin access";
      toast.error("Authorization check failed", { description: msg });
      throw new Error(`AdminGuard: ${msg}`);
    }
  },
  errorComponent: AdminErrorComponent,
  component: AdminLayout,
});

function AdminErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  const isAuthError = /AdminGuard|admin|forbidden|unauthor/i.test(error.message);
  return (
    <div className="container mx-auto flex min-h-[60vh] max-w-lg items-center justify-center px-6 py-10">
      <div className="text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
          <ShieldAlert className="h-7 w-7 text-destructive" />
        </div>
        <h1 className="text-xl font-semibold">
          {isAuthError ? "Admin access required" : "Couldn't load admin"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground break-words">{error.message}</p>
        <div className="mt-5 flex items-center justify-center gap-2">
          <button
            onClick={() => { router.invalidate(); reset(); }}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </button>
          <Link to="/" className="rounded-md border border-input px-3 py-2 text-sm hover:bg-accent">
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function AdminLayout() {
  const loc = useLocation();
  const tabs = [
    { to: "/admin/library", label: "Library", icon: Library },
    { to: "/admin/analytics", label: "Analytics", icon: BarChart3 },
    { to: "/admin/map", label: "Map", icon: Network },
    { to: "/admin/vector-metrics", label: "Vector Metrics", icon: Gauge },
  ] as const;
  return (
    <div className="container mx-auto px-6 py-6 max-w-7xl">
      <div className="border-b border-border mb-6">
        <nav className="flex gap-1 -mb-px">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = loc.pathname.startsWith(t.to);
            return (
              <Link
                key={t.to}
                to={t.to}
                className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm border-b-2 transition ${
                  active
                    ? "border-primary text-foreground font-medium"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <Outlet />
    </div>
  );
}
