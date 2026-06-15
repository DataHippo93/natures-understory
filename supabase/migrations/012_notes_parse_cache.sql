-- Cache for LLM-parsed produce-order note lines.
--
-- Keyed on the SHA-256 of the lowercased+trimmed line so that re-parsing
-- the same human note (e.g. Clark types it again next week) doesn't burn
-- LLM tokens. The bound sku_hint may shift if the active catalog
-- changes, so we cap entries to 60 days.

CREATE TABLE IF NOT EXISTS notes_parse_cache (
  hash text PRIMARY KEY,
  line_excerpt text NOT NULL,          -- truncated original for debugging
  model text NOT NULL,                  -- e.g. 'claude-haiku-4-5'
  result jsonb NOT NULL,                -- the LlmAction (see lib/notes-parser-llm.ts)
  input_tokens int,
  output_tokens int,
  cost_usd numeric(10,5),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notes_parse_cache_created_idx ON notes_parse_cache (created_at DESC);

COMMENT ON TABLE notes_parse_cache IS 'LLM responses for notes parser. Keyed on hash(line) to dedupe.';
COMMENT ON COLUMN notes_parse_cache.hash IS 'sha256(lower(trim(line))) — same line text always lands on the same row.';
