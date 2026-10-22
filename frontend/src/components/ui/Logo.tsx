import Link from "next/link";
import { siteConfig } from "@/config/site";

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 text-base font-bold tracking-tight">
      <span className="grid h-7 w-7 place-items-center rounded-lg bg-text text-xs font-black text-bg">V</span>
      {siteConfig.name}
    </Link>
  );
}
