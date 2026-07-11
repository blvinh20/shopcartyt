// H2 — Distributed tracing. Next.js gọi hàm `register()` này 1 LẦN lúc server khởi động (hook
// `instrumentation.ts` là stable từ Next 15, không cần experimental flag). @vercel/otel tự dựng
// OpenTelemetry SDK + OTLP/HTTP exporter, đọc endpoint từ biến môi trường OTEL_EXPORTER_OTLP_ENDPOINT
// (đặt trong k8s/deployment.yaml = http://tempo.observability.svc.cluster.local:4318). Mỗi HTTP
// request tới app tự sinh span → gửi Tempo → xem trong Grafana Explore (datasource Tempo), correlate
// sang log Loki qua service.name=shopcartyt (đã cấu hình tracesToLogsV2 phía Grafana).
//
// Chạy lúc RUNTIME (server start), KHÔNG phải build-time — an toàn với bài học Q60 (không throw ở
// module top-level lúc `next build` collecting page data): register() chỉ được Next gọi khi server
// thật sự chạy, và thiếu OTEL endpoint thì @vercel/otel chỉ no-op chứ không crash.
import { registerOTel } from "@vercel/otel";

export function register() {
  registerOTel({ serviceName: "shopcartyt" });
}
