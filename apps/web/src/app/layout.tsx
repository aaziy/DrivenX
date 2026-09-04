import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "DrivenX",
  description: "Vehicle rental and lease-to-own management",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
