import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import { config, getRealtimeWebSocketUrl } from "../config.js";
import { maximumKnowledgeResults, searchKnowledge } from "../knowledge/search.js";
import {
  type RuntimeLogEntry,
  type RuntimeLogWriter,
  writeRuntimeLog,
} from "../runtime-log.js";

export enum RealtimeMode {
  Translation = "translation",
  Transcription = "transcription",
}

type AliyunEvent = {
  type?: string;
  item_id?: string;
  previous_item_id?: string;
  text?: string;
  stash?: string;
  transcript?: string;
  error?: { message?: string; code?: string };
  item?: { id?: string; role?: string };
};

type ClientEvent = { type?: string };

type RealtimeProxyOptions = {
  apiKey?: string;
  upstreamUrl?: string;
  search?: typeof searchKnowledge;
  turnGapMs?: number;
  progressiveSearchIntervalMs?: number;
  runtimeLog?: RuntimeLogWriter;
};

const maximumQueuedChunks = 250;
const defaultTurnGapMs = 5_000;
const defaultProgressiveSearchIntervalMs = 800;

/** Joins adjacent ASR fragments without introducing punctuation not present in the transcript. */
function joinTurnParts(parts: string[]) {
  return parts.map((part) => part.trim()).filter(Boolean).join(" ");
}

/** Avoids spending a retrieval on fragments that are too short to express intent. */
function isMeaningfulProgressiveQuery(query: string) {
  const words = query.trim().split(/\s+/).filter(Boolean);
  const nonWhitespaceCharacters = [...query.replace(/\s/g, "")].length;
  return words.length >= 3 || nonWhitespaceCharacters >= 6;
}

/** Sends a JSON event only while the browser WebSocket remains writable. */
function sendJson(socket: WebSocket, payload: unknown) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

/** Builds the upstream session configuration for translation or transcription. */
function createSessionUpdate(mode: RealtimeMode) {
  if (mode === RealtimeMode.Transcription) {
    return {
      event_id: `event_${randomUUID().replaceAll("-", "")}`,
      type: "session.update",
      session: {
        modalities: ["text"],
        sample_rate: 16000,
        input_audio_format: "pcm",
        turn_detection: {
          type: "server_vad",
          threshold: 0.2,
          silence_duration_ms: 800,
        },
      },
    };
  }

  return {
    event_id: `event_${randomUUID().replaceAll("-", "")}`,
    type: "session.update",
    session: {
      modalities: ["text"],
      sample_rate: 16000,
      input_audio_format: "pcm",
      input_audio_transcription: {
        model: config.DASHSCOPE_ASR_MODEL,
        language: "en",
      },
      translation: {
        language: "zh",
        corpus: {
          phrases: {
            monorepo: "大仓",
            "customer complaint Agent": "客诉 Agent",
            "post-loan collection": "贷后催收",
            "quality gate": "质量门禁",
          },
        },
      },
    },
  };
}

/** Parses a client mode while preserving translation as the backward-compatible default. */
function parseRealtimeMode(value: string | null) {
  if (!value || value === RealtimeMode.Translation) {
    return RealtimeMode.Translation;
  }
  if (value === RealtimeMode.Transcription) {
    return RealtimeMode.Transcription;
  }
  return undefined;
}

