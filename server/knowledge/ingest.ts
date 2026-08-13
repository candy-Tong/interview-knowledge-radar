import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type { PoolClient } from "pg";
import { databasePool } from "../database/client.js";
import { createEmbeddings } from "./embedding.js";
import { countTerms, prepareMarkdownDocument } from "./text.js";

const defaultKnowledgeDirectory = resolve(process.cwd(), "knowledge-base");
const knowledgeRefreshLock = [19_920_813, 20_260_813] as const;
const knowledgeStatsSql = `
  SELECT
    (SELECT COUNT(*) FROM knowledge_documents)::text AS documents,
    COUNT(*)::text AS chunks,
    COUNT(embedding)::text AS vectors
  FROM knowledge_chunks
`;

type ExistingKnowledgeDocument = {
  sourceName: string;
  contentHash: string;
  chunkCount: number;
  vectorCount: number;
};

type PreparedKnowledgeDocument = {
  sourceName: string;
  markdown: string;
  contentHash: string;
  heading: string;
  content: string;
};

export type KnowledgeStats = {
  documents: number;
  chunks: number;
  vectors: number;
};

export type KnowledgeRefreshResult = {
  added: number;
  updated: number;
  unchanged: number;
  deleted: number;
  ignored: number;
  embedded: number;
  stats: KnowledgeStats;
};

/** Recursively finds knowledge Markdown while excluding repository instruction files. */
async function findKnowledgeFiles(directory: string): Promise<string[]> {
  const entries = (await readdir(directory, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findKnowledgeFiles(entryPath));
    } else if (
      entry.isFile()
      && entry.name.toLowerCase().endsWith(".md")
      && entry.name !== "AGENTS.md"
    ) {
      files.push(entryPath);
    }
  }

  return files;
}

/** Reads valid knowledge documents and preserves their relative paths as stable source names. */
async function readKnowledgeDocuments(knowledgeDirectory: string) {
  const directoryStats = await stat(knowledgeDirectory);
  if (!directoryStats.isDirectory()) {
    throw new Error(`知识库路径必须是目录：${knowledgeDirectory}`);
  }

  const documents: PreparedKnowledgeDocument[] = [];
  let ignored = 0;
  for (const filePath of await findKnowledgeFiles(knowledgeDirectory)) {
    const sourceName = relative(knowledgeDirectory, filePath).split(sep).join("/");
    const markdown = await readFile(filePath, "utf8");
    const knowledge = prepareMarkdownDocument(sourceName, markdown);
    if (!knowledge) {
      ignored += 1;
      continue;
    }
    documents.push({
      sourceName,
      markdown,
      contentHash: createHash("sha256").update(markdown).digest("hex"),
      ...knowledge,
    });
  }

  return { documents, ignored };
}

/** Loads the current index state needed to decide whether embedding work is necessary. */
async function fetchExistingDocuments(client: PoolClient) {
  const result = await client.query<{
    sourceName: string;
    contentHash: string;
    chunkCount: string;
    vectorCount: string;
  }>(`
    SELECT
      document.source_name AS "sourceName",
      document.content_hash AS "contentHash",
      COUNT(chunk.id)::text AS "chunkCount",
      COUNT(chunk.embedding)::text AS "vectorCount"
    FROM knowledge_documents document
    LEFT JOIN knowledge_chunks chunk ON chunk.document_id = document.id
    GROUP BY document.id, document.source_name, document.content_hash
  `);

  return new Map<string, ExistingKnowledgeDocument>(result.rows.map((row) => [
    row.sourceName,
    {
      sourceName: row.sourceName,
      contentHash: row.contentHash,
      chunkCount: Number(row.chunkCount),
      vectorCount: Number(row.vectorCount),
    },
  ]));
}

/** Converts database count strings into the public knowledge statistics contract. */
function parseKnowledgeStats(row: { documents: string; chunks: string; vectors: string }) {
  return {
    documents: Number(row.documents),
    chunks: Number(row.chunks),
    vectors: Number(row.vectors),
  };
}

/** Reports the materialized knowledge index counts used by the statistics API. */
export async function fetchKnowledgeStats() {
  const result = await databasePool.query<{
    documents: string;
    chunks: string;
    vectors: string;
  }>(knowledgeStatsSql);
  return parseKnowledgeStats(result.rows[0]);
}

/** Reads statistics through the refresh connection before its advisory lock is released. */
async function fetchKnowledgeStatsWithClient(client: PoolClient) {
  const result = await client.query<{
    documents: string;
    chunks: string;
    vectors: string;
  }>(knowledgeStatsSql);
  return parseKnowledgeStats(result.rows[0]);
}

