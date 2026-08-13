import { createServer } from "node:http";
import { resolve } from "node:path";
import express from "express";
import { z } from "zod";
import { config } from "./config.js";
import { databasePool } from "./database/client.js";
import { fetchKnowledgeStats, refreshKnowledgeDirectory } from "./knowledge/ingest.js";
import { maximumKnowledgeResults, searchKnowledge } from "./knowledge/search.js";
import {
  createRealtimeWebSocketServer,
  handleRealtimeUpgrade,
} from "./realtime/translation-proxy.js";

const searchSchema = z.object({
  query: z.string().trim().min(2).max(2_000),
  limit: z.number().int().min(1).max(maximumKnowledgeResults).default(maximumKnowledgeResults),
});

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));

app.get("/api/health", async (_request, response) => {
  let databaseReady = false;
  try {
    await databasePool.query("SELECT 1");
    databaseReady = true;
  } catch {
    databaseReady = false;
  }

  response.json({
    databaseReady,
    dashScopeReady: Boolean(config.DASHSCOPE_API_KEY && config.DASHSCOPE_WORKSPACE_ID),
    asrModel: config.DASHSCOPE_ASR_MODEL,
    translationModel: config.DASHSCOPE_TRANSLATION_MODEL,
    embeddingModel: config.DASHSCOPE_EMBEDDING_MODEL,
  });
});

app.get("/api/knowledge/stats", async (_request, response) => {
  try {
    response.json(await fetchKnowledgeStats());
  } catch (error) {
    response.status(503).json({
      message: error instanceof Error ? error.message : "知识库暂不可用。",
    });
  }
});

app.post("/api/knowledge/refresh", async (_request, response) => {
  try {
    response.json(await refreshKnowledgeDirectory());
  } catch (error) {
    response.status(503).json({
      message: error instanceof Error ? error.message : "知识库更新失败。",
    });
  }
});

app.get("/api/knowledge", async (_request, response) => {
  try {
    const result = await databasePool.query<{
      id: string;
      sourceName: string;
      heading: string;
      content: string;
      updatedAt: string;
    }>(`
      SELECT
        chunk.id::text,
        document.source_name AS "sourceName",
        chunk.heading,
        chunk.content,
        document.updated_at::text AS "updatedAt"
      FROM knowledge_chunks chunk
      JOIN knowledge_documents document ON document.id = chunk.document_id
      ORDER BY document.source_name ASC
    `);
    response.json({ results: result.rows });
  } catch (error) {
    response.status(503).json({
      message: error instanceof Error ? error.message : "知识库暂不可用。",
    });
  }
});

app.post("/api/search", async (request, response) => {
  const parsed = searchSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "请输入至少两个字符的英文面试问题。" });
    return;
  }
  try {
    const results = await searchKnowledge(parsed.data.query, parsed.data.limit);
    response.json({ query: parsed.data.query, results });
  } catch (error) {
    response.status(503).json({
      message: error instanceof Error ? error.message : "知识库检索失败。",
    });
  }
});

if (config.NODE_ENV === "production") {
  const distributionDirectory = resolve(process.cwd(), "dist");
  app.use(express.static(distributionDirectory));
  app.get("/*splat", (_request, response) => {
    response.sendFile(resolve(distributionDirectory, "index.html"));
  });
}

const server = createServer(app);
const realtimeSocketServer = createRealtimeWebSocketServer();
server.on("upgrade", (request, socket, head) => {
  handleRealtimeUpgrade(realtimeSocketServer, request, socket, head);
});
server.listen(config.PORT, config.HOST, () => {
  console.log(
    `Interview Knowledge Radar server listening on http://${config.HOST}:${config.PORT}`,
  );
});

/** Closes network resources cleanly during local restarts. */
async function shutdown() {
  realtimeSocketServer.close();
  server.close();
  await databasePool.end();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
