import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BIZOACH Advisor — AI Entrepreneurship Coach",
  description: "Your AI business growth partner. Strategy, marketing, sales and execution — from idea to scalable business.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
