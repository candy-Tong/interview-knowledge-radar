import "dotenv/config";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { config } from "../../server/config.js";
import { RerankPriority } from "../../server/knowledge/rerank.js";
import {
  maximumKnowledgeResults,
  searchKnowledge,
} from "../../server/knowledge/search.js";
import {
  runRetrievalEvaluation,
  type RetrievalEvaluationJudgment,
  type RetrievalEvaluationSample,
} from "./evaluation.js";

const evaluationCasesSchema = z.array(z.object({
  id: z.string().min(1),
  query: z.string().min(2),
  expectation: z.string().min(1),
}));

const judgeResponseSchema = z.object({
  judgments: z.array(z.object({
    id: z.string().min(1),
    passed: z.boolean(),
    coverageScore: z.number().int().min(1).max(5),
    relevanceScore: z.number().int().min(1).max(5),
    reason: z.string().min(1).max(500),
    missingIntents: z.array(z.string().min(1).max(200)),
  })),
});

type OpenAiChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
};

/** Extracts JSON even when a compatible model surrounds it with a Markdown fence. */
function parseJudgeJson(content: string) {
  const firstBrace = content.indexOf("{");
  const lastBrace = content.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new Error("Retrieval judge did not return a JSON object.");
  }
  return JSON.parse(content.slice(firstBrace, lastBrace + 1)) as unknown;
}

/** Keeps judge input bounded while retaining the locally located relevant passage. */
function createJudgeInput(samples: RetrievalEvaluationSample[]) {
  return samples.map((sample) => ({
    id: sample.id,
    query: sample.query,
    expectation: sample.expectation,
    results: sample.results.map((result, index) => {
      const excerptStart = Math.max(0, result.focusStart - 1_000);
      const excerptEnd = Math.min(result.content.length, result.focusEnd + 4_000);
      return {
        rank: index + 1,
        sourceName: result.sourceName,
        heading: result.heading,
        excerpt: result.content.slice(excerptStart, excerptEnd).slice(0, 6_000),
        rerankStatus: result.rerank?.status,
        rerankScore: result.rerank?.score,
      };
    }),
  }));
}

/** Uses the configured OpenAI-compatible model as an independent retrieval judge. */
async function judgeRetrieval(
  samples: RetrievalEvaluationSample[],
): Promise<RetrievalEvaluationJudgment[]> {
  const { OPENAI_API_KEY: apiKey, OPENAI_BASE_URL: baseUrl, OPENAI_MODEL: model } = config;
  if (!baseUrl || !apiKey || !model) {
    const missing = [
      !baseUrl && "OPENAI_BASE_URL",
      !apiKey && "OPENAI_API_KEY",
      !model && "OPENAI_MODEL",
    ].filter(Boolean);
    throw new Error(`Missing evaluation configuration: ${missing.join(", ")}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.RETRIEVAL_EVAL_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 4_000,
        messages: [{
          role: "system",
          content: `You evaluate the Top 2 knowledge results returned for an interview question.
Judge the two results collectively, not by filename or exact wording.
Pass only when the supplied excerpts directly help answer every material intent in the query and do not spend a Top 2 slot on unrelated knowledge.
Use the expectation as the case-specific source of truth. Do not assume facts that are absent from the excerpts.
Return JSON only with this shape: {"judgments":[{"id":"case id","passed":true,"coverageScore":5,"relevanceScore":5,"reason":"short reason","missingIntents":[]}]}.
Scores range from 1 (bad) to 5 (fully correct).`,
        }, {
          role: "user",
          content: JSON.stringify(createJudgeInput(samples)),
        }],
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown network error";
    throw new Error(`OpenAI-compatible retrieval evaluation failed: ${message}`);
  } finally {
    clearTimeout(timeout);
  }
  const payload = (await response.json()) as OpenAiChatResponse;
  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Retrieval judge HTTP ${response.status}`);
  }
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Retrieval judge returned no text content.");
  }
  return judgeResponseSchema.parse(parseJudgeJson(content)).judgments;
}

/** Runs the checked-in retrieval benchmark against real search, rerank, and LLM judge. */
async function main() {
  const cases = evaluationCasesSchema.parse(JSON.parse(
    await readFile(join(process.cwd(), "evals", "retrieval", "cases.json"), "utf8"),
  ));
  const result = await runRetrievalEvaluation(
    cases,
    {
      search: (query) => searchKnowledge(query, maximumKnowledgeResults, {
        rerankKey: `eval:${query}`,
        rerankPriority: RerankPriority.Final,
      }),
      judge: judgeRetrieval,
    },
    config.RETRIEVAL_EVAL_MIN_PASS_RATE,
  );

  for (const evaluationCase of result.cases) {
    console.log(`${evaluationCase.passed ? "PASS" : "FAIL"} ${evaluationCase.id}`);
    console.log(`  sources: ${evaluationCase.results.map((item) => item.sourceName).join(" | ")}`);
    console.log(`  scores: coverage=${evaluationCase.coverageScore} relevance=${evaluationCase.relevanceScore}`);
    console.log(`  missing: ${evaluationCase.missingIntents.join(" | ") || "none"}`);
    console.log(`  judge: ${evaluationCase.reason}`);
  }
  console.log(
    `Summary: ${result.passed}/${result.total} passed (${(result.passRate * 100).toFixed(1)}%), threshold ${(result.threshold * 100).toFixed(1)}%`,
  );
  if (!result.meetsThreshold) {
    process.exitCode = 1;
  }
}

await main();
