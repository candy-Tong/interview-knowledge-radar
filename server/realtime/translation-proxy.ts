import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import { config, getRealtimeWebSocketUrl } from "../config.js";
import {
  maximumKnowledgeResults,
  searchKnowledge,
  searchKnowledgeBm25,
} from "../knowledge/search.js";
import {
  type RuntimeLogEntry,
  type RuntimeLogWriter,
  writeRuntimeLog,
} from "../runtime-log.js";
import {
  type InterviewQuestion,
  type QuestionSplitInput,
  type QuestionSplitResult,
  splitInterviewQuestions,
} from "./question-splitter.js";

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
  draftSearch?: typeof searchKnowledgeBm25;
  splitQuestions?: (
    input: QuestionSplitInput,
    signal?: AbortSignal,
  ) => Promise<QuestionSplitResult>;
  turnGapMs?: number;
  progressiveSearchIntervalMs?: number;
  runtimeLog?: RuntimeLogWriter;
};

const maximumQueuedChunks = 250;
const defaultTurnGapMs = 5_000;
const defaultProgressiveSearchIntervalMs = 800;

type PendingQuestionAnalysis = {
  itemId: string;
  transcript: string;
  recentInterviewerTurns: string[];
  isFinal: boolean;
};

type QuestionAnalysisTask = PendingQuestionAnalysis & {
  controller: AbortController;
  version: number;
};

type QuestionState = {
  questions: InterviewQuestion[];
  usedFallback: boolean;
};

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

