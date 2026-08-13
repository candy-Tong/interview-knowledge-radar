import type { InterviewQuestion } from "../server/realtime/question-splitter.js";

export type QuestionRewriteEvaluationCase = {
  id: string;
  recentInterviewerTurns: string[];
  currentTurn: string;
  expectation: string;
};

export type QuestionRewriteSample = QuestionRewriteEvaluationCase & {
  questions: InterviewQuestion[];
};

export type QuestionRewriteJudgment = {
  id: string;
  passed: boolean;
  contextScore: number;
  intentScore: number;
  hallucinationScore: number;
  reason: string;
};

type EvaluationDependencies = {
  rewrite: (
    evaluationCase: QuestionRewriteEvaluationCase,
  ) => Promise<InterviewQuestion[]>;
  judge: (
    samples: QuestionRewriteSample[],
  ) => Promise<QuestionRewriteJudgment[]>;
};

/** Runs the real rewrite cases and lets an independent LLM judge their semantics. */
export async function runQuestionRewriteEvaluation(
  cases: QuestionRewriteEvaluationCase[],
  dependencies: EvaluationDependencies,
  threshold: number,
) {
  const samples: QuestionRewriteSample[] = [];
  for (const evaluationCase of cases) {
    samples.push({
      ...evaluationCase,
      questions: await dependencies.rewrite(evaluationCase),
    });
  }

  const judgments = await dependencies.judge(samples);
  const judgmentById = new Map(judgments.map((judgment) => [judgment.id, judgment]));
  const evaluatedCases = samples.map((sample) => {
    const judgment = judgmentById.get(sample.id);
    if (!judgment) {
      throw new Error(`Evaluation judge omitted case: ${sample.id}`);
    }
    return { ...sample, ...judgment };
  });
  const passed = evaluatedCases.filter((evaluationCase) => evaluationCase.passed).length;
  const passRate = cases.length > 0 ? passed / cases.length : 0;

  return {
    total: cases.length,
    passed,
    passRate,
    threshold,
    meetsThreshold: passRate >= threshold,
    cases: evaluatedCases,
  };
}
