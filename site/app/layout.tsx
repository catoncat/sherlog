import type { Metadata } from "next";
import { IBM_Plex_Mono, Literata } from "next/font/google";
import "./globals.css";

const literata = Literata({
  variable: "--font-sans-custom",
  subsets: ["latin"],
  weight: ["500", "700", "900"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-mono-custom",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "CXS - Search your Codex sessions locally",
  description:
    "Install CXS and turn local Codex session logs into searchable working memory.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${literata.variable} ${plexMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
