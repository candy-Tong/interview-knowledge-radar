import { z } from "zod";
import { config } from "../config.js";

const splitQuestionResponseSchema = z.object({
  questions: z
    .array(z.object({
      text: z.string().trim().min(2).max(1_000),
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
  questions: string[];
  usedFallback: boolean;
  fallbackReason?: string;
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
        properties: { text: { type: "string", minLength: 2, maxLength: 1_000 } },
        required: ["text"],
      },
    },
  },
  required: ["questions"],
} as const;

const systemPrompt = `You split an interviewer's spoken turn into independent questions or answer requests for knowledge retrieval.
Return the minimum number of self-contained items needed to answer every distinct request.
Split coordinated clauses when each asks about a different topic, project, decision, process, reason, example, or result, even when they share one lead-in.
Preserve the original language, names, projects, constraints, and emphasis.
Rewrite pronouns such as it, that, this, and they with their explicit referent when needed to make each item independently searchable.
Do not answer, summarize, add facts, or split one request merely because it has supporting details.
An unfinished trailing request may remain as the final item.

Examples:
- "Please introduce yourself. How did you reduce false positives?" becomes two items.
- "Describe your frontend leadership experience, and what was your role in the complaint Agent project?" becomes two items.
- "How did you reduce false positives, and what impact did that have?" becomes "How did you reduce false positives?" and "What impact did reducing false positives have?".
- "Please introduce yourself in English and focus on your leadership experience." remains one item because the second clause only constrains the introduction.`;

/** Joins one OpenAI-compatible path without depending on trailing-slash configuration. */
function getLocalModelEndpoint(path: string) {
  return `${config.LOCAL_QUESTION_MODEL_URL.replace(/\/$/, "")}/${path}`;
}

/** Produces one safe fallback item so a local-model outage never blocks retrieval. */
function createFallback(transcript: string, reason: string): QuestionSplitResult {
  return {
    questions: [transcript.trim().replace(/\s+/g, " ")],
    usedFallback: true,
    fallbackReason: reason,
  };
}

/** Splits one interviewer turn through the loopback-only local model service. */
export async function splitInterviewQuestions(
  transcript: string,
  signal?: AbortSignal,
): Promise<QuestionSplitResult> {
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
          { role: "user", content: normalizedTranscript },
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

    const questions = [...new Set(parsed.data.questions.map((item) => item.text.trim()))];
    return questions.length > 0
      ? { questions, usedFallback: false }
      : createFallback(normalizedTranscript, "local_model_no_questions");
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
