import Link from "next/link";
import { ChevronRightIcon } from "@/components/ui/Icons";

export function ActionCard({
  href,
  icon,
  title,
  description,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Link href={href} className="panel group flex items-start gap-4 rounded-xl p-5 transition hover:border-border-strong hover:bg-raised">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="mt-0.5 block text-sm text-muted">{description}</span>
      </span>
      <ChevronRightIcon className="mt-1 h-4 w-4 text-subtle transition group-hover:translate-x-0.5 group-hover:text-text" />
    </Link>
  );
}
