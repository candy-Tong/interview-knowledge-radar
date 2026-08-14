import type { KnowledgeResult } from "../../server/knowledge/search.js";

export type RetrievalEvaluationCase = {
  id: string;
  query: string;
  expectation: string;
};

export type RetrievalEvaluationSample = RetrievalEvaluationCase & {
  results: KnowledgeResult[];
};

export type RetrievalEvaluationJudgment = {
  id: string;
  passed: boolean;
  coverageScore: number;
  relevanceScore: number;
  reason: string;
  missingIntents: string[];
};

type EvaluationDependencies = {
  search: (query: string) => Promise<KnowledgeResult[]>;
  judge: (
    samples: RetrievalEvaluationSample[],
  ) => Promise<RetrievalEvaluationJudgment[]>;
};

/** Runs real retrievals and lets an independent LLM judge the collective Top 2. */
export async function runRetrievalEvaluation(
  cases: RetrievalEvaluationCase[],
  dependencies: EvaluationDependencies,
  threshold: number,
) {
  const samples: RetrievalEvaluationSample[] = [];
  for (const evaluationCase of cases) {
    samples.push({
      ...evaluationCase,
      results: await dependencies.search(evaluationCase.query),
    });
  }

  const judgments = await dependencies.judge(samples);
  const judgmentById = new Map(judgments.map((judgment) => [judgment.id, judgment]));
  const evaluatedCases = samples.map((sample) => {
    const judgment = judgmentById.get(sample.id);
    if (!judgment) {
      throw new Error(`Evaluation judge omitted case: ${sample.id}`);
    }
    return {
      ...sample,
      ...judgment,
      passed: sample.results.length > 0 && judgment.passed,
      reason: sample.results.length > 0
        ? judgment.reason
        : `Retrieval returned no knowledge. Judge: ${judgment.reason}`,
    };
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
