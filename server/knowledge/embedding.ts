import { config, getDashScopeHttpOrigin } from "../config.js";

type EmbeddingResponse = {
  data?: Array<{ embedding?: number[] }>;
  error?: { message?: string };
  message?: string;
};

/** Creates 1024-dimensional Alibaba Cloud embeddings through the compatible API. */
export async function createEmbeddings(inputs: string[]) {
  const apiKey = config.DASHSCOPE_API_KEY;
  const httpOrigin = getDashScopeHttpOrigin();
  if (!apiKey || !httpOrigin) {
    throw new Error("缺少 DASHSCOPE_API_KEY 或 DASHSCOPE_WORKSPACE_ID，无法生成向量。");
  }

  const response = await fetch(`${httpOrigin}/compatible-mode/v1/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.DASHSCOPE_EMBEDDING_MODEL,
      input: inputs,
      dimensions: 1024,
      encoding_format: "float",
    }),
  });

  const payload = (await response.json()) as EmbeddingResponse;
  if (!response.ok) {
    throw new Error(payload.error?.message ?? payload.message ?? `向量接口请求失败：${response.status}`);
  }

  const embeddings = payload.data?.map((item) => item.embedding);
  if (!embeddings || embeddings.some((embedding) => !embedding || embedding.length !== 1024)) {
    throw new Error("阿里云向量接口未返回预期的 1024 维向量。");
  }
  return embeddings as number[][];
}
