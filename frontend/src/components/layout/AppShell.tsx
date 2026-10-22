"use client";

import { useState } from "react";
import { WorkspaceProvider } from "@/lib/workspace";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { Logo } from "@/components/ui/Logo";
import { MenuIcon, XIcon } from "@/components/ui/Icons";
import { Sidebar } from "./Sidebar";

/** Signed-in frame: fixed sidebar on large screens, a slide-in drawer on small ones. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <RequireAuth>
      {(user) => (
        <WorkspaceProvider>
          <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 glass-bar border-r border-border lg:block">
            <Sidebar user={user} />
          </aside>

          {/* Small screens: top bar + drawer */}
          <div className="sticky top-0 z-30 flex items-center justify-between glass-bar border-b border-border px-4 py-3 lg:hidden">
            <Logo />
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label="Open menu"
              className="rounded-md p-1.5 text-muted hover:bg-raised hover:text-text"
            >
              <MenuIcon />
            </button>
          </div>
          {open && (
            <div className="fixed inset-0 z-40 lg:hidden">
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
              <aside className="absolute inset-y-0 left-0 w-72 border-r border-border bg-panel">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close menu"
                  className="absolute top-4 right-3 rounded-md p-1.5 text-muted hover:bg-raised hover:text-text"
                >
                  <XIcon />
                </button>
                <Sidebar user={user} onNavigate={() => setOpen(false)} />
              </aside>
            </div>
          )}

          <main className="lg:pl-64">
            <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-8 sm:py-10">{children}</div>
          </main>
        </WorkspaceProvider>
      )}
    </RequireAuth>
  );
}