/** Keeps completed draft questions steady while allowing the trailing question to grow. */
export function stabilizeQuestions(
  previous: QuestionState | undefined,
  incoming: QuestionSplitResult,
  isFinal: boolean,
) {
  if (isFinal || !previous || previous.usedFallback || previous.questions.length <= 1) {
    return incoming.questions;
  }

  const stablePrefix = previous.questions.slice(0, -1);
  const incomingSuffix = incoming.questions.slice(stablePrefix.length);
  const trailingQuestions = incomingSuffix.length > 0
    ? incomingSuffix
    : incoming.questions.slice(-1);
  const questionsByText = new Map(
    [...stablePrefix, ...trailingQuestions].map((question) => [question.text, question]),
  );
  return [...questionsByText.values()];
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
    const draftSearch =
      options.draftSearch ?? (options.search ? options.search : searchKnowledgeBm25);
    const splitQuestions: (
      input: QuestionSplitInput,
      signal?: AbortSignal,
    ) => Promise<QuestionSplitResult> =
      options.splitQuestions ??
      (config.NODE_ENV === "test"
        ? async (input: QuestionSplitInput) => ({
            questions: [{
              text: input.transcript,
              retrievalQuery: input.transcript,
            }],
            usedFallback: true,
            fallbackReason: "test_default",
          })
        : splitInterviewQuestions);
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
    const pendingQuestionAnalyses = new Set<Promise<void>>();
    const pendingRuntimeLogs = new Set<Promise<void>>();
    const questionAnalysisVersionByTurn = new Map<string, number>();
    const activeQuestionAnalysisByTurn = new Map<string, QuestionAnalysisTask>();
    const queuedQuestionAnalysisByTurn = new Map<string, QuestionAnalysisTask>();
    const questionStateByTurn = new Map<string, QuestionState>();
    const lastQuestionAnalysisByTurn = new Map<string, string>();
    const lastQuestionAnalysisStartedAtByTurn = new Map<string, number>();
    const retrievalVersionByQuestion = new Map<string, number>();
    const lastRetrievalByQuestion = new Map<string, string>();
    const recentInterviewerTurns: string[] = [];
    let isUpstreamReady = false;
    let activeTurnId = "";
    let sourceParts: string[] = [];
    let translationParts: string[] = [];
    let turnFlushTimer: ReturnType<typeof setTimeout> | undefined;
    let progressiveSearchTimer: ReturnType<typeof setTimeout> | undefined;
    let pendingQuestionAnalysis: PendingQuestionAnalysis | undefined;
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

    /** Searches one split question while suppressing stale question revisions. */
    async function retrieveQuestionKnowledge(
      itemId: string,
      questionId: string,
      query: string,
      isFinal: boolean,
      version: number,
      startedAt: number,
    ) {
      try {
        const retrievalMode = isFinal ? "hybrid" : "bm25";
        const results = await (isFinal ? search : draftSearch)(query, maximumKnowledgeResults);
        if (retrievalVersionByQuestion.get(questionId) !== version) {
          void logRuntimeEvent("knowledge.retrieval.discarded", {
            turnId: itemId,
            questionId,
            query,
            retrievalMode,
            version,
            durationMs: Date.now() - startedAt,
            reason: "superseded",
          });
          return;
        }
        void logRuntimeEvent("knowledge.retrieval.completed", {
          turnId: itemId,
          questionId,
          query,
          retrievalMode,
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
          type: "question.knowledge.results",
          itemId,
          questionId,
          query,
          isFinal,
          results,
        });
        sendJson(browserSocket, {
          type: "knowledge.results",
          itemId,
          questionId,
          query,
          results,
        });
      } catch (error) {
        if (retrievalVersionByQuestion.get(questionId) !== version) {
          void logRuntimeEvent("knowledge.retrieval.discarded", {
            turnId: itemId,
            questionId,
            query,
            version,
            durationMs: Date.now() - startedAt,
            reason: "superseded_error",
          });
          return;
        }
        const message = error instanceof Error ? error.message : "知识库检索失败。";
        void logRuntimeEvent("knowledge.retrieval.failed", {
          turnId: itemId,
          questionId,
          query,
          version,
          durationMs: Date.now() - startedAt,
          message,
        });
        sendJson(browserSocket, {
          type: "question.knowledge.error",
          itemId,
          questionId,
          message,
        });
        sendJson(browserSocket, {
          type: "knowledge.error",
          itemId,
          questionId,
          message,
        });
      }
    }

    /** Starts one question-scoped retrieval and upgrades drafts to hybrid exactly once. */
    function startQuestionKnowledgeRetrieval(
      itemId: string,
      questionId: string,
      transcript: string,
      isFinal: boolean,
    ) {
      const query = transcript.trim().replace(/\s+/g, " ");
      const retrievalIdentity = `${isFinal ? "hybrid" : "bm25"}:${query}`;
      if (!query || lastRetrievalByQuestion.get(questionId) === retrievalIdentity) {
        return;
      }

      lastRetrievalByQuestion.set(questionId, retrievalIdentity);
      const version = (retrievalVersionByQuestion.get(questionId) ?? 0) + 1;
      retrievalVersionByQuestion.set(questionId, version);
      const startedAt = Date.now();
      void logRuntimeEvent("knowledge.retrieval.started", {
        turnId: itemId,
        questionId,
        query,
        retrievalMode: isFinal ? "hybrid" : "bm25",
        version,
        limit: maximumKnowledgeResults,
      });
      const retrieval = retrieveQuestionKnowledge(
        itemId,
        questionId,
        query,
        isFinal,
        version,
        startedAt,
      ).finally(() => pendingRetrievals.delete(retrieval));
      pendingRetrievals.add(retrieval);
    }

    /** Applies the latest split and starts one independent retrieval per question. */
    async function analyzeQuestions(
      task: QuestionAnalysisTask,
      startedAt: number,
    ) {
      const result = await splitQuestions({
        transcript: task.transcript,
        recentInterviewerTurns: task.recentInterviewerTurns,
      }, task.controller.signal);
      if (task.controller.signal.aborted) {
        throw new DOMException("Question analysis was superseded", "AbortError");
      }

      const previousState = questionStateByTurn.get(task.itemId);
      const resolvedQuestions = stabilizeQuestions(previousState, result, task.isFinal);
      questionStateByTurn.set(task.itemId, {
        questions: resolvedQuestions,
        usedFallback: result.usedFallback,
      });
      const questions = resolvedQuestions.map((question, index) => ({
        id: `${task.itemId}_q${index + 1}`,
        text: question.text,
        retrievalQuery: question.retrievalQuery,
        isFinal: task.isFinal,
      }));
      void logRuntimeEvent("question.split.completed", {
        turnId: task.itemId,
        transcript: task.transcript,
        version: task.version,
        isFinal: task.isFinal,
        usedFallback: result.usedFallback,
        fallbackReason: result.fallbackReason,
        durationMs: Date.now() - startedAt,
        questions,
      });
      sendJson(browserSocket, {
        type: "questions.updated",
        itemId: task.itemId,
        version: task.version,
        questions: questions.map(({ id, text, isFinal }) => ({ id, text, isFinal })),
      });
      for (const question of questions) {
        startQuestionKnowledgeRetrieval(
          task.itemId,
          question.id,
          question.retrievalQuery,
          task.isFinal,
        );
      }
    }

    /** Drains one turn's local-model work serially, consuming only its latest queued request. */
    async function runQuestionAnalysisQueue(initialTask: QuestionAnalysisTask) {
      let task: QuestionAnalysisTask | undefined = initialTask;
      while (task) {
        activeQuestionAnalysisByTurn.set(task.itemId, task);
        const startedAt = Date.now();
        void logRuntimeEvent("question.split.started", {
          turnId: task.itemId,
          transcript: task.transcript,
          version: task.version,
          isFinal: task.isFinal,
        });
        try {
          await analyzeQuestions(task, startedAt);
        } catch (error) {
          if (task.controller.signal.aborted) {
            void logRuntimeEvent("question.split.discarded", {
              turnId: task.itemId,
              transcript: task.transcript,
              version: task.version,
              durationMs: Date.now() - startedAt,
              reason: "final_priority",
            });
          } else {
            void logRuntimeEvent("question.split.failed", {
              turnId: task.itemId,
              transcript: task.transcript,
              version: task.version,
              message: error instanceof Error ? error.message : "问题拆分失败。",
            });
          }
        } finally {
          if (activeQuestionAnalysisByTurn.get(task.itemId) === task) {
            activeQuestionAnalysisByTurn.delete(task.itemId);
          }
        }

        const queuedTask = queuedQuestionAnalysisByTurn.get(task.itemId);
        if (queuedTask) {
          queuedQuestionAnalysisByTurn.delete(task.itemId);
        }
        task = queuedTask;
      }
    }

    /** Coalesces progressive transcripts so one turn never overlaps local-model calls. */
    function startQuestionAnalysis(request: PendingQuestionAnalysis) {
      const transcript = request.transcript.trim().replace(/\s+/g, " ");
      const analysisIdentity = `${request.isFinal ? "final" : "draft"}:${transcript}`;
      if (!transcript || lastQuestionAnalysisByTurn.get(request.itemId) === analysisIdentity) {
        return;
      }
      lastQuestionAnalysisByTurn.set(request.itemId, analysisIdentity);
      lastQuestionAnalysisStartedAtByTurn.set(request.itemId, Date.now());
      const version = (questionAnalysisVersionByTurn.get(request.itemId) ?? 0) + 1;
      questionAnalysisVersionByTurn.set(request.itemId, version);
      const task: QuestionAnalysisTask = {
        ...request,
        transcript,
        version,
        controller: new AbortController(),
      };
      const activeTask = activeQuestionAnalysisByTurn.get(request.itemId);
      if (activeTask) {
        const queuedTask = queuedQuestionAnalysisByTurn.get(request.itemId);
        queuedQuestionAnalysisByTurn.set(request.itemId, task);
        void logRuntimeEvent("question.split.coalesced", {
          turnId: request.itemId,
          transcript,
          version,
          isFinal: request.isFinal,
          replacedVersion: queuedTask?.version,
        });
        if (request.isFinal && !activeTask.isFinal) {
          activeTask.controller.abort();
        }
        return;
      }

      const analysis = runQuestionAnalysisQueue(task)
        .finally(() => pendingQuestionAnalyses.delete(analysis));
      pendingQuestionAnalyses.add(analysis);
    }

    /** Cancels a queued partial analysis without affecting work already in flight. */
    function clearProgressiveSearchTimer() {
      if (progressiveSearchTimer) {
        clearTimeout(progressiveSearchTimer);
        progressiveSearchTimer = undefined;
      }
      pendingQuestionAnalysis = undefined;
    }

    /** Refreshes split questions during speech, capped to one local-model call per interval. */
    function scheduleProgressiveKnowledge(itemId: string, transcript: string) {
      const query = transcript.trim().replace(/\s+/g, " ");
      if (!isMeaningfulProgressiveQuery(query)) {
        clearProgressiveSearchTimer();
        return;
      }
      if (lastQuestionAnalysisByTurn.get(itemId) === `draft:${query}`) {
        clearProgressiveSearchTimer();
        return;
      }

      pendingQuestionAnalysis = {
        itemId,
        transcript: query,
        recentInterviewerTurns: [...recentInterviewerTurns],
        isFinal: false,
      };
      const elapsed = Date.now() - (lastQuestionAnalysisStartedAtByTurn.get(itemId) ?? 0);
      const waitMs = Math.max(0, progressiveSearchIntervalMs - elapsed);
      if (waitMs === 0) {
        const request = pendingQuestionAnalysis;
        clearProgressiveSearchTimer();
        startQuestionAnalysis(request);
        return;
      }
      if (!progressiveSearchTimer) {
        progressiveSearchTimer = setTimeout(() => {
          const request = pendingQuestionAnalysis;
          clearProgressiveSearchTimer();
          if (request) {
            startQuestionAnalysis(request);
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

    /** Publishes one merged turn and performs the final question split plus hybrid retrievals. */
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

      startQuestionAnalysis({
        itemId,
        transcript: sourceText,
        recentInterviewerTurns: [...recentInterviewerTurns],
        isFinal: true,
      });
      recentInterviewerTurns.push(sourceText);
      if (recentInterviewerTurns.length > 3) {
        recentInterviewerTurns.shift();
      }
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
            startQuestionAnalysis({
              itemId,
              transcript: sourceText,
              recentInterviewerTurns: [...recentInterviewerTurns],
              isFinal: false,
            });
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
          void Promise.allSettled([...pendingQuestionAnalyses]).then(async () => {
            await Promise.allSettled([...pendingRetrievals]);
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
      queuedQuestionAnalysisByTurn.clear();
      for (const task of activeQuestionAnalysisByTurn.values()) {
        task.controller.abort();
      }
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
