"use client";

import Link from "next/link";
import { siteConfig } from "@/config/site";
import { useAuth } from "@/lib/auth/AuthProvider";
import { Button } from "@/components/ui/Button";
import { Logo } from "@/components/ui/Logo";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

/** Top bar for the public pages. Signed-in pages use the sidebar instead. */
export function Navbar() {
  const { user, loading } = useAuth();
  const signedIn = Boolean(user?.role);

  return (
    <header className="sticky top-0 z-40 px-3 pt-3 sm:px-6 sm:pt-4">
      <div className="glass-bar mx-auto flex w-full max-w-6xl items-center justify-between gap-4 rounded-full border py-2 pr-2 pl-5 shadow-[0_12px_32px_-18px_rgb(90_50_170/0.45)]">
        <Logo />
        <nav className="hidden gap-8 text-sm text-muted md:flex">
          {siteConfig.landingNav.map((item) => (
            <Link key={item.href} href={item.href} className="transition hover:text-text">
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {loading ? null : signedIn ? (
            <Button href="/dashboard">Open dashboard</Button>
          ) : (
            <>
              <Button href="/login" variant="ghost" className="hidden sm:inline-flex">
                Log in
              </Button>
              <Button href="/register">Register</Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
