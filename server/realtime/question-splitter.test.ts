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
            { text: "Please introduce yourself, focusing on frontend leadership." },
            { text: "What was your role in the Finance Customer Complaint Agent project?" },
          ] }),
        },
      }],
    }), { status: 200 })));

    await expect(splitInterviewQuestions("Please introduce yourself and explain your Agent role."))
      .resolves.toEqual({
        questions: [
          "Please introduce yourself, focusing on frontend leadership.",
          "What was your role in the Finance Customer Complaint Agent project?",
        ],
        usedFallback: false,
      });
  });

  it("falls back to the complete turn when the local service is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("connection refused");
    }));

    await expect(splitInterviewQuestions("  Tell me   about your monorepo. "))
      .resolves.toEqual({
        questions: ["Tell me about your monorepo."],
        usedFallback: true,
        fallbackReason: "connection refused",
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
