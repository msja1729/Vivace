"use client";

import { useState } from "react";
import { WorkspaceProvider } from "@/lib/workspace";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { Logo } from "@/components/ui/Logo";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { MenuIcon, XIcon } from "@/components/ui/Icons";
import { Sidebar } from "./Sidebar";

/**
 * Signed-in frame. Large screens: one floating glass window (as in UI.png) holding the sidebar
 * and the page. Small screens: a glass top bar and a slide-in drawer.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <RequireAuth>
      {(user) => (
        <WorkspaceProvider>
          <div className="lg:p-5">
            <div className="lg:glass-window lg:flex lg:min-h-[calc(100vh-2.5rem)] lg:rounded-[28px]">
              <aside className="sticky top-5 z-30 hidden h-[calc(100vh-2.5rem)] w-64 shrink-0 rounded-l-[28px] border-r border-white/50 lg:block dark:border-white/10">
                <Sidebar user={user} />
              </aside>

          {/* Small screens: top bar + drawer */}
          <div className="sticky top-0 z-30 flex items-center justify-between glass-bar border-b px-4 py-3 lg:hidden">
            <Logo />
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <button
                type="button"
                onClick={() => setOpen(true)}
                aria-label="Open menu"
                className="rounded-md p-1.5 text-muted hover:bg-raised hover:text-text"
              >
                <MenuIcon />
              </button>
            </div>
          </div>
          {open && (
            <div className="fixed inset-0 z-40 lg:hidden">
              <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
              <aside className="glass-bar absolute inset-y-0 left-0 w-72 border-r">
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

              <main className="min-w-0 flex-1">
                <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-8 sm:py-10">{children}</div>
              </main>
            </div>
          </div>
        </WorkspaceProvider>
      )}
    </RequireAuth>
  );
}
