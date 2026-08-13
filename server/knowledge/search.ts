import { databasePool } from "../database/client.js";
import { createEmbeddings } from "./embedding.js";
import { locateRelevantPassage, tokenizeEnglish } from "./text.js";

export type KnowledgeResult = {
  id: string;
  sourceName: string;
  heading: string;
  content: string;
  bm25Score: number;
  vectorScore: number;
  hybridScore: number;
  focusStart: number;
  focusEnd: number;
};

type StoredKnowledgeResult = Omit<KnowledgeResult, "focusStart" | "focusEnd">;

export const maximumKnowledgeResults = 2;

const hybridSearchSql = `
WITH corpus_stats AS (
  SELECT
    COUNT(*)::float AS total_chunks,
    COALESCE(AVG(token_count), 1)::float AS avg_length
  FROM knowledge_chunks
),
query_terms AS (
  SELECT DISTINCT UNNEST($1::text[]) AS term
),
term_document_frequency AS (
  SELECT term, COUNT(*)::float AS document_frequency
  FROM knowledge_chunk_terms
  WHERE term IN (SELECT term FROM query_terms)
  GROUP BY term
),
bm25_candidates AS (
  SELECT
    chunk.id,
    SUM(
      LN(1 + (stats.total_chunks - frequency.document_frequency + 0.5) / (frequency.document_frequency + 0.5))
      * (
        terms.term_frequency * 2.2
        / (
          terms.term_frequency
          + 1.2 * (0.25 + 0.75 * chunk.token_count / NULLIF(stats.avg_length, 0))
        )
      )
    ) AS score
  FROM knowledge_chunk_terms terms
  JOIN query_terms query ON query.term = terms.term
  JOIN term_document_frequency frequency ON frequency.term = terms.term
  JOIN knowledge_chunks chunk ON chunk.id = terms.chunk_id
  CROSS JOIN corpus_stats stats
  GROUP BY chunk.id
  ORDER BY score DESC
  LIMIT 30
),
vector_candidates AS (
  SELECT id, 1 - (embedding <=> $2::vector) AS score
  FROM knowledge_chunks
  WHERE embedding IS NOT NULL
  ORDER BY embedding <=> $2::vector
  LIMIT 30
),
bm25_ranked AS (
  SELECT id, score, ROW_NUMBER() OVER (ORDER BY score DESC) AS rank
  FROM bm25_candidates
),
vector_ranked AS (
  SELECT id, score, ROW_NUMBER() OVER (ORDER BY score DESC) AS rank
  FROM vector_candidates
),
candidate_ids AS (
  SELECT id FROM bm25_ranked
  UNION
  SELECT id FROM vector_ranked
)
SELECT
  chunk.id::text,
  document.source_name AS "sourceName",
  chunk.heading,
  chunk.content,
  COALESCE(bm25.score, 0)::float AS "bm25Score",
  COALESCE(vector.score, 0)::float AS "vectorScore",
  (
    COALESCE(0.45 / (60 + bm25.rank), 0)
    + COALESCE(0.55 / (60 + vector.rank), 0)
  )::float AS "hybridScore"
FROM candidate_ids candidates
JOIN knowledge_chunks chunk ON chunk.id = candidates.id
JOIN knowledge_documents document ON document.id = chunk.document_id
LEFT JOIN bm25_ranked bm25 ON bm25.id = candidates.id
LEFT JOIN vector_ranked vector ON vector.id = candidates.id
ORDER BY "hybridScore" DESC
LIMIT $3;
`;

const bm25OnlySearchSql = `
WITH corpus_stats AS (
  SELECT COUNT(*)::float AS total_chunks, COALESCE(AVG(token_count), 1)::float AS avg_length
  FROM knowledge_chunks
),
query_terms AS (
  SELECT DISTINCT UNNEST($1::text[]) AS term
),
term_document_frequency AS (
  SELECT term, COUNT(*)::float AS document_frequency
  FROM knowledge_chunk_terms
  WHERE term IN (SELECT term FROM query_terms)
  GROUP BY term
)
SELECT
  chunk.id::text,
  document.source_name AS "sourceName",
  chunk.heading,
  chunk.content,
  SUM(
    LN(1 + (stats.total_chunks - frequency.document_frequency + 0.5) / (frequency.document_frequency + 0.5))
    * (terms.term_frequency * 2.2 / (
      terms.term_frequency + 1.2 * (0.25 + 0.75 * chunk.token_count / NULLIF(stats.avg_length, 0))
    ))
  )::float AS "bm25Score",
  0::float AS "vectorScore",
  SUM(
    LN(1 + (stats.total_chunks - frequency.document_frequency + 0.5) / (frequency.document_frequency + 0.5))
    * (terms.term_frequency * 2.2 / (
      terms.term_frequency + 1.2 * (0.25 + 0.75 * chunk.token_count / NULLIF(stats.avg_length, 0))
    ))
  )::float AS "hybridScore"
FROM knowledge_chunk_terms terms
JOIN query_terms query ON query.term = terms.term
JOIN term_document_frequency frequency ON frequency.term = terms.term
JOIN knowledge_chunks chunk ON chunk.id = terms.chunk_id
JOIN knowledge_documents document ON document.id = chunk.document_id
CROSS JOIN corpus_stats stats
GROUP BY chunk.id, document.source_name
ORDER BY "hybridScore" DESC
LIMIT $2;
`;

/** Searches the local knowledge base with BM25 plus pgvector, falling back to BM25 when unconfigured. */
export async function searchKnowledge(query: string, limit = maximumKnowledgeResults) {
  const terms = tokenizeEnglish(query);
  if (terms.length === 0) {
    return [];
  }

  const resultLimit = Math.min(Math.max(limit, 1), maximumKnowledgeResults);
  const hasEmbeddingConfig = Boolean(
    process.env.DASHSCOPE_API_KEY && process.env.DASHSCOPE_WORKSPACE_ID,
  );
  if (!hasEmbeddingConfig) {
    const result = await databasePool.query<StoredKnowledgeResult>(bm25OnlySearchSql, [
      terms,
      resultLimit,
    ]);
    return result.rows.map((row) => ({
      ...row,
      ...locateRelevantPassage(row.content, query),
    }));
  }

  const [embedding] = await createEmbeddings([query]);
  const vectorLiteral = `[${embedding.join(",")}]`;
  const result = await databasePool.query<StoredKnowledgeResult>(hybridSearchSql, [
    terms,
    vectorLiteral,
    resultLimit,
  ]);
  return result.rows.map((row) => ({
    ...row,
    ...locateRelevantPassage(row.content, query),
  }));
}
