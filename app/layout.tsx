import type { Metadata, Viewport } from "next";
import { Inter, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { cn } from "@/lib/utils";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "Idesify Lens — Auditor de políticas de privacidad",
  description:
    "Audita políticas de privacidad según la Ley chilena 21.719, GDPR y CCPA, con citas textuales y borradores de solicitudes ARCO.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={cn(
        inter.variable,
        instrumentSerif.variable,
        jetbrainsMono.variable,
      )}
      suppressHydrationWarning
    >
      <body className="antialiased">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
          <main>{children}</main>
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
