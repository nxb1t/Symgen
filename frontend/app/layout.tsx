import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Navbar } from "@/components/navbar";
import { ThemeProvider } from "@/components/theme-provider";

const inter = Inter({ 
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: {
    default: "Symgen - Volatility3 Linux Symbol Generator",
    template: "%s | Symgen",
  },
  description: "Generate Volatility3 Linux kernel symbols automatically using Docker containers",
  keywords: ["volatility3", "linux", "symbols", "memory forensics", "kernel", "dwarf2json"],
  authors: [{ name: "Symgen" }],
  openGraph: {
    title: "Symgen - Volatility3 Linux Symbol Generator",
    description: "Generate Volatility3 Linux kernel symbols automatically using Docker containers",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#8b5cf6",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="touch-manipulation">
      <body className={`${inter.variable} font-sans antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <Navbar />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
