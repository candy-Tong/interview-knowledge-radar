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
  DASHSCOPE_TRANSLATION_MODEL: z
    .string()
    .default("qwen3.5-livetranslate-flash-realtime"),
  DASHSCOPE_ASR_MODEL: z.string().default("qwen3-asr-flash-realtime"),
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
