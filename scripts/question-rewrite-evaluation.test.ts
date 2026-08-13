import { describe, expect, it } from "vitest";
import { runQuestionRewriteEvaluation } from "./question-rewrite-evaluation.js";

describe("runQuestionRewriteEvaluation", () => {
  it("reports failed cases and compares the LLM pass rate with the threshold", async () => {
    const result = await runQuestionRewriteEvaluation(
      [
        {
          id: "complaint-role",
          recentInterviewerTurns: ["Let's discuss the complaint agent project."],
          currentTurn: "What was your role?",
          expectation: "The retrieval query names the complaint agent project.",
        },
        {
          id: "standalone-introduction",
          recentInterviewerTurns: ["Let's discuss the complaint agent project."],
          currentTurn: "Please introduce yourself.",
          expectation: "The retrieval query remains a standalone introduction request.",
        },
      ],
      {
        rewrite: async (evaluationCase) => [{
          text: evaluationCase.currentTurn,
          retrievalQuery: evaluationCase.currentTurn,
        }],
        judge: async (samples) => samples.map((sample) => ({
          id: sample.id,
          passed: sample.id === "standalone-introduction",
          contextScore: sample.id === "standalone-introduction" ? 5 : 1,
          intentScore: 5,
          hallucinationScore: 5,
          reason: sample.id === "standalone-introduction"
            ? "The request stayed independent."
            : "The project context was missing.",
        })),
      },
      0.8,
    );

    expect(result).toMatchObject({
      total: 2,
      passed: 1,
      passRate: 0.5,
      threshold: 0.8,
      meetsThreshold: false,
    });
    expect(result.cases).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "complaint-role", passed: false }),
    ]));
  });
});
