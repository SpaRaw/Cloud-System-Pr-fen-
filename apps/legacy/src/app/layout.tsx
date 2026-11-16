import type { Metadata } from "next";
import { Raleway, Roboto } from "next/font/google";
import { SiteHeader } from "@kw/ui/components/kw/site-header";
import "./globals.css";

const raleway = Raleway({ subsets: ["latin"], variable: "--font-raleway" });
const roboto = Roboto({ subsets: ["latin"], variable: "--font-roboto", weight: ["500", "700"] });

export const metadata: Metadata = { title: "KlangWerk Tickets (Altsystem)" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" className={`${raleway.variable} ${roboto.variable}`}>
      <body>
        <SiteHeader variante="Altsystem" />
        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
