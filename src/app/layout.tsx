import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Roominate — Make room for better choices",
  description: "A shared 3D room planner and better cart for real student spaces.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

