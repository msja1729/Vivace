import { siteConfig } from "@/config/site";

export function Footer() {
  return (
    <footer className="border-t border-white/50 dark:border-white/10">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-4 py-6 text-xs text-subtle sm:flex-row sm:px-8">
        <span className="font-semibold text-muted">{siteConfig.name}</span>
        <span>{siteConfig.tagline}</span>
      </div>
    </footer>
  );
}
