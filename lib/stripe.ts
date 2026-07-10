import Stripe from "stripe";

// Khởi tạo LAZY (Proxy, không phải hằng số ở top-level module) — Next.js "Collecting page data"
// lúc `next build` tự import mọi route handler module để phân tích tĩnh, khiến code top-level
// (kể cả throw) chạy NGAY LÚC BUILD dù chưa có request nào. STRIPE_SECRET_KEY là secret thật, theo
// đúng thiết kế (Phase 4, External Secrets) KHÔNG BAO GIỜ có mặt lúc build — chỉ inject lúc
// container thật sự chạy (K8s Secret) — nên bản cũ (throw ngay khi import) luôn làm `npm run
// build` fail cứng trong Docker/CI. Proxy trì hoãn việc đọc env + khởi tạo client tới đúng lúc có
// truy cập property đầu tiên (lúc xử lý request thật, runtime), giữ nguyên cách gọi
// `stripe.webhooks.constructEvent(...)`/`stripe.checkout.sessions...` ở mọi nơi khác không đổi.
let cached: Stripe | undefined;

function getClient(): Stripe {
  if (!cached) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY is not defined");
    }
    cached = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2025-03-31.basil",
    });
  }
  return cached;
}

const stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    const client = getClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

export default stripe;
