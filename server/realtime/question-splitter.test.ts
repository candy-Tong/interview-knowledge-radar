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
              retrievalQuery: "Please introduce yourself, focusing on frontend leadership.",
            },
            {
              text: "What was your role in the Agent project?",
              retrievalQuery:
                "What was your role in the Finance Customer Complaint Agent project?",
            },
          ] }),
        },
      }],
    }), { status: 200 })));

    await expect(splitInterviewQuestions({
      transcript: "Please introduce yourself and explain your Agent role.",
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
              "What was your role in the Finance Customer Complaint Agent project?",
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
              retrievalQuery:
                "What problem was the Finance Customer Complaint Agent solving?",
            },
            {
              text: "What was your role specifically?",
              retrievalQuery:
                "What was your role specifically in the Finance Customer Complaint Agent project?",
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
          "What was your role specifically in the Finance Customer Complaint Agent project?",
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
