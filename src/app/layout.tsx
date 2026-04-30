import type { Metadata } from "next";
import { Montserrat, Geist_Mono } from "next/font/google";
import "./globals.css";

/**
 * Round 7.15: switched primary sans font from Geist to Montserrat.
 *
 * Montserrat is a humanist sans-serif with strong title-case
 * presence and good legibility at small sizes. Used widely by
 * polished SaaS apps for both headings and body text — gives the
 * app a more "designed" feel than the system UI fallback.
 *
 * Weights included (matching the Tailwind classes the app uses):
 *   400 normal     →  default body text
 *   500 medium     →  font-medium (e.g. workspace names, sidebars)
 *   600 semibold   →  font-semibold (most headings, buttons)
 *   700 bold       →  font-bold (rare, strong emphasis)
 *   800 extrabold  →  reserved for future use
 *
 * No italics — the app doesn't currently use italic-styled UI text
 * anywhere. Skipping italics shaves ~75kb off the initial bundle.
 *
 * `display: 'swap'` tells the browser to render fallback text first
 * and swap in Montserrat once it's loaded. Without this, users on
 * slow connections see a blank space while the font downloads
 * (FOIT — flash of invisible text). With swap, they see system
 * font instantly, then the page restyles when Montserrat arrives
 * (FOUT — flash of unstyled text). FOUT is much better UX for
 * content-heavy apps where readability beats pixel-perfect
 * branding on first paint.
 */
const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
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
      className={`${montserrat.variable} ${geistMono.variable} h-full antialiased`}
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
