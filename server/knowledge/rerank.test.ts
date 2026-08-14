import { afterEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeResult } from "./search.js";
import {
  createKnowledgeRerankScheduler,
  RerankPriority,
  rerankKnowledgeCandidates,
} from "./rerank.js";

/** Creates a complete retrieval candidate for rerank boundary tests. */
function candidate(id: string, content = `Knowledge ${id}`): KnowledgeResult {
  return {
    id,
    sourceName: `${id}.md`,
    heading: id,
    content,
    bm25Score: 1,
    vectorScore: 0.5,
    hybridScore: 0.1,
    focusStart: 0,
    focusEnd: content.length,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("rerankKnowledgeCandidates", () => {
  it("returns the model-ranked top two without changing complete knowledge content", async () => {
    const candidates = [candidate("a"), candidate("b"), candidate("c")];
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      results: [
        { index: 2, relevance_score: 0.96 },
        { index: 0, relevance_score: 0.72 },
      ],
      usage: { total_tokens: 42 },
    }), { status: 200 }));

    const results = await rerankKnowledgeCandidates(
      "Which knowledge answers this question?",
      candidates,
      2,
      {
        apiKey: "test-key",
        httpOrigin: "https://workspace.example",
        model: "qwen3-rerank",
        fetcher,
      },
    );

    expect(results.map((result) => result.id)).toEqual(["c", "a"]);
    expect(results[0]).toMatchObject({
      content: "Knowledge c",
      rerank: {
        status: "applied",
        model: "qwen3-rerank",
        score: 0.96,
        totalTokens: 42,
      },
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://workspace.example/compatible-api/v1/reranks",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
      }),
    );
  });

  it("preserves base retrieval order when the rerank request fails", async () => {
    const candidates = [candidate("a"), candidate("b"), candidate("c")];
    const results = await rerankKnowledgeCandidates("query", candidates, 2, {
      apiKey: "test-key",
      httpOrigin: "https://workspace.example",
      model: "qwen3-rerank",
      fetcher: async () => new Response(JSON.stringify({ message: "busy" }), { status: 503 }),
    });

    expect(results.map((result) => result.id)).toEqual(["a", "b"]);
    expect(results.every((result) => result.rerank?.status === "failed")).toBe(true);
    expect(results[0].rerank?.failureCode).toBe("upstream_error");
  });

  it("falls back when the model returns fewer results than requested", async () => {
    const candidates = [candidate("a"), candidate("b"), candidate("c")];
    const results = await rerankKnowledgeCandidates("query", candidates, 2, {
      apiKey: "test-key",
      httpOrigin: "https://workspace.example",
      model: "qwen3-rerank",
      fetcher: async () => new Response(JSON.stringify({
        results: [{ index: 2, relevance_score: 0.9 }],
      }), { status: 200 }),
    });

    expect(results.map((result) => result.id)).toEqual(["a", "b"]);
    expect(results[0].rerank).toMatchObject({
      status: "failed",
      failureCode: "invalid_response",
    });
  });

  it("cancels an active cloud request through the caller signal", async () => {
    const controller = new AbortController();
    const request = rerankKnowledgeCandidates("query", [candidate("a")], 1, {
      apiKey: "test-key",
      httpOrigin: "https://workspace.example",
      model: "qwen3-rerank",
      signal: controller.signal,
      fetcher: async (_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("cancelled", "AbortError"));
        }, { once: true });
      }),
    });

    controller.abort();
    await expect(request).resolves.toEqual([
      expect.objectContaining({
        id: "a",
        rerank: expect.objectContaining({
          status: "cancelled",
          failureCode: "cancelled",
        }),
      }),
    ]);
  });
});

