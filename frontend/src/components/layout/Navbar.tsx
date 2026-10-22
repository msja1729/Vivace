"use client";

import Link from "next/link";
import { siteConfig } from "@/config/site";
import { useAuth } from "@/lib/auth/AuthProvider";
import { Button } from "@/components/ui/Button";
import { Logo } from "@/components/ui/Logo";

/** Top bar for the public pages. Signed-in pages use the sidebar instead. */
export function Navbar() {
  const { user } = useAuth();
  const signedIn = Boolean(user?.role);

  return (
    <header className="sticky top-0 z-40 glass-bar border-b border-border">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-8">
        <Logo />
        <nav className="hidden gap-8 text-sm text-muted md:flex">
          {siteConfig.landingNav.map((item) => (
            <Link key={item.href} href={item.href} className="transition hover:text-text">
              {item.label}
            </Link>
          ))}
        </nav>
        {signedIn ? <Button href="/dashboard">Open dashboard</Button> : <Button href="/register">Register</Button>}
      </div>
    </header>
  );
}
