import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Urdu S2S — Pipeline Monitor",
  description: "Live run status, queue depth, and fleet view for the Urdu S2S data pipeline.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
