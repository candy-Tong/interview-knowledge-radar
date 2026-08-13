import { createServer, type Server } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import type { RuntimeLogEntry } from "../runtime-log.js";
import {
  createRealtimeWebSocketServer,
  handleRealtimeUpgrade,
  isAllowedBrowserOrigin,
  stabilizeQuestionTexts,
} from "./translation-proxy.js";

type JsonEvent = {
  type?: string;
  audio?: string;
  itemId?: string;
  questionId?: string;
  text?: string;
  query?: string;
  isFinal?: boolean;
  mode?: string;
  questions?: Array<{ id: string; text: string; isFinal: boolean }>;
  results?: Array<{ sourceName?: string }>;
  session?: Record<string, unknown>;
};

const openServers: Server[] = [];
const openSockets: WebSocket[] = [];

/** Starts an HTTP server on an ephemeral loopback port. */
async function listen(server: Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  openServers.push(server);
  return (server.address() as AddressInfo).port;
}

/** Waits for one JSON event matching a predicate. */
function waitForEvent(socket: WebSocket, predicate: (event: JsonEvent) => boolean) {
  return new Promise<JsonEvent>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for event")), 3_000);
    function handleMessage(data: WebSocket.RawData) {
      const event = JSON.parse(data.toString()) as JsonEvent;
      if (predicate(event)) {
        clearTimeout(timer);
        socket.off("message", handleMessage);
        resolve(event);
      }
    }
    socket.on("message", handleMessage);
  });
}

afterEach(async () => {
  for (const socket of openSockets.splice(0)) {
    socket.close();
  }
  for (const server of openServers.splice(0)) {
    server.close();
    await once(server, "close");
  }
});

describe("isAllowedBrowserOrigin", () => {
  it("allows only known localhost origins", () => {
    expect(isAllowedBrowserOrigin("http://localhost:5173")).toBe(true);
    expect(isAllowedBrowserOrigin("http://127.0.0.1:8787")).toBe(true);
    expect(isAllowedBrowserOrigin("https://attacker.example")).toBe(false);
    expect(isAllowedBrowserOrigin("not a url")).toBe(false);
  });
});

describe("stabilizeQuestionTexts", () => {
  it("keeps completed draft questions while the trailing question changes", () => {
    expect(stabilizeQuestionTexts(
      {
        questions: ["Introduce yourself.", "Explain your agent."],
        usedFallback: false,
      },
      {
        questions: ["Please introduce yourself.", "Explain your complaint agent."],
        usedFallback: false,
      },
      false,
    )).toEqual(["Introduce yourself.", "Explain your complaint agent."]);
  });

  it("accepts the complete final split", () => {
    expect(stabilizeQuestionTexts(
      {
        questions: ["Introduce yourself.", "Explain your agent."],
        usedFallback: false,
      },
      {
        questions: ["Please introduce yourself.", "Explain your complaint agent."],
        usedFallback: false,
      },
      true,
    )).toEqual(["Please introduce yourself.", "Explain your complaint agent."]);
  });
});

