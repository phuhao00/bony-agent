import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "餐费票据",
  description: "餐费截图上传与个人记录",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function MealUploadLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
