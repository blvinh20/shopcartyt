import type { Metadata } from "next";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import DifyChatWidget from "@/components/DifyChatWidget";
import { ClerkProvider } from "@clerk/nextjs";

export const metadata: Metadata = {
  title: {
    template: "%s - Shopcart online store",
    default: "Shopcart online store",
  },
  description: "Shopcart online store, Your one stop shop for all your needs",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Đọc config Dify widget Ở ĐÂY (server component — layout export `metadata` nên nó là server, KHÔNG
  // phải client) rồi truyền xuống DifyChatWidget dạng prop. VÌ SAO không để chính widget đọc
  // process.env.NEXT_PUBLIC_*: widget là "use client", nên process.env.NEXT_PUBLIC_* trong đó bị
  // Next INLINE lúc `next build` -> đổi token phải REBUILD image + đổi build-arg trong CI. Đọc
  // runtime ở server rồi truyền prop -> token là env RUNTIME thường (khai trong k8s/deployment.yaml),
  // đổi token chỉ cần sửa deployment + restart pod, KHÔNG cần build lại. Token này KHÔNG bí mật (nó
  // nằm công khai trong HTML gửi về browser) nên để env thường, không qua Secret.
  const difyAppToken = process.env.DIFY_APP_TOKEN;
  const difyBaseUrl = process.env.DIFY_WIDGET_BASE_URL;

  return (
    <ClerkProvider>
      <div className="flex flex-col min-h-screen">
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
        {/* Dify RAG chatbot — widget tự trả null nếu chưa có token (xem components/DifyChatWidget.tsx) */}
        <DifyChatWidget token={difyAppToken} baseUrl={difyBaseUrl} />
      </div>
    </ClerkProvider>
  );
}
