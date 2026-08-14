import { config, getDashScopeHttpOrigin } from "../config.js";
import type { KnowledgeResult } from "./search.js";

export enum RerankPriority {
  Draft = 0,
  Interactive = 1,
  Final = 2,
}

export type RerankRequest = {
  key: string;
  priority: RerankPriority;
  query: string;
  candidates: KnowledgeResult[];
  limit: number;
  signal?: AbortSignal;
};

type RerankResponse = {
  results?: Array<{ index?: number; relevance_score?: number }>;
  usage?: { total_tokens?: number };
};

type RerankRequestOptions = {
  apiKey?: string;
  httpOrigin?: string;
  model?: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
};

type RerankSchedulerOptions = {
  minimumIntervalMs: number;
  execute: (request: RerankRequest) => Promise<KnowledgeResult[]>;
};

type QueuedRerank = {
  sequence: number;
  request: RerankRequest;
  resolve: (results: KnowledgeResult[]) => void;
  removeAbortListener: () => void;
};

const maximumRerankDocumentCharacters = 2_500;

/** Adds request-level rerank metadata without changing the full stored knowledge body. */
function withRerankMetadata(
  candidates: KnowledgeResult[],
  status: NonNullable<KnowledgeResult["rerank"]>["status"],
  durationMs: number,
  model: string,
  failureCode?: NonNullable<KnowledgeResult["rerank"]>["failureCode"],
): KnowledgeResult[] {
  return candidates.map((candidate) => ({
    ...candidate,
    rerank: { status, durationMs, model, failureCode },
  }));
}

/** Builds a bounded cloud input from the result heading, local focus, and document opening. */
function buildRerankDocument(candidate: KnowledgeResult) {
  const focusStart = Math.max(0, candidate.focusStart - 500);
  const focusEnd = Math.min(candidate.content.length, candidate.focusEnd + 900);
  const focusedPassage = candidate.content.slice(focusStart, focusEnd);
  const opening = candidate.content.slice(0, 1_100);
  return [candidate.heading, candidate.sourceName, focusedPassage, opening]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, maximumRerankDocumentCharacters);
}

/** Calls Bailian's text rerank endpoint and safely falls back to base retrieval order. */
export async function rerankKnowledgeCandidates(
  query: string,
  candidates: KnowledgeResult[],
  limit: number,
  options: RerankRequestOptions = {},
): Promise<KnowledgeResult[]> {
  const resultLimit = Math.min(Math.max(limit, 1), candidates.length);
  if (resultLimit === 0) {
    return [];
  }
  const apiKey = options.apiKey ?? config.DASHSCOPE_API_KEY;
  const httpOrigin = options.httpOrigin ?? getDashScopeHttpOrigin();
  const model = options.model ?? config.DASHSCOPE_RERANK_MODEL;
  if (options.signal?.aborted) {
    return withRerankMetadata(
      candidates.slice(0, resultLimit),
      "cancelled",
      0,
      model,
      "cancelled",
    );
  }
  if (!apiKey || !httpOrigin) {
    return withRerankMetadata(candidates.slice(0, resultLimit), "skipped", 0, model);
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? config.RERANK_TIMEOUT_MS,
  );
  let failureCode: NonNullable<KnowledgeResult["rerank"]>["failureCode"] = "upstream_error";
  try {
    const response = await (options.fetcher ?? fetch)(
      `${httpOrigin}/compatible-api/v1/reranks`,
      {
        method: "POST",
        signal: options.signal
          ? AbortSignal.any([controller.signal, options.signal])
          : controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          query,
          documents: candidates.map(buildRerankDocument),
          top_n: resultLimit,
          instruct: "Rank interview knowledge for a Top 2 answer set. Reward direct coverage of every requested focus. Prefer complementary knowledge that fills a missing focus over redundant documents about the same project.",
        }),
      },
    );
    const payload = (await response.json()) as RerankResponse;
    if (!response.ok) {
      throw new Error("Rerank upstream rejected the request.");
    }
    const ranked = payload.results;
    if (!ranked || ranked.length < resultLimit) {
      failureCode = "invalid_response";
      throw new Error("Rerank response contained too few ranked results.");
    }
    const seen = new Set<number>();
    const durationMs = Date.now() - startedAt;
    const results = ranked.map((item) => {
      const index = item.index;
      if (
        !Number.isInteger(index)
        || index === undefined
        || index < 0
        || index >= candidates.length
        || seen.has(index)
        || typeof item.relevance_score !== "number"
      ) {
        failureCode = "invalid_response";
        throw new Error("Rerank response contained an invalid candidate index or score.");
      }
      seen.add(index);
      return {
        ...candidates[index],
        rerank: {
          status: "applied" as const,
          durationMs,
          model,
          score: item.relevance_score,
          totalTokens: payload.usage?.total_tokens,
        },
      };
    });
    return results.slice(0, resultLimit);
  } catch {
    const wasCancelled = options.signal?.aborted === true;
    const wasTimedOut = !wasCancelled && controller.signal.aborted;
    return withRerankMetadata(
      candidates.slice(0, resultLimit),
      wasCancelled ? "cancelled" : "failed",
      Date.now() - startedAt,
      model,
      wasCancelled ? "cancelled" : wasTimedOut ? "timeout" : failureCode,
    );
  } finally {
    clearTimeout(timeout);
  }
}

