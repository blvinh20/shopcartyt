# syntax=docker/dockerfile:1
#
# Dockerfile cho shopcartyt (Next.js 15.2.1 + Sanity + Clerk + Stripe).
# Multi-stage: deps -> builder -> runner, dùng `output: "standalone"` (next.config.ts) để image
# production chỉ chứa đúng file/dependency Next.js đã tự trace là thật sự cần lúc chạy — không
# copy nguyên node_modules (nặng hơn nhiều, kể cả devDependencies không cần ở runtime).
# Tham khảo: Next.js official Docker example (vercel/next.js/examples/with-docker) + Docker docs
# "Containerize a Next.js application".
#
# Node version: Next.js 15.2.1 yêu cầu tối thiểu Node ^18.18.0 || ^19.8.0 || >=20.0.0 (xem
# package.json Next.js). Chọn Node 22 (Active LTS "Jod", maintenance tới 04/2027) — Node 20 đã hết
# maintenance LTS (EOL 04/2026), không nên dùng cho image mới ở thời điểm này.
ARG NODE_VERSION=22-alpine

# ---------- Stage 1: deps — cài dependency riêng để tận dụng Docker layer cache ----------
# Tách stage này ra khỏi builder để khi chỉ sửa code (không đổi package.json/lock), Docker cache
# layer `npm ci` và không phải cài lại toàn bộ dependency mỗi lần build.
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

COPY package.json package-lock.json ./
# `npm ci` (không phải `npm install`): cài đúng version khoá trong package-lock.json, build
# reproducible — bắt buộc cho CI/production, không để npm tự resolve lại version mới hơn.
#
# `--legacy-peer-deps` BẮT BUỘC: package-lock.json thật của repo có xung đột peer dependency có
# sẵn từ trước (cmdk@1.0.0 yêu cầu peer react@^18, project dùng react@19 — độ trễ hệ sinh thái
# thường gặp khi 1 package con chưa cập nhật kịp major version React mới) — xác nhận thật bằng
# log lỗi CI đầu tiên (ERESOLVE could not resolve), không phải đoán. `npm ci` mặc định strict-mode
# từ chối cài khi có xung đột này; `--legacy-peer-deps` bỏ qua check peer dependency (giữ nguyên
# hành vi npm v6 trở về trước) — đây là cách project gốc chắc chắn đã dùng lúc tạo package-lock.json
# (nếu không, `npm install` thường cũng đã fail y hệt ngay từ lúc code thêm cmdk).
RUN npm ci --legacy-peer-deps

# ---------- Stage 2: builder — build Next.js ----------
FROM node:${NODE_VERSION} AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# --- Build-time public env (NEXT_PUBLIC_*) ---
# Next.js inline giá trị NEXT_PUBLIC_* thẳng vào JS bundle lúc `next build` (không đọc lại lúc
# runtime) — bắt buộc phải có mặt LÚC BUILD, không phải chỉ lúc container chạy. Đã grep thật code
# (`process.env.NEXT_PUBLIC_*`) trong repo và xác nhận các biến sau BẮT BUỘC lúc build:
#   - sanity/env.ts: `assertValue()` THROW ngay lúc import nếu thiếu NEXT_PUBLIC_SANITY_PROJECT_ID
#     hoặc NEXT_PUBLIC_SANITY_DATASET — pages dùng Sanity client bị render (SSG/ISR) lúc `next
#     build` sẽ làm build FAIL cứng nếu thiếu 2 biến này, không phải warning.
#   - actions/createCheckoutSession.ts: dùng NEXT_PUBLIC_BASE_URL để build success/cancel URL cho
#     Stripe Checkout — không throw lúc build nhưng cần đúng giá trị domain thật để Stripe redirect
#     đúng sau khi thanh toán (nếu thiếu, page vẫn build được nhưng chạy sai lúc runtime).
#   - app/(client)/layout.tsx bọc <ClerkProvider> quanh mọi route client — @clerk/nextjs throw
#     "Missing publishableKey" khi render (kể cả lúc prerender static) nếu thiếu
#     NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY (đã xác nhận qua issue thật của Clerk/Next.js community).
#
# Đây đều là giá trị PUBLIC theo đúng thiết kế của bên phát hành (Sanity project ID không phải
# secret; Clerk publishable key được thiết kế để lộ ra client-side) — an toàn để truyền qua
# --build-arg trong CI. TUYỆT ĐỐI không truyền CLERK_SECRET_KEY / STRIPE_SECRET_KEY hay bất kỳ
# secret runtime nào theo cách này — secret thật injected lúc container CHẠY (K8s Secret/env),
# không bake vào image lúc build.
ARG NEXT_PUBLIC_SANITY_PROJECT_ID
ARG NEXT_PUBLIC_SANITY_DATASET
ARG NEXT_PUBLIC_SANITY_API_VERSION
ARG NEXT_PUBLIC_BASE_URL
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY

