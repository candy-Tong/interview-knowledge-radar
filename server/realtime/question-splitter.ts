import { z } from "zod";
import { config } from "../config.js";

const splitQuestionResponseSchema = z.object({
  questions: z
    .array(z.object({
      text: z.string().trim().min(2).max(1_000),
      retrievalQuery: z.string().trim().min(2).max(1_000),
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
          retrievalQuery: { type: "string", minLength: 2, maxLength: 1_000 },
        },
        required: ["text", "retrievalQuery"],
      },
    },
  },
  required: ["questions"],
} as const;

const systemPrompt = `You split and contextually rewrite an interviewer's current spoken turn for knowledge retrieval.
The CURRENT TURN is the only source of requests. RECENT CONTEXT is reference material, never a request to repeat or answer.
Return the minimum number of self-contained items needed to answer every distinct request.
For each item, return text and retrievalQuery.
text contains only the request expressed in CURRENT TURN and is suitable for display. Remove conversational acknowledgements such as "Good", "Thanks", "Okay", or "I see" when they are not part of the request.
retrievalQuery starts from text and adds only the smallest missing referent from RECENT CONTEXT needed to make it independently searchable.
Split coordinated clauses when each asks about a different topic, project, decision, process, reason, example, or result, even when they share one lead-in.
Preserve the original language, names, projects, constraints, and emphasis.
Rewrite pronouns such as it, that, this, and they with their explicit referent when needed to make each item independently searchable.
Use recentInterviewerTurns only to resolve context required by the current request. Acknowledge words are never project or initiative names.
Do not answer, summarize, add facts, invent project names, or split one request merely because it has supporting details.
Never copy a question or request from RECENT CONTEXT into the output.
When CURRENT TURN is already independently searchable, retrievalQuery must preserve it without adding an unrelated project from RECENT CONTEXT.
An unfinished trailing request may remain as the final item.

Examples:
- With recent context "Let's focus on your customer complaint agent project", "Good, what was your role specifically?" becomes text "What was your role specifically?" and retrievalQuery "What was your role specifically in the customer complaint agent project?".
- With the same recent context, "Please introduce yourself in English." remains text and retrievalQuery "Please introduce yourself in English.".
- "Please introduce yourself. How did you reduce false positives?" becomes two items.
- "Please introduce yourself in English and focus on your leadership experience." remains one item because the second clause only constrains the introduction.`;

const questionScaffoldingWords = new Set([
  "a", "an", "and", "are", "did", "do", "does", "for", "how", "in", "is",
  "it", "me", "my", "of", "on", "or", "that", "the", "this", "to", "was",
  "we", "were", "what", "when", "where", "which", "who", "why", "you", "your",
]);

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

/** Keeps multi-question output tied to the current turn instead of copied history. */
function removeContextLeakage(
  questions: InterviewQuestion[],
  normalizedTranscript: string,
) {
  if (questions.length <= 1) {
    return questions;
  }
  const currentTerms = new Set(
    (normalizedTranscript.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
      .filter((term) => !questionScaffoldingWords.has(term)),
  );
  const groundedQuestions = questions.filter((question) => {
    const outputTerms = question.text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    return outputTerms.some((term) => currentTerms.has(term));
  });
  return groundedQuestions.length > 0 ? groundedQuestions : questions;
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
      retrievalQuery: item.retrievalQuery.trim(),
    })), normalizedTranscript);
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
