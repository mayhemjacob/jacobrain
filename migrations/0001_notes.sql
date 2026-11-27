-- Jacob's Brain: tabla de notas + búsqueda de texto completo (FTS5)

CREATE TABLE notes (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,  -- rowid estable para FTS5 (no cambia con VACUUM)
  id          TEXT NOT NULL UNIQUE,               -- n_<ULID>, el id público
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,                      -- Markdown
  type        TEXT NOT NULL,                      -- ver src/notes.ts → NOTE_TYPES
  tags        TEXT NOT NULL DEFAULT '[]',         -- array JSON
  source      TEXT,
  visibility  TEXT NOT NULL DEFAULT 'private',    -- private | shareable
  pinned      INTEGER NOT NULL DEFAULT 0,         -- 1 = entra en get_context
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT                                -- borrado lógico
);

CREATE INDEX notes_type_updated ON notes(type, updated_at);
CREATE INDEX notes_updated ON notes(updated_at);

CREATE VIRTUAL TABLE notes_fts USING fts5(
  title, content, tags,
  content='notes', content_rowid='seq',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, title, content, tags)
  VALUES (new.seq, new.title, new.content, new.tags);
END;

CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, content, tags)
  VALUES ('delete', old.seq, old.title, old.content, old.tags);
END;

-- En UPDATE: borrar la entrada vieja del índice antes de insertar la nueva.
CREATE TRIGGER notes_au AFTER UPDATE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, content, tags)
  VALUES ('delete', old.seq, old.title, old.content, old.tags);
  INSERT INTO notes_fts(rowid, title, content, tags)
  VALUES (new.seq, new.title, new.content, new.tags);
END;
