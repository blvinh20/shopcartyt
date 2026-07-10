import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Bật standalone output — khuyến nghị chính thức của Next.js khi self-host bằng Docker
  // (https://nextjs.org/docs/app/api-reference/config/next-config-js/output): Next.js tự trace
  // đúng file/dependency thật sự dùng tới trong `node_modules` rồi copy vào `.next/standalone`,
  // thay vì phải copy nguyên cây `node_modules` (nặng hơn nhiều, kể cả devDependencies không
  // cần ở runtime) vào image production. Không bật thì Dockerfile multi-stage vẫn chạy được
  // nhưng image runner sẽ to hơn đáng kể và phải tự copy `node_modules` + `package.json` thủ công.
  output: "standalone",
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.sanity.io",
      },
    ],
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
