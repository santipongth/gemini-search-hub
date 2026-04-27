// Dev-only: force a hard reload when Vite reports an HMR error or after the
// dev server reconnects. This avoids the "stale JSX parse error" state where
// the preview keeps showing an old syntax error even though the file on disk
// is already fixed.
//
// Behavior:
//  - On Vite `vite:error` events, schedule a hard reload (debounced).
//  - When HMR reconnects after a disconnect, also hard-reload — the in-memory
//    module graph is often inconsistent at that point.
//  - Production builds: this file becomes a no-op (import.meta.hot is undefined).

if (import.meta.hot) {
  let reloadTimer: ReturnType<typeof setTimeout> | null = null;
  let wasDisconnected = false;

  const hardReload = (reason: string) => {
    if (reloadTimer) return;
    // Small debounce so multiple rapid events collapse into one reload.
    reloadTimer = setTimeout(() => {
      // eslint-disable-next-line no-console
      console.info(`[dev-force-reload] ${reason} — performing hard reload`);
      window.location.reload();
    }, 300);
  };

  import.meta.hot.on("vite:error", (payload: unknown) => {
    const err = (payload as { err?: { message?: string } } | undefined)?.err;
    const msg = err?.message ?? "unknown error";
    // Only force-reload on syntax/parse errors — runtime errors are handled by
    // the regular Vite overlay and don't leave the module graph stale.
    if (
      /Adjacent JSX|Unexpected token|Unterminated|Expected|SyntaxError|Failed to parse/i.test(
        msg,
      )
    ) {
      hardReload(`HMR syntax error: ${msg}`);
    }
  });

  import.meta.hot.on("vite:ws:disconnect", () => {
    wasDisconnected = true;
  });

  import.meta.hot.on("vite:ws:connect", () => {
    if (wasDisconnected) {
      wasDisconnected = false;
      hardReload("HMR reconnected after disconnect");
    }
  });
}

export {};
