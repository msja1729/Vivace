import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import { siteConfig } from "@/config/site";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { themeInitScript } from "@/lib/theme";
import "./globals.css";

const poppins = Poppins({ variable: "--font-poppins", subsets: ["latin"], weight: ["300", "400", "500", "600", "700"] });

export const metadata: Metadata = {
  title: siteConfig.name,
  description: siteConfig.tagline,
};

// Public pages live in (public)/ with a top navbar; signed-in pages in (app)/ with the sidebar.
// data-theme is set by the inline script before paint, so React must not warn that it differs.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${poppins.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
