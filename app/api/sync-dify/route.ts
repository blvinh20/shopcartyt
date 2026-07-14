// RAG sync: đẩy toàn bộ sản phẩm Sanity sang Dify Knowledge Base (dataset) để chatbot Dify trả lời
// dựa trên dữ liệu sản phẩm thật (RAG), thay vì hallucinate.
//
// TẠI SAO route API thủ công thay vì K8s CronJob riêng:
// Route này chạy NGAY TRONG Docker image Next.js đã build & deploy sẵn của shopcartyt (không cần
// build/push image riêng, không cần thêm Job/CronJob manifest mới trong GitOps) — đơn giản hơn
// nhiều cho quy mô lab. Gọi thủ công bằng `curl -X POST https://<host>/api/sync-dify`, hoặc gắn vào
// lịch chạy ngoài sau này nếu cần tự động (vd GitHub Actions `schedule:` gọi curl vào route, hoặc 1
// K8s CronJob nhỏ chỉ chứa 1 lệnh curl — không cần image riêng cho logic sync) — việc tự động hoá đó
// nằm NGOÀI phạm vi hiện tại, chỉ ghi chú ở đây cho lần sau.
import { NextResponse } from "next/server";
import { backendClient } from "@/sanity/lib/backendClient";

// force-dynamic: route này có side-effect (gọi API ngoài + đọc Sanity mới nhất), không được Next
// prerender/cache lúc build (cùng lý do với /api/metrics).
export const dynamic = "force-dynamic";

// ---- Kiểu dữ liệu sản phẩm lấy từ Sanity (GROQ) ----
interface SanityProduct {
  _id: string;
  name: string | null;
  slug: string | null;
  description: string | null;
  price: number | null;
  discount: number | null;
  stock: number | null;
  status: string | null;
  categories: string[] | null;
  brand: string | null;
}

// ---- Kiểu dữ liệu tối thiểu cần dùng từ response Dify (theo OpenAPI spec chính thức, không bịa
// field ngoài phạm vi dùng) ----
interface DifyDataset {
  id: string;
  name: string;
}

interface DifyCreateDocumentResponse {
  document: {
    id: string;
    batch?: string;
  };
}

interface DifyErrorResponse {
  code?: string;
  message?: string;
}

const DIFY_DATASET_NAME = "shopcartyt-products";

// GROQ lấy field thật theo schema (sanity/schemaTypes/productType.ts, categoryType.ts, brandTypes.ts):
// - description ở productType là "string" (KHÔNG phải block content) -> không cần convert portable text.
// - categories: array reference -> category.title (không phải "name").
// - brand: reference đơn -> brand.title (không phải "name").
const PRODUCTS_QUERY = /* groq */ `*[_type == "product"]{
  _id,
  name,
  "slug": slug.current,
  description,
  price,
  discount,
  stock,
  status,
  "categories": categories[]->title,
  "brand": brand->title
}`;

function productToText(p: SanityProduct): string {
  const lines: string[] = [];
  lines.push(`# ${p.name ?? "(Không có tên)"}`);
  if (p.slug) lines.push(`URL: /product/${p.slug}`);
  if (typeof p.price === "number") lines.push(`Giá: ${p.price} USD`);
  if (typeof p.discount === "number" && p.discount > 0) {
    lines.push(`Giảm giá: ${p.discount}%`);
  }
  if (typeof p.stock === "number") lines.push(`Tồn kho: ${p.stock}`);
  if (p.status) lines.push(`Trạng thái: ${p.status}`);
  if (p.categories && p.categories.length > 0) {
    lines.push(`Danh mục: ${p.categories.filter(Boolean).join(", ")}`);
  }
  if (p.brand) lines.push(`Thương hiệu: ${p.brand}`);
  if (p.description) {
    lines.push("");
    lines.push(p.description);
  }
  return lines.join("\n");
}

async function difyFetch(
  url: string,
  apiKey: string,
  init: RequestInit,
): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...init.headers,
    },
  });
}