/** Replaces one complete document and both of its materialized indexes. */
async function indexKnowledgeDocument(
  client: PoolClient,
  document: PreparedKnowledgeDocument,
  embedding: number[] | undefined,
) {
  const documentResult = await client.query<{ id: string }>(
    `
      INSERT INTO knowledge_documents (source_name, title, content, content_hash)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (source_name) DO UPDATE SET
        title = EXCLUDED.title,
        content = EXCLUDED.content,
        content_hash = EXCLUDED.content_hash,
        updated_at = NOW()
      RETURNING id::text
    `,
    [document.sourceName, document.heading, document.markdown, document.contentHash],
  );
  const documentId = documentResult.rows[0].id;
  await client.query("DELETE FROM knowledge_chunks WHERE document_id = $1", [documentId]);

  const { terms, termFrequency } = countTerms(document.content);
  const vectorLiteral = embedding ? `[${embedding.join(",")}]` : null;
  const entryResult = await client.query<{ id: string }>(
    `
      INSERT INTO knowledge_chunks (
        document_id, chunk_index, heading, content, token_count, embedding
      ) VALUES ($1, 0, $2, $3, $4, $5::vector)
      RETURNING id::text
    `,
    [
      documentId,
      document.heading,
      document.content,
      Math.max(terms.length, 1),
      vectorLiteral,
    ],
  );
  const entryId = entryResult.rows[0].id;

  for (const [term, frequency] of termFrequency) {
    await client.query(
      `
        INSERT INTO knowledge_chunk_terms (chunk_id, term, term_frequency)
        VALUES ($1, $2, $3)
      `,
      [entryId, term, frequency],
    );
  }
}

/** Incrementally synchronizes a nested knowledge directory with the local search index. */
export async function refreshKnowledgeDirectory({
  knowledgeDirectory = defaultKnowledgeDirectory,
  isBm25Only = false,
}: {
  knowledgeDirectory?: string;
  isBm25Only?: boolean;
} = {}): Promise<KnowledgeRefreshResult> {
  const client = await databasePool.connect();
  let isLocked = false;
  let isInTransaction = false;

  try {
    await client.query("SELECT pg_advisory_lock($1, $2)", [
      knowledgeRefreshLock[0],
      knowledgeRefreshLock[1],
    ]);
    isLocked = true;

    const { documents, ignored } = await readKnowledgeDocuments(knowledgeDirectory);
    const existingDocuments = await fetchExistingDocuments(client);
    const currentSourceNames = new Set(documents.map((document) => document.sourceName));
    const deletedSourceNames = [...existingDocuments.keys()]
      .filter((sourceName) => !currentSourceNames.has(sourceName));
    const changedDocuments: Array<{
      document: PreparedKnowledgeDocument;
      embedding?: number[];
      isNew: boolean;
    }> = [];
    let unchanged = 0;
    let embedded = 0;

    for (const document of documents) {
      const existing = existingDocuments.get(document.sourceName);
      const hasCompleteIndex = existing?.chunkCount === 1
        && (isBm25Only || existing.vectorCount === 1);
      if (existing?.contentHash === document.contentHash && hasCompleteIndex) {
        unchanged += 1;
        continue;
      }

      const [embedding] = isBm25Only ? [] : await createEmbeddings([document.content]);
      embedded += embedding ? 1 : 0;
      changedDocuments.push({ document, embedding, isNew: !existing });
    }

    await client.query("BEGIN");
    isInTransaction = true;
    for (const change of changedDocuments) {
      await indexKnowledgeDocument(client, change.document, change.embedding);
    }
    if (deletedSourceNames.length > 0) {
      await client.query(
        "DELETE FROM knowledge_documents WHERE source_name = ANY($1::text[])",
        [deletedSourceNames],
      );
    }
    await client.query("COMMIT");
    isInTransaction = false;

    return {
      added: changedDocuments.filter((change) => change.isNew).length,
      updated: changedDocuments.filter((change) => !change.isNew).length,
      unchanged,
      deleted: deletedSourceNames.length,
      ignored,
      embedded,
      stats: await fetchKnowledgeStatsWithClient(client),
    };
  } catch (error) {
    if (isInTransaction) {
      await client.query("ROLLBACK");
    }
    throw error;
  } finally {
    if (isLocked) {
      await client.query("SELECT pg_advisory_unlock($1, $2)", [
        knowledgeRefreshLock[0],
        knowledgeRefreshLock[1],
      ]);
    }
    client.release();
  }
}
