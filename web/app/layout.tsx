import { AuthProvider } from "@/contexts/AuthContext";
import { ChatSessionProvider } from "@/contexts/ChatSessionContext";
import { ClaudeCodeSessionProvider } from "@/contexts/ClaudeCodeSessionContext";
import { PrefsProvider } from "@/contexts/PrefsContext";
import type { Metadata } from "next";
import AppShell from "./components/AppShell";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Boni · 波尼",
    template: "%s · Boni",
  },
  description:
    "AI-powered workspace for content creation · AI 驱动的内容创作与工作台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" translate="no" suppressHydrationWarning>
      <body className="antialiased" suppressHydrationWarning>
        <AuthProvider>
          <PrefsProvider>
            <ChatSessionProvider>
              <ClaudeCodeSessionProvider>
                <AppShell>{children}</AppShell>
              </ClaudeCodeSessionProvider>
            </ChatSessionProvider>
          </PrefsProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
