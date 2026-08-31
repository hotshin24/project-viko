import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "영상과 자막을 위한 도구 · VIKO Localize",
  description:
    "Foreign Video → Natural Korean Subtitle. VIKO의 영상·자막 도구를 둘러보세요.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
