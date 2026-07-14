"use client";

// Chèn Dify Chat Bubble Widget vào trang khách hàng.
//
// Nguồn gốc format script: doc chính thức
// https://docs.dify.ai/en/use-dify/publish/webapp/embedding-in-websites mô tả 2 bước: (1)
// window.difyChatbotConfig = { token, baseUrl }, (2) <script src="{baseUrl}/embed.min.js"
// id="{token}" defer>. URL embed.min.js suy ra trực tiếp từ baseUrl theo đúng pattern doc mô tả —
// KHÔNG bịa domain khác.
//
// Token + baseUrl nhận qua PROP (đọc runtime từ server layout, xem app/(client)/layout.tsx) thay vì
// tự đọc process.env — để đổi token KHÔNG phải rebuild image (component là "use client", nếu tự đọc
// process.env.NEXT_PUBLIC_* thì Next inline giá trị lúc `next build`). Token KHÔNG bí mật (nằm công
// khai trong HTML gửi về browser) nên truyền thẳng qua prop an toàn.
//
// Cách lấy token thật (làm 1 lần trong Dify UI): tạo App Chatbot/Chatflow -> Publish -> tab
// "Embed on website" -> copy token (chính là "id" của thẻ script) -> đặt vào env DIFY_APP_TOKEN
// trong k8s/deployment.yaml.
import Script from "next/script";

const DEFAULT_BASE_URL = "https://dify.alphatrue.net";

interface DifyChatWidgetProps {
  token?: string;
  baseUrl?: string;
}

export default function DifyChatWidget({ token, baseUrl }: DifyChatWidgetProps) {
  const resolvedBaseUrl = baseUrl || DEFAULT_BASE_URL;

  // Token thật chưa tồn tại cho tới khi user tạo App + Publish trong Dify UI -> ẩn widget hoàn toàn
  // thay vì render script hỏng (thẻ script id rỗng + config token rỗng sẽ lỗi ở phía embed.min.js).
  if (!token) {
    return null;
  }

  return (
    <>
      <Script
        id="dify-chatbot-config"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `window.difyChatbotConfig = { token: "${token}", baseUrl: "${resolvedBaseUrl}" };`,
        }}
      />
      <Script
        id={token}
        src={`${resolvedBaseUrl}/embed.min.js`}
        strategy="afterInteractive"
        defer
      />
    </>
  );
}
