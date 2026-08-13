CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id BIGSERIAL PRIMARY KEY,
  source_name TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id BIGSERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  heading TEXT NOT NULL,
  content TEXT NOT NULL,
  token_count INTEGER NOT NULL CHECK (token_count > 0),
  embedding VECTOR(1024),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (document_id, chunk_index)
);

CREATE TABLE IF NOT EXISTS knowledge_chunk_terms (
  chunk_id BIGINT NOT NULL REFERENCES knowledge_chunks(id) ON DELETE CASCADE,
  term TEXT NOT NULL,
  term_frequency INTEGER NOT NULL CHECK (term_frequency > 0),
  PRIMARY KEY (chunk_id, term)
);

CREATE INDEX IF NOT EXISTS knowledge_chunk_terms_term_idx
  ON knowledge_chunk_terms(term);

CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_hnsw_idx
  ON knowledge_chunks USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;
