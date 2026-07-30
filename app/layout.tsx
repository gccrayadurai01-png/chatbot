import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CLOUDSUFI — Chat Assistant",
  description: "Data engineering and AI/analytics consulting. Talk to our sales assistant.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
