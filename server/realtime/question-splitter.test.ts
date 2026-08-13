import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkQuestionSplitterHealth,
  splitInterviewQuestions,
} from "./question-splitter.js";

afterEach(() => vi.unstubAllGlobals());

describe("splitInterviewQuestions", () => {
  it("returns independently searchable questions from structured local output", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({ questions: [
            {
              text: "Please introduce yourself, focusing on frontend leadership.",
              needsContext: false,
              context: null,
            },
            {
              text: "What was your role in the Agent project?",
              needsContext: true,
              context: "Finance Customer Complaint Agent project",
            },
          ] }),
        },
      }],
    }), { status: 200 })));

    await expect(splitInterviewQuestions({
      transcript:
        "Please introduce yourself, focusing on frontend leadership. What was your role in the Agent project?",
      recentInterviewerTurns: [
        "Let's focus on the Finance Customer Complaint Agent project.",
      ],
    }))
      .resolves.toEqual({
        questions: [
          {
            text: "Please introduce yourself, focusing on frontend leadership.",
            retrievalQuery: "Please introduce yourself, focusing on frontend leadership.",
          },
          {
            text: "What was your role in the Agent project?",
            retrievalQuery:
              "What was your role in the Agent project?\nFinance Customer Complaint Agent project",
          },
        ],
        usedFallback: false,
      });
  });

  it("falls back to the complete turn when the local service is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("connection refused");
    }));

    await expect(splitInterviewQuestions({
      transcript: "  Tell me   about your monorepo. ",
      recentInterviewerTurns: [],
    }))
      .resolves.toEqual({
        questions: [{
          text: "Tell me about your monorepo.",
          retrievalQuery: "Tell me about your monorepo.",
        }],
        usedFallback: true,
        fallbackReason: "connection refused",
      });
  });

  it("does not copy an earlier context question into the current turn", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({ questions: [
            {
              text: "What problem was it solving?",
              needsContext: true,
              context: "Finance Customer Complaint Agent project",
            },
            {
              text: "What was your role specifically?",
              needsContext: true,
              context: "Finance Customer Complaint Agent project",
            },
          ] }),
        },
      }],
    }), { status: 200 })));

    await expect(splitInterviewQuestions({
      transcript: "Good, and what was your role specifically?",
      recentInterviewerTurns: [
        "Let's discuss the complaint Agent. What problem was it solving?",
      ],
    })).resolves.toMatchObject({
      questions: [{
        text: "What was your role specifically?",
        retrievalQuery:
          "What was your role specifically?\nFinance Customer Complaint Agent project",
      }],
      usedFallback: false,
    });
  });

  it("falls back to the current turn when the only output comes from history", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({ questions: [{
            text: "What problem was it solving?",
            needsContext: true,
            context: "Finance Customer Complaint Agent project",
          }] }),
        },
      }],
    }), { status: 200 })));

    await expect(splitInterviewQuestions({
      transcript: "Good, and what was your role specifically?",
      recentInterviewerTurns: [
        "Let's discuss the complaint Agent. What problem was it solving?",
      ],
    })).resolves.toEqual({
      questions: [{
        text: "Good, and what was your role specifically?",
        retrievalQuery: "Good, and what was your role specifically?",
      }],
      usedFallback: true,
      fallbackReason: "local_model_ungrounded_questions",
    });
  });

  it("keeps a single current question for display while retaining its contextual query", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({ questions: [{
            text: "How did you reduce them?",
            needsContext: true,
            context:
              "false positive alerts in the Finance Customer Complaint Agent project",
          }] }),
        },
      }],
    }), { status: 200 })));

    await expect(splitInterviewQuestions({
      transcript: "How did you reduce them?",
      recentInterviewerTurns: [
        "In the complaint Agent project, you mentioned false positive alerts.",
      ],
    })).resolves.toEqual({
      questions: [{
        text: "How did you reduce them?",
        retrievalQuery:
          "How did you reduce them?\nfalse positive alerts in the Finance Customer Complaint Agent project",
      }],
      usedFallback: false,
    });
  });

  it("ignores a context phrase when the model classifies the request as self-contained", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({ questions: [{
            text: "Please introduce yourself in English.",
            needsContext: false,
            context: "Finance Customer Complaint Agent project",
          }] }),
        },
      }],
    }), { status: 200 })));

    await expect(splitInterviewQuestions({
      transcript: "Please introduce yourself in English.",
      recentInterviewerTurns: [
        "Let's focus on the Finance Customer Complaint Agent project.",
      ],
    })).resolves.toMatchObject({
      questions: [{
        text: "Please introduce yourself in English.",
        retrievalQuery: "Please introduce yourself in English.",
      }],
      usedFallback: false,
    });
  });

  it("validates current-turn quotes without relying on an English word list", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({ questions: [{
            text: "你的具体职责是什么？",
            needsContext: true,
            context: "财经智能客诉项目",
          }] }),
        },
      }],
    }), { status: 200 })));

    await expect(splitInterviewQuestions({
      transcript: "好的，那你的具体职责是什么？",
      recentInterviewerTurns: ["我们继续讨论财经智能客诉项目。"],
    })).resolves.toEqual({
      questions: [{
        text: "你的具体职责是什么？",
        retrievalQuery: "你的具体职责是什么？\n财经智能客诉项目",
      }],
      usedFallback: false,
    });
  });

  it("tolerates punctuation normalization in a current-turn quote", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({ questions: [{
            text: "在贷后催收项目中，最大的技术挑战是什么?",
            needsContext: false,
            context: null,
          }] }),
        },
      }],
    }), { status: 200 })));

    await expect(splitInterviewQuestions({
      transcript: "现在，在贷后催收项目中，最大的技术挑战是什么？",
      recentInterviewerTurns: ["之前讨论的是财经智能客诉项目。"],
    })).resolves.toMatchObject({
      questions: [{
        text: "在贷后催收项目中，最大的技术挑战是什么?",
        retrievalQuery: "在贷后催收项目中，最大的技术挑战是什么?",
      }],
      usedFallback: false,
    });
  });
});

describe("checkQuestionSplitterHealth", () => {
  it("requires the configured model alias", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: "qwen3.5-2b" }],
    }), { status: 200 })));

    await expect(checkQuestionSplitterHealth()).resolves.toBe(true);
  });

  it("rejects a healthy server that does not expose the configured model", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: "another-model" }],
    }), { status: 200 })));

    await expect(checkQuestionSplitterHealth()).resolves.toBe(false);
  });
});
