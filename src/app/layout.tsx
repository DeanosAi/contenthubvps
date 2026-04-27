import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { THEME_BOOTSTRAP_SCRIPT } from '@/lib/theme'
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`theme-light ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script
          dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }}
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