describe("translation proxy", () => {
  it("rejects unsupported realtime modes before creating an upstream session", async () => {
    const proxyHttpServer = createServer();
    const proxyServer = createRealtimeWebSocketServer({
      upstreamUrl: "ws://127.0.0.1:1",
      apiKey: "test-key",
    });
    proxyHttpServer.on("upgrade", (request, socket, head) => {
      handleRealtimeUpgrade(proxyServer, request, socket, head);
    });
    const proxyPort = await listen(proxyHttpServer);
    const browserSocket = new WebSocket(
      `ws://127.0.0.1:${proxyPort}/api/realtime?mode=unsupported`,
      { headers: { Origin: "http://localhost:5173" } },
    );
    openSockets.push(browserSocket);

    const statusCode = await new Promise<number>((resolve, reject) => {
      browserSocket.once("unexpected-response", (_request, response) => {
        resolve(response.statusCode ?? 0);
      });
      browserSocket.once("error", reject);
    });

    expect(statusCode).toBe(403);
  });

  it("bridges PCM, transcript, translation, retrieval, and graceful finish", async () => {
    const upstreamHttpServer = createServer();
    const upstreamServer = new WebSocketServer({ server: upstreamHttpServer });
    const upstreamPort = await listen(upstreamHttpServer);
    let receivedAudio = "";
    let requestedKnowledgeLimit = 0;
    let requestedKnowledgeQuery = "";
    let knowledgeSearchCalls = 0;
    let receivedSession: Record<string, unknown> | undefined;
    let upstreamSocket: WebSocket | undefined;
    const runtimeLogEntries: RuntimeLogEntry[] = [];

    upstreamServer.on("connection", (socket) => {
      upstreamSocket = socket;
      openSockets.push(socket);
      socket.on("message", (data) => {
        const event = JSON.parse(data.toString()) as JsonEvent;
        if (event.type === "session.update") {
          receivedSession = event.session;
          socket.send(JSON.stringify({ type: "session.created" }));
          socket.send(JSON.stringify({ type: "session.updated" }));
          return;
        }
        if (event.type === "input_audio_buffer.append") {
          receivedAudio = event.audio ?? "";
          socket.send(JSON.stringify({ type: "input_audio_buffer.speech_started" }));
          socket.send(
            JSON.stringify({
              type: "conversation.item.input_audio_transcription.text",
              item_id: "source-1",
              text: "Tell me about ",
              stash: "your monorepo",
            }),
          );
          return;
        }
        if (event.type === "session.finish") {
          socket.send(JSON.stringify({ type: "session.finished" }));
        }
      });
    });

    const proxyHttpServer = createServer();
    const proxyServer = createRealtimeWebSocketServer({
      upstreamUrl: `ws://127.0.0.1:${upstreamPort}`,
      apiKey: "test-key",
      turnGapMs: 20,
      progressiveSearchIntervalMs: 0,
      runtimeLog: async (entry) => {
        runtimeLogEntries.push(entry);
      },
      search: async (query, limit) => {
        knowledgeSearchCalls += 1;
        requestedKnowledgeQuery = query;
        requestedKnowledgeLimit = limit ?? 0;
        return [
          {
            id: "chunk-1",
            sourceName: "大仓-英文版本.md",
            heading: "Monorepo",
            content: "I am the frontend monorepo owner.",
            bm25Score: 2,
            vectorScore: 0.8,
            hybridScore: 0.02,
            focusStart: 0,
            focusEnd: 0,
          },
        ];
      },
    });
    proxyHttpServer.on("upgrade", (request, socket, head) => {
      handleRealtimeUpgrade(proxyServer, request, socket, head);
    });
    const proxyPort = await listen(proxyHttpServer);
    const browserSocket = new WebSocket(
      `ws://127.0.0.1:${proxyPort}/api/realtime?mode=translation`,
      { headers: { Origin: "http://localhost:5173" } },
    );
    openSockets.push(browserSocket);
    await once(browserSocket, "open");

    const receivedBrowserEvents: JsonEvent[] = [];
    browserSocket.on("message", (data) => {
      receivedBrowserEvents.push(JSON.parse(data.toString()) as JsonEvent);
    });
    const ready = waitForEvent(browserSocket, (event) => event.type === "session.ready");
    const progressiveKnowledge = waitForEvent(
      browserSocket,
      (event) =>
        event.type === "knowledge.results" &&
        event.query === "Tell me about your monorepo",
    );
    browserSocket.send(Buffer.from([1, 2, 3, 4]));

    await expect(ready).resolves.toMatchObject({
      type: "session.ready",
      mode: "translation",
    });
    await expect(progressiveKnowledge).resolves.toMatchObject({
      itemId: "turn_source-1",
      query: "Tell me about your monorepo",
      results: [{ sourceName: "大仓-英文版本.md" }],
    });
    expect(
      receivedBrowserEvents.some((event) =>
        ["source.final", "translation.final"].includes(event.type ?? ""),
      ),
    ).toBe(false);

    const source = waitForEvent(browserSocket, (event) => event.type === "source.final");
    const translation = waitForEvent(
      browserSocket,
      (event) => event.type === "translation.final",
    );
    const finalKnowledge = waitForEvent(
      browserSocket,
      (event) =>
        event.type === "knowledge.results" &&
        event.query === "Tell me about your monorepo and the main result",
    );
    upstreamSocket?.send(
      JSON.stringify({
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "source-1",
        transcript: "Tell me about your monorepo",
      }),
    );
    upstreamSocket?.send(
      JSON.stringify({
        type: "conversation.item.created",
        previous_item_id: "source-1",
        item: { id: "translation-1", role: "assistant" },
      }),
    );
    upstreamSocket?.send(
      JSON.stringify({
        type: "response.text.text",
        item_id: "translation-1",
        text: "请介绍",
        stash: "你的大仓项目",
      }),
    );
    upstreamSocket?.send(
      JSON.stringify({
        type: "response.text.done",
        item_id: "translation-1",
        text: "请介绍你的大仓项目",
      }),
    );
    upstreamSocket?.send(
      JSON.stringify({
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "source-2",
        transcript: "and the main result",
      }),
    );
    upstreamSocket?.send(
      JSON.stringify({
        type: "conversation.item.created",
        previous_item_id: "source-2",
        item: { id: "translation-2", role: "assistant" },
      }),
    );
    upstreamSocket?.send(
      JSON.stringify({
        type: "response.text.done",
        item_id: "translation-2",
        text: "以及主要结果",
      }),
    );

    await expect(source).resolves.toMatchObject({
      itemId: "turn_source-1",
      text: "Tell me about your monorepo and the main result",
    });
    await expect(translation).resolves.toMatchObject({
      itemId: "turn_source-1",
      text: "请介绍你的大仓项目 以及主要结果",
    });
    await expect(finalKnowledge).resolves.toMatchObject({
      itemId: "turn_source-1",
      query: "Tell me about your monorepo and the main result",
      results: [{ sourceName: "大仓-英文版本.md" }],
    });
    expect(requestedKnowledgeLimit).toBe(2);
    expect(requestedKnowledgeQuery).toBe("Tell me about your monorepo and the main result");
    expect(knowledgeSearchCalls).toBe(3);
    expect(Buffer.from(receivedAudio, "base64")).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(receivedSession).toMatchObject({
      modalities: ["text"],
      input_audio_transcription: {
        model: "qwen3-asr-flash-realtime",
        language: "en",
      },
      translation: { language: "zh" },
    });

    const finished = waitForEvent(browserSocket, (event) => event.type === "session.finished");
    browserSocket.send(JSON.stringify({ type: "session.finish" }));
    await expect(finished).resolves.toMatchObject({ type: "session.finished" });
    expect(runtimeLogEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "recognition.partial",
          turnId: "turn_source-1",
          text: "Tell me about your monorepo",
        }),
        expect.objectContaining({
          event: "recognition.segment.completed",
          turnId: "turn_source-1",
          transcript: "Tell me about your monorepo",
        }),
        expect.objectContaining({
          event: "recognition.turn.final",
          turnId: "turn_source-1",
          sourceText: "Tell me about your monorepo and the main result",
          translatedText: "请介绍你的大仓项目 以及主要结果",
        }),
        expect.objectContaining({
          event: "knowledge.retrieval.completed",
          turnId: "turn_source-1",
          query: "Tell me about your monorepo and the main result",
          results: [
            expect.objectContaining({
              rank: 1,
              sourceName: "大仓-英文版本.md",
              heading: "Monorepo",
            }),
          ],
        }),
        expect.objectContaining({ event: "session.finished" }),
        expect.objectContaining({
          event: "question.split.completed",
          turnId: "turn_source-1",
        }),
      ]),
    );
  });

  it("suppresses stale progressive results when a newer partial query finishes first", async () => {
    const upstreamHttpServer = createServer();
    const upstreamServer = new WebSocketServer({ server: upstreamHttpServer });
    const upstreamPort = await listen(upstreamHttpServer);
    let releaseFirstSearch: () => void = () => undefined;
    const firstSearchBlocked = new Promise<void>((resolve) => {
      releaseFirstSearch = resolve;
    });

    upstreamServer.on("connection", (socket) => {
      openSockets.push(socket);
      socket.on("message", (data) => {
        const event = JSON.parse(data.toString()) as JsonEvent;
        if (event.type === "session.update") {
          socket.send(JSON.stringify({ type: "session.updated" }));
          return;
        }
        if (event.type === "input_audio_buffer.append") {
          socket.send(
            JSON.stringify({
              type: "conversation.item.input_audio_transcription.text",
              item_id: "source-stale",
              text: "Tell me about monorepo",
            }),
          );
          socket.send(
            JSON.stringify({
              type: "conversation.item.input_audio_transcription.text",
              item_id: "source-stale",
              text: "Tell me about monorepo ownership",
            }),
          );
        }
      });
    });

    const proxyHttpServer = createServer();
    const proxyServer = createRealtimeWebSocketServer({
      upstreamUrl: `ws://127.0.0.1:${upstreamPort}`,
      apiKey: "test-key",
      progressiveSearchIntervalMs: 0,
      search: async (query) => {
        if (query === "Tell me about monorepo") {
          await firstSearchBlocked;
        }
        return [
          {
            id: query,
            sourceName: `${query}.md`,
            heading: query,
            content: query,
            bm25Score: 1,
            vectorScore: 1,
            hybridScore: 1,
            focusStart: 0,
            focusEnd: 0,
          },
        ];
      },
    });
    proxyHttpServer.on("upgrade", (request, socket, head) => {
      handleRealtimeUpgrade(proxyServer, request, socket, head);
    });
    const proxyPort = await listen(proxyHttpServer);
    const browserSocket = new WebSocket(
      `ws://127.0.0.1:${proxyPort}/api/realtime?mode=translation`,
      { headers: { Origin: "http://localhost:5173" } },
    );
    openSockets.push(browserSocket);
    await once(browserSocket, "open");

    const receivedBrowserEvents: JsonEvent[] = [];
    browserSocket.on("message", (data) => {
      receivedBrowserEvents.push(JSON.parse(data.toString()) as JsonEvent);
    });
    const latestKnowledge = waitForEvent(
      browserSocket,
      (event) =>
        event.type === "knowledge.results" &&
        event.query === "Tell me about monorepo ownership",
    );
    browserSocket.send(Buffer.from([9, 10]));

    await expect(latestKnowledge).resolves.toMatchObject({
      query: "Tell me about monorepo ownership",
    });
    releaseFirstSearch();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(
      receivedBrowserEvents.some(
        (event) =>
          event.type === "knowledge.results" && event.query === "Tell me about monorepo",
      ),
    ).toBe(false);
  });

  it("coalesces rapid partial transcripts without overlapping question split calls", async () => {
    const upstreamHttpServer = createServer();
    const upstreamServer = new WebSocketServer({ server: upstreamHttpServer });
    const upstreamPort = await listen(upstreamHttpServer);
    let releaseFirstSplit: () => void = () => undefined;
    const firstSplitBlocked = new Promise<void>((resolve) => {
      releaseFirstSplit = resolve;
    });
    let markFirstSplitStarted: () => void = () => undefined;
    const firstSplitStarted = new Promise<void>((resolve) => {
      markFirstSplitStarted = resolve;
    });
    const splitCalls: string[] = [];
    let activeSplitCalls = 0;
    let maximumActiveSplitCalls = 0;

    upstreamServer.on("connection", (socket) => {
      openSockets.push(socket);
      socket.on("message", (data) => {
        const event = JSON.parse(data.toString()) as JsonEvent;
        if (event.type === "session.update") {
          socket.send(JSON.stringify({ type: "session.updated" }));
          return;
        }
        if (event.type === "input_audio_buffer.append") {
          for (const text of [
            "Explain your frontend leadership",
            "Explain your frontend leadership and complaint agent",
            "Explain your frontend leadership and complaint agent impact",
          ]) {
            socket.send(JSON.stringify({
              type: "conversation.item.input_audio_transcription.text",
              item_id: "source-coalesced",
              text,
            }));
          }
        }
      });
    });

    const proxyHttpServer = createServer();
    const proxyServer = createRealtimeWebSocketServer({
      upstreamUrl: `ws://127.0.0.1:${upstreamPort}`,
      apiKey: "test-key",
      progressiveSearchIntervalMs: 0,
      draftSearch: async () => [],
      splitQuestions: async (transcript) => {
        splitCalls.push(transcript);
        activeSplitCalls += 1;
        maximumActiveSplitCalls = Math.max(maximumActiveSplitCalls, activeSplitCalls);
        try {
          if (splitCalls.length === 1) {
            markFirstSplitStarted();
            await firstSplitBlocked;
          }
          return { questions: [transcript], usedFallback: false };
        } finally {
          activeSplitCalls -= 1;
        }
      },
    });
    proxyHttpServer.on("upgrade", (request, socket, head) => {
      handleRealtimeUpgrade(proxyServer, request, socket, head);
    });
    const proxyPort = await listen(proxyHttpServer);
    const browserSocket = new WebSocket(
      `ws://127.0.0.1:${proxyPort}/api/realtime?mode=translation`,
      { headers: { Origin: "http://localhost:5173" } },
    );
    openSockets.push(browserSocket);
    await once(browserSocket, "open");

    const latestQuestions = waitForEvent(
      browserSocket,
      (event) =>
        event.type === "questions.updated" &&
        event.questions?.[0]?.text ===
          "Explain your frontend leadership and complaint agent impact",
    );
    browserSocket.send(Buffer.from([11, 12]));

    try {
      await firstSplitStarted;
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(maximumActiveSplitCalls).toBe(1);
    } finally {
      releaseFirstSplit();
    }

    await expect(latestQuestions).resolves.toBeDefined();
    expect(splitCalls).toEqual([
      "Explain your frontend leadership",
      "Explain your frontend leadership and complaint agent impact",
    ]);
    expect(maximumActiveSplitCalls).toBe(1);
  });

  it("preempts an active draft split when the turn becomes final", async () => {
    const upstreamHttpServer = createServer();
    const upstreamServer = new WebSocketServer({ server: upstreamHttpServer });
    const upstreamPort = await listen(upstreamHttpServer);
    let releaseDraft: () => void = () => undefined;
    const draftBlocked = new Promise<void>((resolve) => {
      releaseDraft = resolve;
    });
    let draftWasAborted = false;
    let splitCallCount = 0;
    let activeSplitCalls = 0;
    let maximumActiveSplitCalls = 0;

    upstreamServer.on("connection", (socket) => {
      openSockets.push(socket);
      socket.on("message", (data) => {
        const event = JSON.parse(data.toString()) as JsonEvent;
        if (event.type === "session.update") {
          socket.send(JSON.stringify({ type: "session.updated" }));
          return;
        }
        if (event.type === "input_audio_buffer.append") {
          socket.send(JSON.stringify({
            type: "conversation.item.input_audio_transcription.text",
            item_id: "source-final-priority",
            text: "Explain your frontend leadership and complaint agent",
          }));
          socket.send(JSON.stringify({
            type: "conversation.item.input_audio_transcription.completed",
            item_id: "source-final-priority",
            transcript: "Explain your frontend leadership and complaint agent",
          }));
          socket.send(JSON.stringify({ type: "input_audio_buffer.speech_stopped" }));
        }
      });
    });

    const proxyHttpServer = createServer();
    const proxyServer = createRealtimeWebSocketServer({
      upstreamUrl: `ws://127.0.0.1:${upstreamPort}`,
      apiKey: "test-key",
      turnGapMs: 10,
      progressiveSearchIntervalMs: 0,
      draftSearch: async () => [],
      search: async () => [],
      splitQuestions: async (transcript, signal?: AbortSignal) => {
        splitCallCount += 1;
        activeSplitCalls += 1;
        maximumActiveSplitCalls = Math.max(maximumActiveSplitCalls, activeSplitCalls);
        try {
          if (splitCallCount === 1) {
            await Promise.race([
              draftBlocked,
              new Promise<never>((_resolve, reject) => {
                signal?.addEventListener("abort", () => {
                  draftWasAborted = true;
                  reject(new DOMException("Aborted", "AbortError"));
                }, { once: true });
              }),
            ]);
          }
          return { questions: [transcript], usedFallback: false };
        } finally {
          activeSplitCalls -= 1;
        }
      },
    });
    proxyHttpServer.on("upgrade", (request, socket, head) => {
      handleRealtimeUpgrade(proxyServer, request, socket, head);
    });
    const proxyPort = await listen(proxyHttpServer);
    const browserSocket = new WebSocket(
      `ws://127.0.0.1:${proxyPort}/api/realtime?mode=translation`,
      { headers: { Origin: "http://localhost:5173" } },
    );
    openSockets.push(browserSocket);
    await once(browserSocket, "open");

    const receivedBrowserEvents: JsonEvent[] = [];
    browserSocket.on("message", (data) => {
      receivedBrowserEvents.push(JSON.parse(data.toString()) as JsonEvent);
    });
    const finalQuestions = waitForEvent(
      browserSocket,
      (event) =>
        event.type === "questions.updated" &&
        event.questions?.every((question) => question.isFinal) === true,
    );
    browserSocket.send(Buffer.from([13, 14]));

    try {
      await expect(finalQuestions).resolves.toBeDefined();
      expect(draftWasAborted).toBe(true);
      expect(maximumActiveSplitCalls).toBe(1);
      expect(
        receivedBrowserEvents.some(
          (event) =>
            event.type === "questions.updated" &&
            event.questions?.some((question) => question.isFinal === false),
        ),
      ).toBe(false);
    } finally {
      releaseDraft();
    }
  });

  it("uses standalone ASR and retrieves two knowledge sets for a compound turn", async () => {
    const upstreamHttpServer = createServer();
    const upstreamServer = new WebSocketServer({ server: upstreamHttpServer });
    const upstreamPort = await listen(upstreamHttpServer);
    let receivedSession: Record<string, unknown> | undefined;
    let receivedBetaHeader = "";
    const draftQueries: string[] = [];
    const finalQueries: string[] = [];

    upstreamServer.on("connection", (socket, request) => {
      openSockets.push(socket);
      receivedBetaHeader = String(request.headers["openai-beta"] ?? "");
      socket.on("message", (data) => {
        const event = JSON.parse(data.toString()) as JsonEvent;
        if (event.type === "session.update") {
          receivedSession = event.session;
          socket.send(JSON.stringify({ type: "session.created" }));
          socket.send(JSON.stringify({ type: "session.updated" }));
          return;
        }
        if (event.type === "input_audio_buffer.append") {
          socket.send(JSON.stringify({ type: "input_audio_buffer.speech_started" }));
          socket.send(
            JSON.stringify({
              type: "conversation.item.input_audio_transcription.text",
              item_id: "asr-1",
              text: "Please introduce yourself and explain",
              stash: " your complaint agent",
            }),
          );
          socket.send(
            JSON.stringify({
              type: "conversation.item.input_audio_transcription.completed",
              item_id: "asr-1",
              transcript: "Please introduce yourself and explain your complaint agent",
            }),
          );
          socket.send(JSON.stringify({ type: "input_audio_buffer.speech_stopped" }));
          return;
        }
        if (event.type === "session.finish") {
          socket.send(JSON.stringify({ type: "session.finished" }));
        }
      });
    });

    const proxyHttpServer = createServer();
    const proxyServer = createRealtimeWebSocketServer({
      upstreamUrl: `ws://127.0.0.1:${upstreamPort}`,
      apiKey: "test-key",
      turnGapMs: 20,
      draftSearch: async (query) => {
        draftQueries.push(query);
        return [];
      },
      search: async (query) => {
        finalQueries.push(query);
        return [];
      },
      splitQuestions: async () => ({
        questions: [
          "Please introduce yourself.",
          "Explain your complaint agent.",
        ],
        usedFallback: false,
      }),
    });
    proxyHttpServer.on("upgrade", (request, socket, head) => {
      handleRealtimeUpgrade(proxyServer, request, socket, head);
    });
    const proxyPort = await listen(proxyHttpServer);
    const browserSocket = new WebSocket(
      `ws://127.0.0.1:${proxyPort}/api/realtime?mode=transcription`,
      { headers: { Origin: "http://localhost:5173" } },
    );
    openSockets.push(browserSocket);
    await once(browserSocket, "open");

    const receivedBrowserEvents: JsonEvent[] = [];
    browserSocket.on("message", (data) => {
      receivedBrowserEvents.push(JSON.parse(data.toString()) as JsonEvent);
    });
    const ready = waitForEvent(browserSocket, (event) => event.type === "session.ready");
    const source = waitForEvent(browserSocket, (event) => event.type === "source.final");
    const questions = waitForEvent(
      browserSocket,
      (event) =>
        event.type === "questions.updated" &&
        event.questions?.every((question) => question.isFinal) === true,
    );
    const firstKnowledge = waitForEvent(
      browserSocket,
      (event) =>
        event.type === "question.knowledge.results" &&
        event.questionId === "turn_asr-1_q1" &&
        event.isFinal === true,
    );
    const secondKnowledge = waitForEvent(
      browserSocket,
      (event) =>
        event.type === "question.knowledge.results" &&
        event.questionId === "turn_asr-1_q2" &&
        event.isFinal === true,
    );
    browserSocket.send(Buffer.from([5, 6, 7, 8]));

    await expect(ready).resolves.toMatchObject({
      type: "session.ready",
      mode: "transcription",
    });
    await expect(source).resolves.toMatchObject({
      type: "source.final",
      text: "Please introduce yourself and explain your complaint agent",
    });
    await expect(questions).resolves.toMatchObject({
      questions: [
        { id: "turn_asr-1_q1", text: "Please introduce yourself." },
        { id: "turn_asr-1_q2", text: "Explain your complaint agent." },
      ],
    });
    await expect(firstKnowledge).resolves.toMatchObject({
      query: "Please introduce yourself.",
    });
    await expect(secondKnowledge).resolves.toMatchObject({
      query: "Explain your complaint agent.",
    });
    expect(draftQueries).toEqual([
      "Please introduce yourself.",
      "Explain your complaint agent.",
    ]);
    expect(finalQueries).toEqual([
      "Please introduce yourself.",
      "Explain your complaint agent.",
    ]);
    expect(receivedBetaHeader).toBe("realtime=v1");
    expect(receivedSession).toMatchObject({
      modalities: ["text"],
      input_audio_format: "pcm",
      sample_rate: 16000,
      turn_detection: {
        type: "server_vad",
        threshold: 0.2,
        silence_duration_ms: 800,
      },
    });
    expect(receivedSession).not.toHaveProperty("translation");
    expect(
      receivedBrowserEvents.some((event) => event.type?.startsWith("translation.")),
    ).toBe(false);

    const finished = waitForEvent(browserSocket, (event) => event.type === "session.finished");
    browserSocket.send(JSON.stringify({ type: "session.finish" }));
    await expect(finished).resolves.toMatchObject({ type: "session.finished" });
  });
});
