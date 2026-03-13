import "leaflet/dist/leaflet.css";

import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "GPX Runner - Visualize Your Runs",
  description: "Upload GPX files and visualize your running routes with heatmaps",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <script src="https://cdn.tailwindcss.com"></script>
        <script dangerouslySetInnerHTML={{
          __html: `
            tailwind.config = {
              theme: {
                extend: {
                  colors: {
                    cyan: { 400: '#22d3ee', 500: '#06b6d4', 600: '#0891b2' },
                    pink: { 400: '#f472b6', 500: '#ec4899', 600: '#db2777' },
                    violet: { 400: '#a78bfa', 500: '#8b5cf6' },
                    amber: { 400: '#fbbf24', 500: '#f59e0b' },
                    zinc: { 400: '#a1a1aa', 500: '#71717a', 600: '#52525b', 700: '#3f3f46', 800: '#27272a', 900: '#18181b' },
                  }
                }
              }
            }
          `
        }} />
      </head>
      <body className={inter.className}>{children}</body>
    </html>
  );
}