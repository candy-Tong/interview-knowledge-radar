import { createServer, type Server } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import {
  createRealtimeWebSocketServer,
  handleRealtimeUpgrade,
  isAllowedBrowserOrigin,
} from "./translation-proxy.js";

type JsonEvent = {
  type?: string;
  audio?: string;
  itemId?: string;
  text?: string;
  mode?: string;
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

    upstreamServer.on("connection", (socket) => {
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
          socket.send(
            JSON.stringify({
              type: "conversation.item.input_audio_transcription.completed",
              item_id: "source-1",
              transcript: "Tell me about your monorepo",
            }),
          );
          socket.send(
            JSON.stringify({
              type: "conversation.item.created",
              previous_item_id: "source-1",
              item: { id: "translation-1", role: "assistant" },
            }),
          );
          socket.send(
            JSON.stringify({
              type: "response.text.text",
              item_id: "translation-1",
              text: "请介绍",
              stash: "你的大仓项目",
            }),
          );
          socket.send(
            JSON.stringify({
              type: "response.text.done",
              item_id: "translation-1",
              text: "请介绍你的大仓项目",
            }),
          );
          socket.send(
            JSON.stringify({
              type: "conversation.item.input_audio_transcription.completed",
              item_id: "source-2",
              transcript: "and the main result",
            }),
          );
          socket.send(
            JSON.stringify({
              type: "conversation.item.created",
              previous_item_id: "source-2",
              item: { id: "translation-2", role: "assistant" },
            }),
          );
          socket.send(
            JSON.stringify({
              type: "response.text.done",
              item_id: "translation-2",
              text: "以及主要结果",
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

    const ready = waitForEvent(browserSocket, (event) => event.type === "session.ready");
    const source = waitForEvent(browserSocket, (event) => event.type === "source.final");
    const translation = waitForEvent(
      browserSocket,
      (event) => event.type === "translation.final",
    );
    const knowledge = waitForEvent(
      browserSocket,
      (event) => event.type === "knowledge.results",
    );
    browserSocket.send(Buffer.from([1, 2, 3, 4]));

    await expect(ready).resolves.toMatchObject({
      type: "session.ready",
      mode: "translation",
    });
    await expect(source).resolves.toMatchObject({
      itemId: "turn_source-1",
      text: "Tell me about your monorepo and the main result",
    });
    await expect(translation).resolves.toMatchObject({
      itemId: "turn_source-1",
      text: "请介绍你的大仓项目 以及主要结果",
    });
    await expect(knowledge).resolves.toMatchObject({
      itemId: "turn_source-1",
      results: [{ sourceName: "大仓-英文版本.md" }],
    });
    expect(requestedKnowledgeLimit).toBe(2);
    expect(requestedKnowledgeQuery).toBe("Tell me about your monorepo and the main result");
    expect(knowledgeSearchCalls).toBe(1);
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
  });

  it("uses the standalone ASR session in transcription mode without translation", async () => {
    const upstreamHttpServer = createServer();
    const upstreamServer = new WebSocketServer({ server: upstreamHttpServer });
    const upstreamPort = await listen(upstreamHttpServer);
    let receivedSession: Record<string, unknown> | undefined;
    let receivedBetaHeader = "";
    let knowledgeSearchCalls = 0;

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
              text: "请介绍你的",
              stash: "项目",
            }),
          );
          socket.send(
            JSON.stringify({
              type: "conversation.item.input_audio_transcription.completed",
              item_id: "asr-1",
              transcript: "请介绍你的项目",
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
      search: async () => {
        knowledgeSearchCalls += 1;
        return [];
      },
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
    const knowledge = waitForEvent(
      browserSocket,
      (event) => event.type === "knowledge.results",
    );
    browserSocket.send(Buffer.from([5, 6, 7, 8]));

    await expect(ready).resolves.toMatchObject({
      type: "session.ready",
      mode: "transcription",
    });
    await expect(source).resolves.toMatchObject({
      type: "source.final",
      text: "请介绍你的项目",
    });
    await expect(knowledge).resolves.toMatchObject({ type: "knowledge.results" });
    expect(knowledgeSearchCalls).toBe(1);
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
