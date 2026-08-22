import type { Metadata } from "next";
import { Toaster } from "sonner";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ClearHire — AI Recruitment Assistant", template: "%s · ClearHire" },
  description:
    "Screen every CV fairly, schedule interviews in minutes, and never leave a candidate hanging.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <Toaster richColors position="top-right" closeButton />
      </body>
    </html>
  );
}
