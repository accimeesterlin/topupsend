import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/toast-provider";
import { ClientProviders } from "@/components/client-providers";
import { PWAInstaller } from "@/components/pwa-installer";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TopUpSend | Top Up Send Worldwide",
  description:
    "Send mobile top-ups worldwide instantly with TopUpSend. Fast, secure, and reliable prepaid mobile recharge service for your customers.",
  applicationName: "TopUpSend",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "TopUpSend",
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    type: "website",
    siteName: "TopUpSend",
    title: "TopUpSend | Top Up Send Worldwide",
    description:
      "Send mobile top-ups worldwide instantly with TopUpSend. Fast, secure, and reliable prepaid mobile recharge service for your customers.",
  },
  twitter: {
    card: "summary",
    title: "TopUpSend | Top Up Send Worldwide",
    description:
      "Send mobile top-ups worldwide instantly with TopUpSend. Fast, secure, and reliable prepaid mobile recharge service for your customers.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){if(typeof Node!=='undefined'&&Node.prototype&&!Node.prototype.__rcPatched){var origRC=Node.prototype.removeChild;Node.prototype.removeChild=function(child){if(child&&child.parentNode===this){return origRC.call(this,child)}return child};var origIB=Node.prototype.insertBefore;Node.prototype.insertBefore=function(newNode,refNode){if(refNode&&refNode.parentNode!==this){return origRC.call(this,newNode,null)}return origIB.call(this,newNode,refNode)};Node.prototype.__rcPatched=true}})();`,
          }}
        />
        <meta name="theme-color" content="#3b82f6" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes"
        />
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
      </head>
      <body
        translate="no"
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <ClientProviders>{children}</ClientProviders>
        <ToastProvider />
        <PWAInstaller />
      </body>
    </html>
  );
}