ENV NEXT_PUBLIC_SANITY_PROJECT_ID=${NEXT_PUBLIC_SANITY_PROJECT_ID}
ENV NEXT_PUBLIC_SANITY_DATASET=${NEXT_PUBLIC_SANITY_DATASET}
ENV NEXT_PUBLIC_SANITY_API_VERSION=${NEXT_PUBLIC_SANITY_API_VERSION}
ENV NEXT_PUBLIC_BASE_URL=${NEXT_PUBLIC_BASE_URL}
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}

# Next.js tự đọc biến NEXT_TELEMETRY_DISABLED để tắt telemetry — không liên quan bảo mật, chỉ
# tránh gọi network thừa lúc build trong CI.
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ---------- Stage 3: runner — chạy production, non-root ----------
FROM node:${NODE_VERSION} AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Xoá hẳn npm/npx CLI bundled sẵn trong base image `node:*-alpine` — CVE-2026-33671 (picomatch
# 4.0.3, HIGH) và tương tự (sigstore cũ hơn) nằm trong CHÍNH node_modules nội bộ của npm CLI
# (/usr/local/lib/node_modules/npm/...), không phải dependency của project nên override trong
# package.json không bao giờ với tới được (đã verify thật: Trivy scan image vẫn báo lỗi dù
# package-lock.json của project đã đúng version vá). Container này CHỈ chạy `node server.js`
# (output: standalone của Next.js) — không bao giờ gọi npm/npx lúc runtime, nên xoá thẳng loại bỏ
# HẲN class lỗi này (không phải chỉ suppress bằng .trivyignore) thay vì tìm cách vá 1 tool không
# dùng tới.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

# Non-root user — không chạy app bằng root trong container (xem devops-handbook/09-security.md).
# Alpine không có sẵn user `node` non-root theo UID cố định như image Debian, nên tự tạo group/user
# riêng đúng theo pattern chính thức Next.js example (`nextjs:nodejs`, uid/gid 1001 tránh trùng uid
# 1000 mặc định của user đầu tiên trên nhiều hệ base image).
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# `output: "standalone"` sinh ra 1 server Node.js độc lập (`server.js`) đã tự trace + copy đúng
# node_modules cần dùng — CHỈ cần copy 3 thứ sau vào runner, không cần package.json/npm/node_modules
# đầy đủ nữa.
COPY --from=builder /app/public ./public

# .next/standalone chứa server.js + node_modules đã trace tối giản; set quyền sở hữu ngay lúc COPY
# (--chown) thay vì `chown -R` sau đó — nhanh hơn (build 1 layer, không phải quét lại toàn bộ cây
# thư mục lần 2) và giữ image nhẹ hơn (`chown -R` runtime thêm 1 lệnh + 1 layer).
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# server.js là entrypoint do Next.js tự sinh trong standalone output — không phải `next start`.
CMD ["node", "server.js"]
