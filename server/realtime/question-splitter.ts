import { z } from "zod";
import { config } from "../config.js";

const splitQuestionResponseSchema = z.object({
  questions: z
    .array(z.object({
      text: z.string().trim().min(2).max(1_000),
      needsContext: z.boolean(),
      contextSpans: z.array(z.string().trim().min(1).max(1_000)).max(4),
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
          contextSpans: {
            type: "array",
            maxItems: 4,
            items: { type: "string", minLength: 1, maxLength: 1_000 },
          },
        },
        required: ["text", "needsContext", "contextSpans"],
      },
    },
  },
  required: ["questions"],
} as const;

const systemPrompt = `The user sends JSON with currentTurn and recentContext. Extract every distinct request from currentTurn. recentContext may only resolve what those current requests refer to; it is never a source of additional requests.

Return text, needsContext, and contextSpans for each request:
- text: one verbatim, contiguous quote from currentTurn. Never paraphrase, translate, or insert context into text. It may omit surrounding conversational filler.
- needsContext: true only when text cannot identify its subject without recentContext.
- contextSpans: when needsContext is true, copy the smallest exact contiguous quote or quotes from recentContext that identify every missing entity or topic. Do not join or rewrite separate quotes. When needsContext is false, use an empty array. Never put a question or an answer here.

Choose context by meaning, not by keywords or language:
1. Ask whether text alone tells a search engine exactly which entity or topic the request is about.
2. If it does, or the request is genuinely topic-free, return needsContext: false and contextSpans: []. A request whose complete subject is the candidate, such as a general self-introduction, is topic-free; the existence of recent project context does not make it dependent.
3. If it does not, return needsContext: true. contextSpans MUST contain the active topic plus every referent needed by the request, copied exactly from RECENT CONTEXT. This applies to any elliptical follow-up, including ones that express the dependency without a pronoun.

Examples:
- Input: {"currentTurn":"Good, what was your role specifically?","recentContext":["Now let's focus on your Finance Customer Complaint Agent project. What problem was it solving?"]}
  Output: {"questions":[{"text":"what was your role specifically?","needsContext":true,"contextSpans":["Finance Customer Complaint Agent project"]}]}
- Input: {"currentTurn":"How did you reduce them?","recentContext":["Finance Customer Complaint Agent project. You mentioned false positive alerts."]}
  Output: {"questions":[{"text":"How did you reduce them?","needsContext":true,"contextSpans":["false positive alerts","Finance Customer Complaint Agent project"]}]}
- Input: {"currentTurn":"Now, in the post-loan collection project, what was the hardest technical challenge?","recentContext":["Finance Customer Complaint Agent project"]}
  Output: {"questions":[{"text":"Now, in the post-loan collection project, what was the hardest technical challenge?","needsContext":false,"contextSpans":[]}]}
- Input: {"currentTurn":"Please introduce yourself in English.","recentContext":["Finance Customer Complaint Agent project"]}
  Output: {"questions":[{"text":"Please introduce yourself in English.","needsContext":false,"contextSpans":[]}]}

Split coordinated clauses only when they contain distinct requests. Keep constraints attached to their request. Preserve the original language and facts. Never invent a referent, repeat a historical question, or answer the interviewer.

Before returning, mechanically verify:
- Every text is an exact substring of currentTurn, including case and meaningful symbols.
- Every contextSpans item is an exact substring of one recentContext array item and contains no question from either field.
- If a proposed context span appears only in currentTurn, it is already present in text: set needsContext to false and contextSpans to [].
- Prefer the shortest historical entity phrase; never copy an entire historical sentence when a smaller contiguous phrase identifies the referent.`;

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
    .replace(/\s+/g, " ")
    .trim();
}

/** Tracks normalized characters back to their original UTF-16 source range. */
function normalizeQuoteWithMap(value: string) {
  let normalized = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let sourceOffset = 0;

  function append(character: string, start: number, end: number) {
    normalized += character;
    for (let index = 0; index < character.length; index += 1) {
      starts.push(start);
      ends.push(end);
    }
  }

  for (const sourceCharacter of value) {
    const start = sourceOffset;
    sourceOffset += sourceCharacter.length;
    const folded = sourceCharacter.normalize("NFKC");
    for (const character of folded) {
      if (/^\s$/u.test(character)) {
        if (normalized && !normalized.endsWith(" ")) {
          append(" ", start, sourceOffset);
        }
      } else {
        append(character, start, sourceOffset);
      }
    }
  }

  const first = normalized.search(/\S/u);
  if (first < 0) {
    return { normalized: "", starts: [], ends: [] };
  }
  let last = normalized.length;
  while (last > first && normalized[last - 1] === " ") {
    last -= 1;
  }
  return {
    normalized: normalized.slice(first, last),
    starts: starts.slice(first, last),
    ends: ends.slice(first, last),
  };
}

/** Locates a normalized model quote and returns the original source spelling. */
function findOriginalQuote(source: string, modelQuote: string) {
  const mappedSource = normalizeQuoteWithMap(source);
  const normalizedModelQuote = normalizeQuote(modelQuote);
  const normalizedStart = mappedSource.normalized.indexOf(normalizedModelQuote);
  if (normalizedStart < 0 || !normalizedModelQuote) {
    return null;
  }
  const normalizedEnd = normalizedStart + normalizedModelQuote.length - 1;
  const sourceStart = mappedSource.starts[normalizedStart];
  const sourceEnd = mappedSource.ends[normalizedEnd];
  if (sourceStart === undefined || sourceEnd === undefined) {
    return null;
  }
  return source.slice(sourceStart, sourceEnd);
}

/** Resolves model spans back to historical source text or rejects hallucinated context. */
function resolveContextSpans(
  modelSpans: string[],
  recentInterviewerTurns: string[],
) {
  const resolved: string[] = [];
  const seen = new Set<string>();
  for (const modelSpan of modelSpans) {
    const originalSpan = recentInterviewerTurns
      .map((turn) => findOriginalQuote(turn, modelSpan))
      .find((span): span is string => Boolean(span));
    if (!originalSpan) {
      return null;
    }
    const key = normalizeQuote(originalSpan);
    if (!seen.has(key)) {
      seen.add(key);
      resolved.push(originalSpan);
    }
  }
  return resolved;
}

/** Grounds display and retrieval text in current and historical source spans. */
function groundQuestions(
  modelQuestions: z.infer<typeof splitQuestionResponseSchema>["questions"],
  transcript: string,
  recentInterviewerTurns: string[],
) {
  const questions: InterviewQuestion[] = [];
  for (const modelQuestion of modelQuestions) {
    const text = findOriginalQuote(transcript, modelQuestion.text);
    if (!text) {
      return null;
    }
    if (!modelQuestion.needsContext) {
      questions.push({ text, retrievalQuery: text });
      continue;
    }
    const contextSpans = resolveContextSpans(
      modelQuestion.contextSpans,
      recentInterviewerTurns,
    );
    if (!contextSpans?.length) {
      return null;
    }
    questions.push({
      text,
      retrievalQuery: [text, ...contextSpans].join("\n"),
    });
  }
  return questions.length > 0 ? questions : null;
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
            content: JSON.stringify({
              currentTurn: normalizedTranscript,
              recentContext: recentInterviewerTurns
                .map((turn) => turn.trim().replace(/\s+/g, " "))
                .filter(Boolean),
            }),
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

    const questions = groundQuestions(
      parsed.data.questions,
      normalizedTranscript,
      recentInterviewerTurns,
    );
    return questions
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
