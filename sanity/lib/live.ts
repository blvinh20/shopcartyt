// Querying with "sanityFetch" will keep content automatically updated
// Before using it, import and render "<SanityLive />" in your layout, see
// https://github.com/sanity-io/next-sanity#live-content-api for more information.
import { defineLive } from "next-sanity";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { client } from "./client";

// Không throw khi đang ở PHASE_PRODUCTION_BUILD (`next build`) — Next.js import module này lúc
// build để phân tích tĩnh mọi route (kể cả route không thật sự dùng sanityFetch), SANITY_API_READ_TOKEN
// là secret thật, theo đúng thiết kế (Phase 4, External Secrets) không có mặt lúc build, chỉ inject
// lúc container thật sự chạy. Runtime thật (container chạy) vẫn throw đúng như cũ nếu thiếu token —
// chỉ nới lỏng đúng lúc build, không nới lỏng lúc chạy thật (đây là pattern chính thức Next.js
// khuyến nghị cho đúng tình huống "biến môi trường bắt buộc lúc chạy nhưng không có lúc build").
const token = process.env.SANITY_API_READ_TOKEN;
if (!token && process.env.NEXT_PHASE !== PHASE_PRODUCTION_BUILD) {
  throw new Error("SANITY_API_READ_TOKEN is not set");
}

export const { sanityFetch, SanityLive } = defineLive({
  client,
  serverToken: token,
  browserToken: token,
  fetchOptions: {
    revalidate: 0,
  },
});