/** Schedules cloud reranks globally, coalescing drafts and prioritizing final questions. */
export function createKnowledgeRerankScheduler(options: RerankSchedulerOptions) {
  const queue: QueuedRerank[] = [];
  let sequence = 0;
  let active = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastStartedAt = Number.NEGATIVE_INFINITY;

  function selectNext() {
    queue.sort((left, right) => (
      right.request.priority - left.request.priority || left.sequence - right.sequence
    ));
    const task = queue.shift();
    task?.removeAbortListener();
    return task;
  }

  /** Resolves a queued task exactly once and releases its abort listener. */
  function settle(task: QueuedRerank, results: KnowledgeResult[]) {
    task.removeAbortListener();
    task.resolve(results);
  }

  function pump() {
    if (active || timer || queue.length === 0) {
      return;
    }
    const waitMs = Math.max(0, options.minimumIntervalMs - (Date.now() - lastStartedAt));
    timer = setTimeout(() => {
      timer = undefined;
      const task = selectNext();
      if (!task) {
        return;
      }
      active = true;
      lastStartedAt = Date.now();
      void options.execute(task.request)
        .then(task.resolve)
        .catch(() => task.resolve(withRerankMetadata(
          task.request.candidates.slice(0, task.request.limit),
          "failed",
          0,
          config.DASHSCOPE_RERANK_MODEL,
          "scheduler_error",
        )))
        .finally(() => {
          active = false;
          pump();
        });
    }, waitMs);
  }

  return {
    schedule(request: RerankRequest) {
      return new Promise<KnowledgeResult[]>((resolve) => {
        if (request.signal?.aborted) {
          resolve(withRerankMetadata(
            request.candidates.slice(0, request.limit),
            "cancelled",
            0,
            config.DASHSCOPE_RERANK_MODEL,
            "cancelled",
          ));
          return;
        }
        if (request.priority === RerankPriority.Draft) {
          const pendingIndex = queue.findIndex((task) => (
            task.request.key === request.key
            && task.request.priority === RerankPriority.Draft
          ));
          if (pendingIndex >= 0) {
            const [superseded] = queue.splice(pendingIndex, 1);
            settle(superseded, withRerankMetadata(
              superseded.request.candidates.slice(0, superseded.request.limit),
              "superseded",
              0,
              config.DASHSCOPE_RERANK_MODEL,
            ));
          }
        } else {
          for (let index = queue.length - 1; index >= 0; index -= 1) {
            const pending = queue[index];
            if (
              pending.request.key === request.key
              && pending.request.priority === RerankPriority.Draft
            ) {
              queue.splice(index, 1);
              settle(pending, withRerankMetadata(
                pending.request.candidates.slice(0, pending.request.limit),
                "superseded",
                0,
                config.DASHSCOPE_RERANK_MODEL,
              ));
            }
          }
        }
        let task: QueuedRerank;
        const handleAbort = () => {
          const pendingIndex = queue.indexOf(task);
          if (pendingIndex < 0) {
            return;
          }
          queue.splice(pendingIndex, 1);
          settle(task, withRerankMetadata(
            request.candidates.slice(0, request.limit),
            "cancelled",
            0,
            config.DASHSCOPE_RERANK_MODEL,
            "cancelled",
          ));
          if (!active && timer && queue.length === 0) {
            clearTimeout(timer);
            timer = undefined;
          }
        };
        task = {
          request,
          resolve,
          sequence: sequence += 1,
          removeAbortListener: () => request.signal?.removeEventListener("abort", handleAbort),
        };
        request.signal?.addEventListener("abort", handleAbort, { once: true });
        queue.push(task);
        pump();
      });
    },
  };
}

export const knowledgeRerankScheduler = createKnowledgeRerankScheduler({
  minimumIntervalMs: config.RERANK_MIN_INTERVAL_MS,
  execute: (request) => rerankKnowledgeCandidates(
    request.query,
    request.candidates,
    request.limit,
    { signal: request.signal },
  ),
});