describe("createKnowledgeRerankScheduler", () => {
  it("starts at most once every two seconds and gives a final request priority over drafts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const starts: Array<{ key: string; at: number }> = [];
    const scheduler = createKnowledgeRerankScheduler({
      minimumIntervalMs: 2_000,
      execute: async (request) => {
        starts.push({ key: request.key, at: Date.now() });
        return request.candidates.slice(0, request.limit);
      },
    });

    const firstDraft = scheduler.schedule({
      key: "turn-1-q1",
      priority: RerankPriority.Draft,
      query: "draft one",
      candidates: [candidate("draft-1")],
      limit: 1,
    });
    await vi.advanceTimersByTimeAsync(0);

    const queuedDraft = scheduler.schedule({
      key: "turn-2-q1",
      priority: RerankPriority.Draft,
      query: "draft two",
      candidates: [candidate("draft-2")],
      limit: 1,
    });
    const final = scheduler.schedule({
      key: "turn-1-q1",
      priority: RerankPriority.Final,
      query: "complete final question",
      candidates: [candidate("final")],
      limit: 1,
    });

    await vi.advanceTimersByTimeAsync(1_999);
    expect(starts).toEqual([{ key: "turn-1-q1", at: 0 }]);
    await vi.advanceTimersByTimeAsync(1);
    await expect(firstDraft).resolves.toHaveLength(1);
    await expect(final).resolves.toEqual([expect.objectContaining({ id: "final" })]);
    expect(starts).toEqual([
      { key: "turn-1-q1", at: 0 },
      { key: "turn-1-q1", at: 2_000 },
    ]);

    await vi.advanceTimersByTimeAsync(2_000);
    await expect(queuedDraft).resolves.toEqual([expect.objectContaining({ id: "draft-2" })]);
    expect(starts[2]).toEqual({ key: "turn-2-q1", at: 4_000 });
  });

  it("removes an aborted queued request without executing it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let releaseFirst: () => void = () => undefined;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const starts: string[] = [];
    const scheduler = createKnowledgeRerankScheduler({
      minimumIntervalMs: 1_000,
      execute: async (request) => {
        starts.push(request.key);
        if (request.key === "active") {
          await firstBlocked;
        }
        return request.candidates.slice(0, request.limit);
      },
    });
    const active = scheduler.schedule({
      key: "active",
      priority: RerankPriority.Draft,
      query: "active",
      candidates: [candidate("active")],
      limit: 1,
    });
    await vi.advanceTimersByTimeAsync(0);
    const controller = new AbortController();
    const queued = scheduler.schedule({
      key: "queued",
      priority: RerankPriority.Draft,
      query: "queued",
      candidates: [candidate("queued")],
      limit: 1,
      signal: controller.signal,
    });

    controller.abort();
    await expect(queued).resolves.toEqual([
      expect.objectContaining({
        id: "queued",
        rerank: expect.objectContaining({ status: "cancelled" }),
      }),
    ]);
    releaseFirst();
    await active;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(starts).toEqual(["active"]);
  });

  it("replaces an older queued draft with the latest draft for the same key", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let releaseActive: () => void = () => undefined;
    const activeBlocked = new Promise<void>((resolve) => {
      releaseActive = resolve;
    });
    const starts: string[] = [];
    const scheduler = createKnowledgeRerankScheduler({
      minimumIntervalMs: 1_000,
      execute: async (request) => {
        starts.push(request.query);
        if (request.key === "active") {
          await activeBlocked;
        }
        return request.candidates.slice(0, request.limit);
      },
    });
    const active = scheduler.schedule({
      key: "active",
      priority: RerankPriority.Draft,
      query: "active",
      candidates: [candidate("active")],
      limit: 1,
    });
    await vi.advanceTimersByTimeAsync(0);
    const oldDraft = scheduler.schedule({
      key: "same-question",
      priority: RerankPriority.Draft,
      query: "old draft",
      candidates: [candidate("old")],
      limit: 1,
    });
    const latestDraft = scheduler.schedule({
      key: "same-question",
      priority: RerankPriority.Draft,
      query: "latest draft",
      candidates: [candidate("latest")],
      limit: 1,
    });

    await expect(oldDraft).resolves.toEqual([
      expect.objectContaining({ rerank: expect.objectContaining({ status: "superseded" }) }),
    ]);
    releaseActive();
    await active;
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(latestDraft).resolves.toEqual([expect.objectContaining({ id: "latest" })]);
    expect(starts).toEqual(["active", "latest draft"]);
  });

  it("resolves with a stable failure code when the scheduler executor rejects", async () => {
    vi.useFakeTimers();
    const scheduler = createKnowledgeRerankScheduler({
      minimumIntervalMs: 1_000,
      execute: async () => {
        throw new Error("secret provider detail");
      },
    });
    const request = scheduler.schedule({
      key: "failure",
      priority: RerankPriority.Final,
      query: "query",
      candidates: [candidate("a")],
      limit: 1,
    });

    await vi.advanceTimersByTimeAsync(0);
    await expect(request).resolves.toEqual([
      expect.objectContaining({
        rerank: expect.objectContaining({
          status: "failed",
          failureCode: "scheduler_error",
        }),
      }),
    ]);
  });
});
