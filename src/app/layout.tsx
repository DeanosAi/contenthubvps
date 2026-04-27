import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Content Hub",
  description: "Content production workflow",
};

/**
 * Root layout — Round 7.1.5.
 *
 * Three layers of defence so the page can never render dark:
 *   1. globals.css paints html+body slate-100 (#f1f5f9).
 *   2. <body className="bg-slate-100 text-slate-900"> — Tailwind
 *      utilities as second layer.
 *   3. inline style attribute — ABSOLUTE last resort. Inline style
 *      beats every class-based rule. Even if a route layout deeper
 *      in the tree has bg-slate-950, this can't be overridden.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      style={{ backgroundColor: '#f1f5f9', color: '#0f172a' }}
    >
      <body
        className="bg-slate-100 text-slate-900 min-h-full flex flex-col"
        style={{ backgroundColor: '#f1f5f9', color: '#0f172a' }}
      >
        {children}
      </body>
    </html>
  );
}
