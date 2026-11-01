import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { getCompany } from "@/lib/queries";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Delta — competitive intelligence analyst",
  description: "Delta continuously researches competitors, builds an understanding of their strategies, and develops actionable insights for your company.",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const company = getCompany();
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-screen">
        <header className="border-b border-line">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
            <Link href="/" className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rotate-45 bg-accent" aria-hidden />
              <span className="text-base font-semibold tracking-tight">Delta</span>
              <span className="hidden text-sm text-muted sm:inline">· competitive intelligence analyst</span>
            </Link>
            <nav className="flex items-center gap-4 text-sm text-muted">
              {company && (
                <span>
                  for <span className="text-fg">{company.name}</span>
                </span>
              )}
              <Link href="/settings" className="hover:text-fg">
                Settings
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-5 py-6">{children}</main>
        <footer className="mx-auto max-w-6xl px-5 py-8 text-xs text-muted">Powered by StepFun step-3.7-flash (extraction) and step-5-preview (synthesis).</footer>
      </body>
    </html>
  );
}
