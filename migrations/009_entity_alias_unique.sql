BEGIN;

DELETE FROM entity_alias
WHERE rowid NOT IN (
  SELECT MIN(rowid)
  FROM entity_alias
  GROUP BY entity_id, alias_norm
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_alias_entity_norm
ON entity_alias(entity_id, alias_norm);

COMMIT;
