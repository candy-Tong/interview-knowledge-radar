import { describe, expect, it } from "vitest";
import { runRetrievalEvaluation } from "../evals/retrieval/evaluation.js";

describe("runRetrievalEvaluation", () => {
  it("uses an injected LLM judgment and enforces the configured pass-rate threshold", async () => {
    const result = await runRetrievalEvaluation(
      [{
        id: "compound-introduction",
        query: "Introduce yourself, focus on frontend leadership and the complaint agent.",
        expectation: "The two results collectively cover all three requested focuses.",
      }],
      {
        search: async () => [{
          id: "intro",
          sourceName: "self-introduction.md",
          heading: "Introduction",
          content: "Frontend leader and complaint agent owner.",
          bm25Score: 1,
          vectorScore: 1,
          hybridScore: 1,
          focusStart: 0,
          focusEnd: 42,
        }],
        judge: async () => [{
          id: "compound-introduction",
          passed: true,
          coverageScore: 5,
          relevanceScore: 5,
          reason: "The result covers every requested focus.",
          missingIntents: [],
        }],
      },
      0.8,
    );

    expect(result).toMatchObject({
      total: 1,
      passed: 1,
      passRate: 1,
      threshold: 0.8,
      meetsThreshold: true,
    });
    expect(result.cases[0]).toMatchObject({
      id: "compound-introduction",
      results: [{ sourceName: "self-introduction.md" }],
      coverageScore: 5,
    });
  });
});
