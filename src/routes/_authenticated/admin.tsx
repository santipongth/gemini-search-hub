import { createFileRoute, redirect, Outlet, Link, useLocation } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Library, BarChart3, Network } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: async ({ location }) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      throw redirect({ to: "/auth", search: { redirect: location.href } });
    }
    // Note: full admin role check happens at the data layer (server functions
    // already enforce admin/owner). Non-admins still see "their" library here.
  },
  component: AdminLayout,
});

function AdminLayout() {
  const loc = useLocation();
  const tabs = [
    { to: "/admin/library", label: "Library", icon: Library },
    { to: "/admin/analytics", label: "Analytics", icon: BarChart3 },
    { to: "/admin/map", label: "Map", icon: Network },
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
