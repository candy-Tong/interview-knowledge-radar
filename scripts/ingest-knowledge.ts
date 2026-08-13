import { databasePool } from "../server/database/client.js";
import { refreshKnowledgeDirectory } from "../server/knowledge/ingest.js";

const isBm25Only = process.argv.includes("--bm25-only");

/** Runs the same incremental knowledge refresh used by the browser action. */
async function ingestKnowledgeDirectory() {
  if (isBm25Only) {
    console.warn("BM25-only mode: changed documents will be indexed without vectors.");
  }
  const result = await refreshKnowledgeDirectory({ isBm25Only });
  console.log(
    `Knowledge refreshed: ${result.added} added, ${result.updated} updated, `
      + `${result.unchanged} unchanged, ${result.deleted} deleted, `
      + `${result.ignored} ignored, ${result.embedded} embedded.`,
  );
}

try {
  await ingestKnowledgeDirectory();
} finally {
  await databasePool.end();
}
