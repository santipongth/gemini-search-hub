import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { useState } from "react";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { UserMenu } from "@/components/auth/user-menu";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold">Page not found</h2>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Lumen — Multimodal Search" },
      { name: "description", content: "Search across text, images, and audio with Gemini embeddings." },
      { property: "og:title", content: "Lumen — Multimodal Search" },
      { property: "og:description", content: "Search across text, images, and audio with Gemini embeddings." },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function Header() {
  const { isAdmin, user } = useAuth();
  return (
    <header className="border-b border-border/60 bg-background/70 backdrop-blur sticky top-0 z-30">
      <div className="container mx-auto flex h-16 items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-2 group">
          <span className="inline-block h-7 w-7 rounded-md bg-gradient-to-br from-primary to-accent" />
          <span className="font-display text-xl tracking-tight">Lumen</span>
          <span className="text-xs text-muted-foreground hidden sm:inline">multimodal search</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link
            to="/"
            activeOptions={{ exact: true }}
            className="px-3 py-1.5 rounded-md hover:bg-muted [&.active]:bg-muted [&.active]:font-medium"
          >
            Search
          </Link>
          {user && (
            <Link
              to="/admin/library"
              className="px-3 py-1.5 rounded-md hover:bg-muted [&.active]:bg-muted [&.active]:font-medium"
            >
              {isAdmin ? "Admin" : "My library"}
            </Link>
          )}
          <div className="ml-2">
            <UserMenu />
          </div>
        </nav>
      </div>
    </header>
  );
}

function GlobalErrorBridge() {
  // Surface unhandled runtime errors as toasts so users always see *something*
  // when build/import-protection or server functions throw unexpectedly.
  if (typeof window !== "undefined" && !(window as unknown as { __lumenErrBound?: boolean }).__lumenErrBound) {
    (window as unknown as { __lumenErrBound: boolean }).__lumenErrBound = true;
    window.addEventListener(
      "error",
      (ev) => {
        // Resource load failures (img/script/link 404s) dispatch an Event whose
        // target is the failing element, not Window. Ignore those — they're noise.
        if (ev.target && ev.target !== window) return;
        const msg = ev?.error?.message || ev?.message || "";
        if (!msg) return; // Cross-origin "Script error." with no detail — drop.
        if (/hydrat|ResizeObserver|Script error|Loading chunk/i.test(String(msg))) return;
        import("sonner").then(({ toast }) =>
          toast.error("Runtime error", { description: String(msg).slice(0, 240) }),
        );
      },
      true, // capture so we see resource errors and can filter them
    );
    window.addEventListener("unhandledrejection", (ev) => {
      const reason = ev?.reason;
      const msg = reason instanceof Error ? reason.message : String(reason ?? "Unhandled promise rejection");
      if (/AbortError|cancelled/i.test(msg)) return;
      import("sonner").then(({ toast }) => toast.error("Request failed", { description: msg.slice(0, 240) }));
    });
  }
  return null;
}

function RootComponent() {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <AuthProvider>
        <GlobalErrorBridge />
        <div className="min-h-screen bg-background text-foreground flex flex-col">
          <Header />
          <main className="flex-1">
            <Outlet />
          </main>
          <footer className="border-t border-border/60 py-6 text-center text-xs text-muted-foreground">
            Powered by Gemini embeddings · Lovable Cloud
          </footer>
        </div>
        <Toaster richColors closeButton />
      </AuthProvider>
    </QueryClientProvider>
  );
}
