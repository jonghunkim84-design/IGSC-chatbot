import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "IGSC 인증 문의 챗봇",
  description: "국제지속가능인증원 인증 문의 안내",
  robots: { index: false, follow: false }, // iframe 전용 화면이라 검색 노출 제외
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return children;
}
