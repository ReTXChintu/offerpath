import { Button, EmptyState } from '@offerpath/ui';

/** Shown when the UI is opened in a browser tab instead of the desktop app. */
export function NotInTauri() {
  return (
    <div className="col items-center justify-center g3" style={{ height: '100vh', padding: 24 }}>
      <EmptyState
        icon="monitor"
        title="Offerpath runs as a desktop app"
        description="This page is served by the Vite dev server outside Tauri, so the desktop's Rust side is not available. Start the desktop app instead: pnpm dev:desktop"
        action={
          <Button variant="secondary" onClick={() => window.location.reload()}>
            Reload
          </Button>
        }
      />
    </div>
  );
}
