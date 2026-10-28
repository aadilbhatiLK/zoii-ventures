import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { appConfig } from "@/lib/config/env";
import { Providers } from "@/components/providers";
import { themeInitScript } from "@/components/theme";
import { ConfigError } from "@/components/feedback/config-error";
import { ServiceWorkerRegistrar } from "@/components/pwa";

const inter = localFont({
  src: [
    { path: "../fonts/Inter-Regular.woff2", weight: "400", style: "normal" },
    { path: "../fonts/Inter-Medium.woff2", weight: "500", style: "normal" },
    { path: "../fonts/Inter-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "../fonts/Inter-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-inter",
  display: "swap",
});

const interDisplay = localFont({
  src: [
    { path: "../fonts/InterDisplay-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "../fonts/InterDisplay-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-inter-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Zoii Business OS", template: "%s · Zoii Business OS" },
  description: "Sales, clients, delivery and finance for Zoii Ventures in one operating system.",
  applicationName: "Zoii Business OS",
  appleWebApp: { capable: true, title: "Zoii OS", statusBarStyle: "default" },
  robots: { index: false, follow: false },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f8fb" },
    { media: "(prefers-color-scheme: dark)", color: "#14141c" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en-IN"
      suppressHydrationWarning
      className={`${inter.variable} ${interDisplay.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full">
        {appConfig.ok ? (
          <Providers>
            {children}
            <ServiceWorkerRegistrar />
          </Providers>
        ) : (
          <ConfigError message={appConfig.error} />
        )}
      </body>
    </html>
  );
}
