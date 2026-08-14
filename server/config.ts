import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .default("postgresql://interview:interview@localhost:54329/interview_rag"),
  DASHSCOPE_API_KEY: z.string().optional(),
  DASHSCOPE_WORKSPACE_ID: z.string().optional(),
  DASHSCOPE_REGION: z.enum(["cn-beijing", "ap-southeast-1"]).default("cn-beijing"),
  DASHSCOPE_EMBEDDING_MODEL: z.string().default("text-embedding-v4"),
  DASHSCOPE_RERANK_MODEL: z.string().default("qwen3-rerank"),
  RERANK_CANDIDATE_LIMIT: z.coerce.number().int().min(3).max(30).default(5),
  RERANK_MIN_INTERVAL_MS: z.coerce.number().int().min(2_000).default(2_000),
  RERANK_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),
  DASHSCOPE_TRANSLATION_MODEL: z
    .string()
    .default("qwen3.5-livetranslate-flash-realtime"),
  DASHSCOPE_ASR_MODEL: z.string().default("qwen3-asr-flash-realtime"),
  LOCAL_QUESTION_MODEL_URL: z.string().url().default("http://127.0.0.1:18080/v1"),
  LOCAL_QUESTION_MODEL: z.string().min(1).default("qwen3.5-2b"),
  LOCAL_QUESTION_MODEL_TIMEOUT_MS: z.coerce.number().int().positive().default(6_000),
  OPENAI_BASE_URL: z.string().url().optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().min(1).optional(),
  QUESTION_REWRITE_EVAL_MIN_PASS_RATE: z.coerce.number().min(0).max(1).default(0.8),
  QUESTION_REWRITE_EVAL_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  RETRIEVAL_EVAL_MIN_PASS_RATE: z.coerce.number().min(0).max(1).default(0.8),
  RETRIEVAL_EVAL_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().positive().default(8787),
  RUNTIME_LOG_DIR: z.string().min(1).default("runtime-logs"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export const config = envSchema.parse(process.env);

/** Returns the workspace-specific Model Studio API origin. */
export function getDashScopeHttpOrigin() {
  const workspaceId = config.DASHSCOPE_WORKSPACE_ID;
  if (!workspaceId) {
    return undefined;
  }

  return `https://${workspaceId}.${config.DASHSCOPE_REGION}.maas.aliyuncs.com`;
}

/** Returns a workspace-specific realtime WebSocket URL for the selected model. */
export function getRealtimeWebSocketUrl(model: string) {
  const workspaceId = config.DASHSCOPE_WORKSPACE_ID;
  if (!workspaceId) {
    return undefined;
  }

  const origin = `wss://${workspaceId}.${config.DASHSCOPE_REGION}.maas.aliyuncs.com`;
  return `${origin}/api-ws/v1/realtime?model=${encodeURIComponent(model)}`;
}
