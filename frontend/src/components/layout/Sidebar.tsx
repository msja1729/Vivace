"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { isStaff, type User } from "@/types";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useWorkspace } from "@/lib/workspace";
import { Logo } from "@/components/ui/Logo";
import { Avatar, Badge } from "@/components/ui/Display";
import {
  ChevronLeftIcon,
  ClipboardIcon,
  DoorIcon,
  FolderIcon,
  GridIcon,
  HomeIcon,
  LogoutIcon,
  MicIcon,
  PlusIcon,
  UsersIcon,
} from "@/components/ui/Icons";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  exact?: boolean;
}

/**
 * The left sidebar shown on every signed-in page. Inside a class it shows that class's
 * sections (Team members, Assignments, Vivas, Files); elsewhere the app-level pages.
 * The signed-in user's details sit at the bottom.
 */
export function Sidebar({ user, onNavigate }: { user: User; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { classId, currentClass, myClasses } = useWorkspace();
  const isInstructor = user.role === "instructor";
  const staff = !!currentClass && isStaff(currentClass);

  const base = `/classes/${classId}`;
  const classNav: NavItem[] = [
    { href: base, label: "Overview", icon: <GridIcon />, exact: true },
    ...(staff
      ? [
          { href: `${base}/members`, label: "Team members", icon: <UsersIcon /> },
          { href: `${base}/assignments`, label: "Assignments", icon: <ClipboardIcon /> },
          { href: `${base}/vivas`, label: "Vivas", icon: <MicIcon /> },
          { href: `${base}/files`, label: "Files", icon: <FolderIcon /> },
        ]
      : currentClass
        ? [
            { href: `${base}/files`, label: "Files", icon: <FolderIcon /> },
            { href: `${base}/assignments`, label: "Assignments", icon: <ClipboardIcon /> },
            { href: `${base}/vivas`, label: "Vivas", icon: <MicIcon /> },
          ]
        : []),
  ];

  const appNav: NavItem[] = [
    { href: "/dashboard", label: "Home", icon: <HomeIcon /> },
    ...(isInstructor ? [{ href: "/classes/create", label: "Create class", icon: <PlusIcon /> }] : []),
    { href: "/classes/join", label: "Join class", icon: <DoorIcon /> },
  ];

  const yourClasses = [...(myClasses?.teaching ?? []), ...(myClasses?.assisting ?? []), ...(myClasses?.joined ?? [])];

  return (
    <div className="flex h-full flex-col">
      <div className="px-5 py-5">
        <Logo />
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-4">
        {classId ? (
          <div>
            <Link
              href="/dashboard"
              onClick={onNavigate}
              className="flex items-center gap-1 px-2 text-xs text-subtle transition hover:text-text"
            >
              <ChevronLeftIcon className="h-3.5 w-3.5" /> All classes
            </Link>
            <div className="mt-3 px-2">
              <p className="truncate text-sm font-semibold">{currentClass?.name ?? "…"}</p>
              <p className="truncate text-xs text-muted">
                {currentClass?.subject}
                {currentClass?.myRole === "ta" && <span className="ml-1.5 text-accent">· TA</span>}
              </p>
            </div>
            <NavList items={classNav} pathname={pathname} onNavigate={onNavigate} className="mt-4" />
          </div>
        ) : (
          <>
            <NavList items={appNav} pathname={pathname} onNavigate={onNavigate} />
            {yourClasses.length > 0 && (
              <div>
                <p className="px-2 text-xs font-medium tracking-wide text-subtle uppercase">Your classes</p>
                <ul className="mt-2 space-y-0.5">
                  {yourClasses.map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`/classes/${c.id}`}
                        onClick={onNavigate}
                        className="block truncate rounded-lg px-2 py-1.5 text-sm text-muted transition hover:bg-raised hover:text-text"
                      >
                        {c.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </nav>

      <UserCard user={user} />
    </div>
  );
}

function NavList({
  items,
  pathname,
  onNavigate,
  className = "",
}: {
  items: NavItem[];
  pathname: string;
  onNavigate?: () => void;
  className?: string;
}) {
  return (
    <ul className={`space-y-0.5 ${className}`}>
      {items.map((item) => {
        const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 rounded-lg px-2 py-2 text-sm transition ${
                active ? "bg-raised font-medium text-text" : "text-muted hover:bg-raised/60 hover:text-text"
              }`}
            >
              <span className={active ? "text-accent" : ""}>{item.icon}</span>
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function UserCard({ user }: { user: User }) {
  const { signOut } = useAuth();
  const router = useRouter();
  return (
    <div className="m-3 rounded-xl border border-border bg-raised/50 p-3">
      <div className="flex items-center gap-3">
        <Avatar name={user.name} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="truncate text-xs text-muted">{user.email}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            signOut();
            router.push("/");
          }}
          title="Sign out"
          aria-label="Sign out"
          className="rounded-md p-1.5 text-subtle transition hover:bg-raised hover:text-text"
        >
          <LogoutIcon />
        </button>
      </div>
      <div className="mt-2">
        <Badge tone={user.role === "instructor" ? "accent" : "neutral"}>
          <span className="capitalize">{user.role}</span>
        </Badge>
      </div>
    </div>
  );
}
