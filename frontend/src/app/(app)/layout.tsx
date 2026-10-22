import { Suspense } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Loading } from "@/components/ui/Display";

// Signed-in pages: common sidebar on the left, page content on the right.
// Suspense is needed because the shell reads URL params (see Cache Components).

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<Loading />}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}
