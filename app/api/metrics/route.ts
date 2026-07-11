// G2 — Custom app metrics endpoint (Prometheus format). ServiceMonitor "shopcartyt"
// (gitops-config/platform/kube-prometheus-stack/servicemonitor-shopcartyt.yaml) scrape đúng path
// /api/metrics, port "http" mỗi 30s. Prometheus gom metric từ TỪNG pod (ServiceMonitor scrape mỗi
// endpoint), aggregate bằng sum() lúc query — nên counter in-memory per-pod là đúng, không cần shared store.
import { NextResponse } from "next/server";
import client from "prom-client";

// force-dynamic: KHÔNG cho Next prerender route này lúc build (nếu prerender, prom-client init chạy
// lúc build-time — đúng loại lỗi Q60). Ép chạy runtime mỗi request.
export const dynamic = "force-dynamic";

// collectDefaultMetrics chỉ được gọi 1 LẦN cho cả tiến trình (gọi 2 lần prom-client throw "already
// registered"). Guard qua globalThis vì module có thể bị import lại (HMR/dev). Prefix "shopcartyt_"
// để phân biệt metric của app với metric hệ thống. Default metrics = runtime Node.js thật: heap,
// event-loop lag, GC, CPU, số handle — dữ liệu vận hành app-level mà cluster metrics (kube-state) không có.
const g = globalThis as unknown as { __promRegistered?: boolean; __httpCounter?: client.Counter };
if (!g.__promRegistered) {
  client.collectDefaultMetrics({ prefix: "shopcartyt_" });
  // 1 custom counter minh hoạ metric nghiệp vụ tự khai (tách khỏi default metrics): đếm số lần
  // /api/metrics bị scrape — nhỏ nhưng THẬT, chứng minh biết tạo custom metric (Counter) đúng cách.
  g.__httpCounter = new client.Counter({
    name: "shopcartyt_metrics_scrape_total",
    help: "So lan endpoint /api/metrics bi Prometheus scrape (custom counter minh hoa)",
  });
  g.__promRegistered = true;
}

export async function GET() {
  g.__httpCounter?.inc();
  const body = await client.register.metrics();
  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": client.register.contentType },
  });
}