/** Proxies browser PCM audio to Alibaba Cloud without exposing the API key. */
export function createRealtimeWebSocketServer(options: RealtimeProxyOptions = {}) {
  const socketServer = new WebSocketServer({ noServer: true });

  socketServer.on("connection", (browserSocket, request) => {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    const mode = parseRealtimeMode(requestUrl.searchParams.get("mode"));
    if (!mode) {
      sendJson(browserSocket, {
        type: "session.error",
        message: "不支持的实时语音模式。",
      });
      browserSocket.close(1008, "Unsupported realtime mode");
      return;
    }
    const model =
      mode === RealtimeMode.Translation
        ? config.DASHSCOPE_TRANSLATION_MODEL
        : config.DASHSCOPE_ASR_MODEL;
    const upstreamUrl = options.upstreamUrl ?? getRealtimeWebSocketUrl(model);
    const apiKey = options.apiKey ?? config.DASHSCOPE_API_KEY;
    const search = options.search ?? searchKnowledge;
    const turnGapMs = options.turnGapMs ?? defaultTurnGapMs;
    const progressiveSearchIntervalMs =
      options.progressiveSearchIntervalMs ?? defaultProgressiveSearchIntervalMs;
    if (!upstreamUrl || !apiKey) {
      sendJson(browserSocket, {
        type: "session.error",
        message: "服务端缺少阿里云 API Key 或 Workspace ID。",
      });
      browserSocket.close(1011, "DashScope is not configured");
      return;
    }
    const queuedAudio: Buffer[] = [];
    const sessionId = `session_${randomUUID().replaceAll("-", "")}`;
    const runtimeLog =
      options.runtimeLog ??
      (config.NODE_ENV === "test"
        ? async (_entry: RuntimeLogEntry) => undefined
        : writeRuntimeLog);
    const translationToSource = new Map<string, string>();
    const sourceToTurn = new Map<string, string>();
    const pendingRetrievals = new Set<Promise<void>>();
    const pendingRuntimeLogs = new Set<Promise<void>>();
    const retrievalVersionByTurn = new Map<string, number>();
    const lastRetrievalQueryByTurn = new Map<string, string>();
    const lastRetrievalStartedAtByTurn = new Map<string, number>();
    let isUpstreamReady = false;
    let activeTurnId = "";
    let sourceParts: string[] = [];
    let translationParts: string[] = [];
    let turnFlushTimer: ReturnType<typeof setTimeout> | undefined;
    let progressiveSearchTimer: ReturnType<typeof setTimeout> | undefined;
    let pendingProgressiveSearch: { itemId: string; query: string } | undefined;
    let isFinishing = false;
    const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
    if (mode === RealtimeMode.Transcription) {
      headers["OpenAI-Beta"] = "realtime=v1";
    }
    const upstreamSocket = new WebSocket(upstreamUrl, { headers });

    /** Writes one session-scoped audit event without blocking the realtime stream. */
    function logRuntimeEvent(event: string, details: Record<string, unknown> = {}) {
      const pendingLog = runtimeLog({ event, sessionId, mode, ...details })
        .catch((error) => {
          console.error(
            `Runtime log write failed: ${error instanceof Error ? error.message : "unknown error"}`,
          );
        })
        .finally(() => {
          pendingRuntimeLogs.delete(pendingLog);
        });
      pendingRuntimeLogs.add(pendingLog);
      return pendingLog;
    }

    void logRuntimeEvent("session.started", { model });

    /** Wraps raw PCM bytes in the Alibaba Cloud realtime audio event. */
    function sendAudio(buffer: Buffer) {
      if (upstreamSocket.readyState !== WebSocket.OPEN || !isUpstreamReady) {
        if (queuedAudio.length >= maximumQueuedChunks) {
          queuedAudio.shift();
        }
        queuedAudio.push(buffer);
        return;
      }
      upstreamSocket.send(
        JSON.stringify({
          event_id: `event_${randomUUID().replaceAll("-", "")}`,
          type: "input_audio_buffer.append",
          audio: buffer.toString("base64"),
        }),
      );
    }

    /** Searches knowledge while suppressing responses superseded by a newer partial query. */
    async function retrieveKnowledge(
      itemId: string,
      transcript: string,
      version: number,
      startedAt: number,
    ) {
      try {
        const results = await search(transcript, maximumKnowledgeResults);
        if (retrievalVersionByTurn.get(itemId) !== version) {
          void logRuntimeEvent("knowledge.retrieval.discarded", {
            turnId: itemId,
            query: transcript,
            version,
            durationMs: Date.now() - startedAt,
            reason: "superseded",
          });
          return;
        }
        void logRuntimeEvent("knowledge.retrieval.completed", {
          turnId: itemId,
          query: transcript,
          version,
          durationMs: Date.now() - startedAt,
          results: results.map((result, index) => ({
            rank: index + 1,
            id: result.id,
            sourceName: result.sourceName,
            heading: result.heading,
            bm25Score: result.bm25Score,
            vectorScore: result.vectorScore,
            hybridScore: result.hybridScore,
            focusStart: result.focusStart,
            focusEnd: result.focusEnd,
            focusText: result.content.slice(result.focusStart, result.focusEnd),
          })),
        });
        sendJson(browserSocket, {
          type: "knowledge.results",
          itemId,
          query: transcript,
          results,
        });
      } catch (error) {
        if (retrievalVersionByTurn.get(itemId) !== version) {
          void logRuntimeEvent("knowledge.retrieval.discarded", {
            turnId: itemId,
            query: transcript,
            version,
            durationMs: Date.now() - startedAt,
            reason: "superseded_error",
          });
          return;
        }
        const message = error instanceof Error ? error.message : "知识库检索失败。";
        void logRuntimeEvent("knowledge.retrieval.failed", {
          turnId: itemId,
          query: transcript,
          version,
          durationMs: Date.now() - startedAt,
          message,
        });
        sendJson(browserSocket, {
          type: "knowledge.error",
          itemId,
          message,
        });
      }
    }

    /** Starts one deduplicated retrieval and tracks it for graceful session shutdown. */
    function startKnowledgeRetrieval(itemId: string, transcript: string) {
      const query = transcript.trim().replace(/\s+/g, " ");
      if (!query || lastRetrievalQueryByTurn.get(itemId) === query) {
        return;
      }

      lastRetrievalQueryByTurn.set(itemId, query);
      lastRetrievalStartedAtByTurn.set(itemId, Date.now());
      const version = (retrievalVersionByTurn.get(itemId) ?? 0) + 1;
      retrievalVersionByTurn.set(itemId, version);
      const startedAt = Date.now();
      void logRuntimeEvent("knowledge.retrieval.started", {
        turnId: itemId,
        query,
        version,
        limit: maximumKnowledgeResults,
      });
      const retrieval = retrieveKnowledge(itemId, query, version, startedAt).finally(() => {
        pendingRetrievals.delete(retrieval);
      });
      pendingRetrievals.add(retrieval);
    }

    /** Cancels a queued partial search without affecting requests already in flight. */
    function clearProgressiveSearchTimer() {
      if (progressiveSearchTimer) {
        clearTimeout(progressiveSearchTimer);
        progressiveSearchTimer = undefined;
      }
      pendingProgressiveSearch = undefined;
    }

    /** Refreshes the current turn during speech, capped to one request per interval. */
    function scheduleProgressiveKnowledge(itemId: string, transcript: string) {
      const query = transcript.trim().replace(/\s+/g, " ");
      if (!isMeaningfulProgressiveQuery(query)) {
        clearProgressiveSearchTimer();
        return;
      }
      if (lastRetrievalQueryByTurn.get(itemId) === query) {
        clearProgressiveSearchTimer();
        return;
      }

      pendingProgressiveSearch = { itemId, query };
      const elapsed = Date.now() - (lastRetrievalStartedAtByTurn.get(itemId) ?? 0);
      const waitMs = Math.max(0, progressiveSearchIntervalMs - elapsed);
      if (waitMs === 0) {
        const request = pendingProgressiveSearch;
        clearProgressiveSearchTimer();
        startKnowledgeRetrieval(request.itemId, request.query);
        return;
      }
      if (!progressiveSearchTimer) {
        progressiveSearchTimer = setTimeout(() => {
          const request = pendingProgressiveSearch;
          clearProgressiveSearchTimer();
          if (request) {
            startKnowledgeRetrieval(request.itemId, request.query);
          }
        }, waitMs);
      }
    }

    /** Creates or reuses the logical interviewer turn that owns an ASR item. */
    function getTurnId(sourceItemId: string) {
      if (!activeTurnId) {
        activeTurnId = `turn_${sourceItemId}`;
      }
      sourceToTurn.set(sourceItemId, activeTurnId);
      return activeTurnId;
    }

    /** Prevents the five-second boundary from firing while the interviewer is speaking. */
    function clearTurnFlushTimer() {
      if (turnFlushTimer) {
        clearTimeout(turnFlushTimer);
        turnFlushTimer = undefined;
      }
    }

    /** Publishes one merged turn and ensures its full recognized text has been searched. */
    function flushTurn() {
      clearTurnFlushTimer();
      clearProgressiveSearchTimer();
      if (!activeTurnId || sourceParts.length === 0) {
        return;
      }

      const itemId = activeTurnId;
      const sourceText = joinTurnParts(sourceParts);
      const translatedText = joinTurnParts(translationParts);
      void logRuntimeEvent("recognition.turn.final", {
        turnId: itemId,
        sourceText,
        translatedText,
      });
      activeTurnId = "";
      sourceParts = [];
      translationParts = [];

      sendJson(browserSocket, { type: "source.final", itemId, text: sourceText });
      if (translatedText) {
        sendJson(browserSocket, {
          type: "translation.final",
          itemId,
          text: translatedText,
        });
      }

      startKnowledgeRetrieval(itemId, sourceText);
    }

    /** Starts the silence window after which the next ASR item becomes a new row. */
    function scheduleTurnFlush() {
      clearTurnFlushTimer();
      turnFlushTimer = setTimeout(flushTurn, turnGapMs);
    }

    /** Normalizes Alibaba Cloud events into the small browser-facing protocol. */
    function handleUpstreamEvent(event: AliyunEvent) {
      switch (event.type) {
        case "session.created":
          void logRuntimeEvent("session.cloud_connected");
          sendJson(browserSocket, { type: "session.cloud_connected" });
          break;
        case "session.updated":
          isUpstreamReady = true;
          void logRuntimeEvent("session.ready");
          sendJson(browserSocket, { type: "session.ready", mode });
          while (queuedAudio.length > 0) {
            sendAudio(queuedAudio.shift()!);
          }
          break;
        case "input_audio_buffer.speech_started":
          clearTurnFlushTimer();
          void logRuntimeEvent("speech.started", { turnId: activeTurnId || undefined });
          sendJson(browserSocket, { type: "speech.started" });
          break;
        case "input_audio_buffer.speech_stopped":
          void logRuntimeEvent("speech.stopped", { turnId: activeTurnId || undefined });
          sendJson(browserSocket, { type: "speech.stopped" });
          if (sourceParts.length > 0) {
            scheduleTurnFlush();
          }
          break;
        case "conversation.item.created":
          if (
            mode === RealtimeMode.Translation &&
            event.item?.role === "assistant" &&
            event.item.id &&
            event.previous_item_id
          ) {
            translationToSource.set(event.item.id, event.previous_item_id);
          }
          break;
        case "conversation.item.input_audio_transcription.text":
          if (event.item_id) {
            clearTurnFlushTimer();
            const itemId = getTurnId(event.item_id);
            const sourceText = joinTurnParts([
              ...sourceParts,
              `${event.text ?? ""}${event.stash ?? ""}`,
            ]);
            sendJson(browserSocket, {
              type: "source.partial",
              itemId,
              text: sourceText,
            });
            void logRuntimeEvent("recognition.partial", {
              sourceItemId: event.item_id,
              turnId: itemId,
              text: sourceText,
            });
            scheduleProgressiveKnowledge(itemId, sourceText);
          }
          break;
        case "conversation.item.input_audio_transcription.completed":
          if (event.item_id && event.transcript) {
            const itemId = getTurnId(event.item_id);
            sourceParts.push(event.transcript);
            const sourceText = joinTurnParts(sourceParts);
            sendJson(browserSocket, {
              type: "source.partial",
              itemId,
              text: sourceText,
            });
            void logRuntimeEvent("recognition.segment.completed", {
              sourceItemId: event.item_id,
              turnId: itemId,
              transcript: event.transcript,
              mergedText: sourceText,
            });
            clearProgressiveSearchTimer();
            startKnowledgeRetrieval(itemId, sourceText);
            scheduleTurnFlush();
          }
          break;
        case "response.text.text": {
          if (mode !== RealtimeMode.Translation) {
            break;
          }
          const sourceItemId = event.item_id && translationToSource.get(event.item_id);
          const itemId = (sourceItemId && sourceToTurn.get(sourceItemId)) || activeTurnId;
          const translatedText = joinTurnParts([
            ...translationParts,
            `${event.text ?? ""}${event.stash ?? ""}`,
          ]);
          sendJson(browserSocket, {
            type: "translation.partial",
            itemId,
            text: translatedText,
          });
          void logRuntimeEvent("translation.partial", {
            translationItemId: event.item_id,
            sourceItemId,
            turnId: itemId,
            text: translatedText,
          });
          break;
        }
        case "response.text.done": {
          if (mode !== RealtimeMode.Translation) {
            break;
          }
          const sourceItemId = event.item_id && translationToSource.get(event.item_id);
          const itemId = (sourceItemId && sourceToTurn.get(sourceItemId)) || activeTurnId;
          if (event.text) {
            translationParts.push(event.text);
          }
          const translatedText = joinTurnParts(translationParts);
          sendJson(browserSocket, {
            type: "translation.partial",
            itemId,
            text: translatedText,
          });
          void logRuntimeEvent("translation.segment.completed", {
            translationItemId: event.item_id,
            sourceItemId,
            turnId: itemId,
            text: event.text ?? "",
            mergedText: translatedText,
          });
          if (sourceParts.length > 0) {
            scheduleTurnFlush();
          }
          break;
        }
        case "error": {
          const message = event.error?.message ?? "阿里云实时语音服务返回错误。";
          void logRuntimeEvent("session.upstream_error", {
            code: event.error?.code,
            message,
          });
          sendJson(browserSocket, {
            type: "session.error",
            message,
          });
          break;
        }
        case "session.finished":
          flushTurn();
          void Promise.allSettled([...pendingRetrievals]).then(async () => {
            await logRuntimeEvent("session.finished");
            await Promise.allSettled([...pendingRuntimeLogs]);
            sendJson(browserSocket, { type: "session.finished" });
            upstreamSocket.close();
          });
          break;
      }
    }

    upstreamSocket.on("open", () => {
      void logRuntimeEvent("session.upstream_opened");
      upstreamSocket.send(JSON.stringify(createSessionUpdate(mode)));
    });
    upstreamSocket.on("message", (data) => {
      try {
        handleUpstreamEvent(JSON.parse(data.toString()) as AliyunEvent);
      } catch {
        void logRuntimeEvent("session.protocol_error", {
          message: "无法解析阿里云实时语音响应。",
        });
        sendJson(browserSocket, {
          type: "session.error",
          message: "无法解析阿里云实时语音响应。",
        });
      }
    });
    upstreamSocket.on("error", (error) => {
      void logRuntimeEvent("session.socket_error", { message: error.message });
      sendJson(browserSocket, { type: "session.error", message: error.message });
    });
    upstreamSocket.on("close", () => {
      if (!isFinishing) {
        void logRuntimeEvent("session.disconnected", { side: "upstream" });
        sendJson(browserSocket, { type: "session.disconnected" });
      }
    });

    browserSocket.on("message", (data, isBinary) => {
      if (isBinary) {
        sendAudio(Buffer.from(data as Buffer));
        return;
      }
      try {
        const event = JSON.parse(data.toString()) as ClientEvent;
        if (event.type === "session.finish" && upstreamSocket.readyState === WebSocket.OPEN) {
          isFinishing = true;
          void logRuntimeEvent("session.finish_requested");
          upstreamSocket.send(
            JSON.stringify({
              event_id: `event_${randomUUID().replaceAll("-", "")}`,
              type: "session.finish",
            }),
          );
        }
      } catch {
        void logRuntimeEvent("session.protocol_error", {
          message: "浏览器消息格式错误。",
        });
        sendJson(browserSocket, { type: "session.error", message: "浏览器消息格式错误。" });
      }
    });
    browserSocket.on("close", () => {
      clearTurnFlushTimer();
      clearProgressiveSearchTimer();
      void logRuntimeEvent("session.browser_disconnected", {
        wasFinishing: isFinishing,
      });
      if (upstreamSocket.readyState === WebSocket.OPEN) {
        upstreamSocket.close();
      }
    });
  });

  return socketServer;
}

/** Rejects cross-site WebSocket attempts so local API credentials cannot be abused by web pages. */
export function isAllowedBrowserOrigin(origin: string | undefined) {
  if (!origin) {
    return true;
  }

  try {
    const value = new URL(origin);
    const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(value.hostname);
    const isKnownPort = ["5173", String(config.PORT)].includes(value.port);
    return value.protocol === "http:" && isLoopback && isKnownPort;
  } catch {
    return false;
  }
}

/** Accepts only the dedicated realtime endpoint during an HTTP upgrade. */
export function handleRealtimeUpgrade(
  socketServer: WebSocketServer,
  request: IncomingMessage,
  socket: import("node:stream").Duplex,
  head: Buffer,
) {
  const requestUrl = new URL(request.url ?? "/", "http://localhost");
  const mode = parseRealtimeMode(requestUrl.searchParams.get("mode"));
  if (
    requestUrl.pathname !== "/api/realtime" ||
    !mode ||
    !isAllowedBrowserOrigin(request.headers.origin)
  ) {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  socketServer.handleUpgrade(request, socket, head, (webSocket) => {
    socketServer.emit("connection", webSocket, request);
  });
}
