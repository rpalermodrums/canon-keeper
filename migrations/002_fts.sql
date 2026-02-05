BEGIN;

CREATE VIRTUAL TABLE chunk_fts USING fts5(
  chunk_id,
  text
);

CREATE TRIGGER chunk_ai AFTER INSERT ON chunk BEGIN
  INSERT INTO chunk_fts (chunk_id, text) VALUES (new.id, new.text);
END;

CREATE TRIGGER chunk_au AFTER UPDATE ON chunk BEGIN
  DELETE FROM chunk_fts WHERE chunk_id = old.id;
  INSERT INTO chunk_fts (chunk_id, text) VALUES (new.id, new.text);
END;

CREATE TRIGGER chunk_ad AFTER DELETE ON chunk BEGIN
  DELETE FROM chunk_fts WHERE chunk_id = old.id;
END;

COMMIT;
