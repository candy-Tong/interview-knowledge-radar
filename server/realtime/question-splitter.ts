import { z } from "zod";
import { config } from "../config.js";

const splitQuestionResponseSchema = z.object({
  questions: z
    .array(z.object({
      text: z.string().trim().min(2).max(1_000),
      needsContext: z.boolean(),
      context: z.string().trim().min(1).max(1_000).nullable(),
    }))
    .min(1)
    .max(6),
});

type LocalChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
};

type LocalModelsResponse = {
  data?: Array<{ id?: string }>;
};

export type QuestionSplitResult = {
  questions: InterviewQuestion[];
  usedFallback: boolean;
  fallbackReason?: string;
};

export type InterviewQuestion = {
  text: string;
  retrievalQuery: string;
};

export type QuestionSplitInput = {
  transcript: string;
  recentInterviewerTurns: string[];
};

const questionSplitJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    questions: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string", minLength: 2, maxLength: 1_000 },
          needsContext: { type: "boolean" },
          context: {
            anyOf: [
              { type: "string", minLength: 1, maxLength: 1_000 },
              { type: "null" },
            ],
          },
        },
        required: ["text", "needsContext", "context"],
      },
    },
  },
  required: ["questions"],
} as const;

const systemPrompt = `Extract every distinct request from CURRENT TURN. RECENT CONTEXT may only resolve what those current requests refer to; it is never a source of additional requests.

Return text, needsContext, and context for each request:
- text: one verbatim, contiguous quote from CURRENT TURN. Never paraphrase, translate, or insert context into text. It may omit surrounding conversational filler.
- needsContext: true only when text cannot identify its subject without RECENT CONTEXT.
- context: when needsContext is true, copy all missing entities or topics from RECENT CONTEXT as one short factual phrase. When needsContext is false, use null. Never put a question or an answer here.

Choose context by meaning, not by keywords or language:
1. Ask whether text alone tells a search engine exactly which entity or topic the request is about.
2. If it does, or the request is genuinely topic-free, return needsContext: false and context: null. A request whose complete subject is the candidate, such as a general self-introduction, is topic-free; the existence of recent project context does not make it dependent.
3. If it does not, return needsContext: true. context MUST contain the active topic plus every referent needed by the request. This applies to any elliptical follow-up, including ones that express the dependency without a pronoun.

Examples:
- RECENT CONTEXT: "Finance Customer Complaint Agent project"; CURRENT TURN: "Good, what was your role specifically?" -> text: "what was your role specifically?"; needsContext: true; context: "Finance Customer Complaint Agent project".
- RECENT CONTEXT: "Finance Customer Complaint Agent project. You mentioned false positive alerts."; CURRENT TURN: "How did you reduce them?" -> text: "How did you reduce them?"; needsContext: true; context: "false positive alerts in the Finance Customer Complaint Agent project".
- RECENT CONTEXT names another project; CURRENT TURN: "In the post-loan collection project, what was the hardest challenge?" -> needsContext: false; context: null because text names its topic.
- RECENT CONTEXT names a project; CURRENT TURN: "Please introduce yourself in English." -> needsContext: false; context: null because the request is topic-free.

Split coordinated clauses only when they contain distinct requests. Keep constraints attached to their request. Preserve the original language and facts. Never invent a referent, repeat a historical question, or answer the interviewer.`;

/** Joins one OpenAI-compatible path without depending on trailing-slash configuration. */
function getLocalModelEndpoint(path: string) {
  return `${config.LOCAL_QUESTION_MODEL_URL.replace(/\/$/, "")}/${path}`;
}

/** Produces one safe fallback item so a local-model outage never blocks retrieval. */
function createFallback(transcript: string, reason: string): QuestionSplitResult {
  const normalizedTranscript = transcript.trim().replace(/\s+/g, " ");
  return {
    questions: [{ text: normalizedTranscript, retrievalQuery: normalizedTranscript }],
    usedFallback: true,
    fallbackReason: reason,
  };
}

/** Normalizes a quote without making assumptions about its language or vocabulary. */
function normalizeQuote(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Keeps display questions tied to exact spans from the current turn. */
function removeContextLeakage(
  questions: InterviewQuestion[],
  normalizedTranscript: string,
) {
  const currentTurn = normalizeQuote(normalizedTranscript);
  return questions.filter((question) => {
    const displayQuote = normalizeQuote(question.text);
    return displayQuote.length > 0 && currentTurn.includes(displayQuote);
  });
}

/** Preserves the current request verbatim while appending only resolved context. */
function createRetrievalQuery(
  text: string,
  needsContext: boolean,
  context: string | null,
) {
  if (!needsContext) {
    return text;
  }
  const normalizedContext = context?.trim().replace(/\s+/g, " ") ?? "";
  return normalizedContext ? `${text}\n${normalizedContext}` : text;
}

/** Splits one interviewer turn through the loopback-only local model service. */
export async function splitInterviewQuestions(
  input: QuestionSplitInput,
  signal?: AbortSignal,
): Promise<QuestionSplitResult> {
  const { transcript, recentInterviewerTurns } = input;
  const normalizedTranscript = transcript.trim().replace(/\s+/g, " ");
  if (!normalizedTranscript) {
    return createFallback(transcript, "empty_transcript");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.LOCAL_QUESTION_MODEL_TIMEOUT_MS);
  function handleAbort() {
    controller.abort();
  }
  if (signal?.aborted) {
    controller.abort();
  } else {
    signal?.addEventListener("abort", handleAbort, { once: true });
  }
  try {
    const response = await fetch(getLocalModelEndpoint("chat/completions"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.LOCAL_QUESTION_MODEL,
        temperature: 0,
        max_tokens: 360,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              "<recent_context_reference_only>",
              ...recentInterviewerTurns
                .map((turn) => turn.trim().replace(/\s+/g, " "))
                .filter(Boolean),
              "</recent_context_reference_only>",
              "<current_turn_only_source_of_requests>",
              normalizedTranscript,
              "</current_turn_only_source_of_requests>",
            ].join("\n"),
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "interview_questions",
            strict: true,
            schema: questionSplitJsonSchema,
          },
        },
      }),
    });
    const payload = (await response.json()) as LocalChatResponse;
    if (!response.ok) {
      return createFallback(
        normalizedTranscript,
        payload.error?.message ?? `local_model_http_${response.status}`,
      );
    }

    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      return createFallback(normalizedTranscript, "local_model_empty_response");
    }
    const parsed = splitQuestionResponseSchema.safeParse(JSON.parse(content));
    if (!parsed.success) {
      return createFallback(normalizedTranscript, "local_model_invalid_schema");
    }

    const questions = removeContextLeakage(parsed.data.questions.map((item) => ({
      text: item.text.trim(),
      retrievalQuery: createRetrievalQuery(
        item.text.trim(),
        item.needsContext,
        item.context,
      ),
    })), normalizedTranscript);
    return questions.length > 0
      ? { questions, usedFallback: false }
      : createFallback(normalizedTranscript, "local_model_ungrounded_questions");
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }
    const reason = error instanceof Error ? error.message : "local_model_unavailable";
    return createFallback(normalizedTranscript, reason);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", handleAbort);
  }
}

/** Checks the local model without making it a prerequisite for audio capture. */
export async function checkQuestionSplitterHealth() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 800);
  try {
    const response = await fetch(getLocalModelEndpoint("models"), {
      signal: controller.signal,
    });
    if (!response.ok) {
      return false;
    }
    const payload = (await response.json()) as LocalModelsResponse;
    return payload.data?.some((model) => model.id === config.LOCAL_QUESTION_MODEL) ?? false;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
