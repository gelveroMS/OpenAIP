import type { Metadata } from "next";
import { Arimo, Arsenal_SC, Baskervville_SC, Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import "leaflet/dist/leaflet.css";
import SessionTimeoutGuard from "@/components/security/session-timeout-guard";
import GlobalSystemBanner from "@/components/system/global-system-banner";

const arimo = Arimo({
  variable: "--font-arimo",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const arsenalSc = Arsenal_SC({
  variable: "--font-arsenal-sc",
  subsets: ["latin"],
  weight: ["400", "700"],
});

const baskervvilleSc = Baskervville_SC({
  variable: "--font-baskervville-sc",
  subsets: ["latin"],
  weight: ["400"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "OpenAIP",
  description: "Turn AIP documents into actionable planning data.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${arimo.variable} ${geistMono.variable} ${arsenalSc.variable} ${baskervvilleSc.variable} ${inter.variable} antialiased`}
      >
        <GlobalSystemBanner />
        <SessionTimeoutGuard />
        {children}
      </body>
    </html>
  );
}