export async function POST() {
  // Đọc env NGAY TRONG handler (không đọc ở top-level module) — nếu thiếu, trả lỗi rõ ràng thay vì
  // throw lúc build/import (đúng bài học Q60 đã áp dụng ở /api/metrics).
  const apiKey = process.env.DIFY_API_KEY;
  const apiUrl = process.env.DIFY_API_URL;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Thiếu biến môi trường DIFY_API_KEY. Tạo API key trong Dify UI: Knowledge -> Service API." },
      { status: 500 },
    );
  }
  if (!apiUrl) {
    return NextResponse.json(
      { error: "Thiếu biến môi trường DIFY_API_URL (vd https://dify.alphatrue.net/v1)." },
      { status: 500 },
    );
  }

  let products: SanityProduct[];
  try {
    products = await backendClient.fetch<SanityProduct[]>(PRODUCTS_QUERY);
  } catch (err) {
    return NextResponse.json(
      { error: `Không đọc được sản phẩm từ Sanity: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  // Đơn giản hoá cho lab: nếu đã có DIFY_DATASET_ID (biến env) thì tái sử dụng luôn; nếu không, tạo
  // mới 1 dataset và dùng cho toàn bộ vòng lặp sync HIỆN TẠI (không tự lưu persistent giữa các lần
  // gọi route sau — production thật nên lưu dataset_id ở nơi bền vững như DB/KV để tránh tạo dataset
  // trùng lặp mỗi lần chạy).
  let datasetId = process.env.DIFY_DATASET_ID;

  if (!datasetId) {
    const createDatasetRes = await difyFetch(`${apiUrl}/datasets`, apiKey, {
      method: "POST",
      body: JSON.stringify({
        name: DIFY_DATASET_NAME,
        description: "Sản phẩm shopcartyt đồng bộ tự động từ Sanity CMS",
        indexing_technique: "high_quality",
        permission: "only_me",
      }),
    });

    if (!createDatasetRes.ok) {
      const errBody = (await createDatasetRes.json().catch(() => ({}))) as DifyErrorResponse;
      return NextResponse.json(
        {
          error: `Tạo dataset Dify thất bại (HTTP ${createDatasetRes.status}): ${errBody.message ?? "không rõ nguyên nhân"}`,
        },
        { status: 502 },
      );
    }

    const dataset = (await createDatasetRes.json()) as DifyDataset;
    datasetId = dataset.id;
  }

  let success = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const product of products) {
    try {
      // LƯU Ý: OpenAPI spec chính thức mới nhất của Dify dùng path "create-by-text" (gạch ngang).
      // Một số tài liệu/README cũ ghi "create_by_text" (gạch dưới) — đó là path CŨ/khác, KHÔNG dùng
      // ở đây. Dùng đúng "create-by-text" theo openapi_service.json hiện hành.
      const res = await difyFetch(
        `${apiUrl}/datasets/${datasetId}/document/create-by-text`,
        apiKey,
        {
          method: "POST",
          body: JSON.stringify({
            name: product.name ?? product._id,
            text: productToText(product),
            indexing_technique: "high_quality",
            doc_form: "text_model",
            process_rule: { mode: "automatic" },
          }),
        },
      );

      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as DifyErrorResponse;
        failed += 1;
        errors.push(`${product._id}: HTTP ${res.status} ${errBody.message ?? ""}`.trim());
        continue;
      }

      // Response thật chứa { document: { id, batch, ... } } — chỉ cần xác nhận có id, không cần
      // theo dõi trạng thái indexing bất đồng bộ (ngoài phạm vi lab này).
      await res.json() as DifyCreateDocumentResponse;
      success += 1;
    } catch (err) {
      failed += 1;
      errors.push(`${product._id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return NextResponse.json({
    datasetId,
    totalProducts: products.length,
    success,
    failed,
    errors: errors.length > 0 ? errors : undefined,
  });
}
