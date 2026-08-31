import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Subtitle QA · VIKO Localize",
  description:
    "한국어 자막의 읽기 속도, 줄 수, 타임코드를 내 기기에서 검사하세요.",
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
