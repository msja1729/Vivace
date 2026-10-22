import Link from "next/link";
import { siteConfig } from "@/config/site";

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 text-base font-bold tracking-tight">
      <span className="brand-gradient grid h-8 w-8 place-items-center rounded-xl text-sm font-bold text-white shadow-[0_8px_18px_-8px_rgb(178_76_242/0.8)]">
        V
      </span>
      {siteConfig.name}
    </Link>
  );
}
