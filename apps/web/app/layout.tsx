import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Speech to Text",
  description: "Multilingual real-time transcription",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
