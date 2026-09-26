import type { Metadata } from "next";
import { DM_Mono, Schibsted_Grotesk, Young_Serif } from "next/font/google";
import "./globals.css";

const display = Young_Serif({ weight: "400", subsets: ["latin"], variable: "--font-young-serif" });
const sans = Schibsted_Grotesk({ subsets: ["latin"], variable: "--font-schibsted" });
const mono = DM_Mono({ weight: ["400", "500"], subsets: ["latin"], variable: "--font-dm-mono" });

export const metadata: Metadata = {
  title: "Roominate — Make room for better choices",
  description: "A shared 3D room planner and better cart for real student spaces.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
