import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Santé — Voice Health Analysis",
  description:
    "AI-powered voice analysis to detect speech patterns linked to neurological health, cardiovascular wellness, and emotional wellbeing.",
  icons: {
    icon: [{ url: "/icon.svg?v=20260215b", type: "image/svg+xml" }],
    shortcut: [{ url: "/icon.svg?v=20260215b", type: "image/svg+xml" }],
  },
  openGraph: {
    title: "Santé — Voice Health Analysis",
    description:
      "AI-powered voice analysis to detect speech patterns linked to neurological health, cardiovascular wellness, and emotional wellbeing.",
    images: [
      {
        url: "/logo.svg?v=20260215",
        width: 1200,
        height: 400,
        alt: "Santé",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Santé — Voice Health Analysis",
    description:
      "AI-powered voice analysis to detect speech patterns linked to neurological health, cardiovascular wellness, and emotional wellbeing.",
    images: ["/logo.svg?v=20260215"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} antialiased`}>{children}</body>
    </html>
  );
}
