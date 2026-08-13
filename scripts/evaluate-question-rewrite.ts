import "dotenv/config";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { config } from "../server/config.js";
import { splitInterviewQuestions } from "../server/realtime/question-splitter.js";
import {
  runQuestionRewriteEvaluation,
  type QuestionRewriteJudgment,
  type QuestionRewriteSample,
} from "./question-rewrite-evaluation.js";

const evaluationCasesSchema = z.array(z.object({
  id: z.string().min(1),
  recentInterviewerTurns: z.array(z.string()),
  currentTurn: z.string().min(1),
  expectation: z.string().min(1),
}));

const judgeResponseSchema = z.object({
  judgments: z.array(z.object({
    id: z.string().min(1),
    passed: z.boolean(),
    contextScore: z.number().int().min(1).max(5),
    intentScore: z.number().int().min(1).max(5),
    hallucinationScore: z.number().int().min(1).max(5),
    reason: z.string().min(1).max(500),
  })),
});

type OpenAiChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
};

/** Joins an OpenAI-compatible chat path without duplicating a configured v1 suffix. */
function getChatCompletionsEndpoint(baseUrl: string) {
  return `${baseUrl.replace(/\/$/, "")}/chat/completions`;
}

/** Extracts a JSON object even when a judge surrounds it with a Markdown fence. */
function parseJudgeJson(content: string) {
  const firstBrace = content.indexOf("{");
  const lastBrace = content.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new Error("Evaluation judge did not return a JSON object.");
  }
  return JSON.parse(content.slice(firstBrace, lastBrace + 1)) as unknown;
}

/** Uses the configured OpenAI-compatible model as an independent semantic judge. */
async function judgeQuestionRewrites(
  samples: QuestionRewriteSample[],
): Promise<QuestionRewriteJudgment[]> {
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
  const timeout = setTimeout(
    () => controller.abort(),
    config.QUESTION_REWRITE_EVAL_TIMEOUT_MS,
  );
  let response: Response;
  try {
    response = await fetch(getChatCompletionsEndpoint(baseUrl), {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 4_000,
        messages: [{
          role: "system",
          content: `You evaluate contextual rewrites of interview questions for knowledge retrieval.
Judge semantic correctness, not exact wording.
Pass a case only when the retrieval query preserves the current request, supplies context required by an elliptical follow-up, and invents no project, person, result, or constraint.
An explicit subject in the current turn overrides older context. A standalone request must not be forced into an unrelated project.
Use the expectation field as the case-specific source of truth.
Return JSON only with this shape: {"judgments":[{"id":"case id","passed":true,"contextScore":1,"intentScore":1,"hallucinationScore":1,"reason":"short reason"}]}.
Scores range from 1 (bad) to 5 (fully correct). hallucinationScore 5 means no hallucination.`,
        }, {
          role: "user",
          content: JSON.stringify(samples),
        }],
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown network error";
    throw new Error(`OpenAI-compatible evaluation request failed: ${message}`);
  } finally {
    clearTimeout(timeout);
  }
  const payload = (await response.json()) as OpenAiChatResponse;
  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Evaluation judge HTTP ${response.status}`);
  }
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Evaluation judge returned no text content.");
  }
  return judgeResponseSchema.parse(parseJudgeJson(content)).judgments;
}

/** Runs the checked-in benchmark against the configured rewriter and LLM judge. */
async function main() {
  const cases = evaluationCasesSchema.parse(JSON.parse(
    await readFile(join(process.cwd(), "evals", "question-rewrite-cases.json"), "utf8"),
  ));
  const result = await runQuestionRewriteEvaluation(
    cases,
    {
      rewrite: async (evaluationCase) => {
        return splitInterviewQuestions({
          transcript: evaluationCase.currentTurn,
          recentInterviewerTurns: evaluationCase.recentInterviewerTurns,
        });
      },
      judge: judgeQuestionRewrites,
    },
    config.QUESTION_REWRITE_EVAL_MIN_PASS_RATE,
  );

  for (const evaluationCase of result.cases) {
    const status = evaluationCase.passed ? "PASS" : "FAIL";
    console.log(`${status} ${evaluationCase.id}`);
    console.log(`  retrieval: ${evaluationCase.questions.map((question) => question.retrievalQuery).join(" | ")}`);
    console.log(`  scores: context=${evaluationCase.contextScore} intent=${evaluationCase.intentScore} no-hallucination=${evaluationCase.hallucinationScore}`);
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
