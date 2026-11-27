// Capa de datos de Jacob's Brain sobre D1.

export const NOTE_TYPES = [
	"nota",
	"idea",
	"decision",
	"lectura",
	"persona",
	"tarea",
	"criterio",
	"principio",
	"voz",
	"termino",
	"perfil",
] as const;
export type NoteType = (typeof NOTE_TYPES)[number];

export const VISIBILITIES = ["private", "shareable"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export type Note = {
	id: string;
	title: string;
	content: string;
	type: NoteType;
	tags: string[];
	source: string | null;
	visibility: Visibility;
	pinned: boolean;
	created_at: string;
	updated_at: string;
	deleted_at: string | null;
};

type Row = Omit<Note, "tags" | "pinned"> & { tags: string; pinned: number };

const COLUMNS =
	"id, title, content, type, tags, source, visibility, pinned, created_at, updated_at, deleted_at";

function fromRow(r: Row): Note {
	let tags: string[] = [];
	try {
		tags = JSON.parse(r.tags);
	} catch {}
	return { ...r, tags, pinned: r.pinned === 1 };
}

export function normalizeTags(tags: string[] | undefined): string[] {
	if (!tags) return [];
	return [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
}

// ULID: ordenable por fecha, 26 caracteres Crockford base32.
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export function newId(now = Date.now()): string {
	let time = "";
	let t = now;
	for (let i = 0; i < 10; i++) {
		time = B32[t % 32] + time;
		t = Math.floor(t / 32);
	}
	const rand = crypto.getRandomValues(new Uint8Array(16));
	let r = "";
	for (const b of rand) r += B32[b % 32];
	return `n_${time}${r}`;
}

export type NewNote = {
	title: string;
	content: string;
	type: NoteType;
	tags?: string[];
	source?: string | null;
	visibility?: Visibility;
	pinned?: boolean;
};

export async function createNote(db: D1Database, input: NewNote): Promise<Note> {
	const now = new Date().toISOString();
	const note: Note = {
		id: newId(),
		title: input.title.trim(),
		content: input.content,
		type: input.type,
		tags: normalizeTags(input.tags),
		source: input.source ?? null,
		visibility: input.visibility ?? "private",
		pinned: input.pinned ?? false,
		created_at: now,
		updated_at: now,
		deleted_at: null,
	};
	await insertNote(db, note);
	return note;
}

async function insertNote(db: D1Database, n: Note) {
	await db
		.prepare(`INSERT INTO notes (${COLUMNS}) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
		.bind(
			n.id,
			n.title,
			n.content,
			n.type,
			JSON.stringify(n.tags),
			n.source,
			n.visibility,
			n.pinned ? 1 : 0,
			n.created_at,
			n.updated_at,
			n.deleted_at,
		)
		.run();
}

export async function getNote(
	db: D1Database,
	id: string,
	{ includeDeleted = false } = {},
): Promise<Note | null> {
	const row = await db
		.prepare(
			`SELECT ${COLUMNS} FROM notes WHERE id = ?${includeDeleted ? "" : " AND deleted_at IS NULL"}`,
		)
		.bind(id)
		.first<Row>();
	return row ? fromRow(row) : null;
}

export type NotePatch = {
	title?: string;
	content?: string;
	append?: string;
	type?: NoteType;
	tags?: string[];
	source?: string | null;
	visibility?: Visibility;
	pinned?: boolean;
	deleted?: boolean;
};

export async function updateNote(
	db: D1Database,
	id: string,
	patch: NotePatch,
): Promise<Note | null> {
	const current = await getNote(db, id, { includeDeleted: true });
	if (!current) return null;
	const now = new Date().toISOString();
	let content = patch.content ?? current.content;
	if (patch.append) content = `${content.trimEnd()}\n\n${patch.append}`;
	const next: Note = {
		...current,
		title: patch.title?.trim() ?? current.title,
		content,
		type: patch.type ?? current.type,
		tags: patch.tags ? normalizeTags(patch.tags) : current.tags,
		source: patch.source !== undefined ? patch.source : current.source,
		visibility: patch.visibility ?? current.visibility,
		pinned: patch.pinned ?? current.pinned,
		deleted_at:
			patch.deleted === undefined ? current.deleted_at : patch.deleted ? now : null,
		updated_at: now,
	};
	await db
		.prepare(
			`UPDATE notes SET title=?, content=?, type=?, tags=?, source=?, visibility=?, pinned=?, updated_at=?, deleted_at=? WHERE id=?`,
		)
		.bind(
			next.title,
			next.content,
			next.type,
			JSON.stringify(next.tags),
			next.source,
			next.visibility,
			next.pinned ? 1 : 0,
			next.updated_at,
			next.deleted_at,
			id,
		)
		.run();
	return next;
}

/**
 * Convierte texto libre en una consulta FTS5 segura: cada palabra entre comillas
 * con prefijo (FTS5 no tiene stemming en español: "idea*" encuentra "ideas"),
 * unidas con OR y ordenadas por relevancia (bm25).
 */
export function toFtsQuery(query: string): string | null {
	const words = query
		.normalize("NFC")
		.split(/[^\p{L}\p{N}]+/u)
		.filter((w) => w.length > 0);
	if (words.length === 0) return null;
	return words.map((w) => `"${w}"*`).join(" OR ");
}

export type SearchResult = {
	id: string;
	title: string;
	type: NoteType;
	tags: string[];
	updated_at: string;
	snippet: string;
};

export async function searchNotes(
	db: D1Database,
	opts: { query: string; type?: NoteType; tags?: string[]; limit?: number },
): Promise<SearchResult[]> {
	const fts = toFtsQuery(opts.query);
	if (!fts) return [];
	const where = ["notes_fts MATCH ?", "n.deleted_at IS NULL"];
	const params: unknown[] = [fts];
	if (opts.type) {
		where.push("n.type = ?");
		params.push(opts.type);
	}
	for (const tag of normalizeTags(opts.tags)) {
		where.push("EXISTS (SELECT 1 FROM json_each(n.tags) WHERE value = ?)");
		params.push(tag);
	}
	params.push(Math.min(Math.max(opts.limit ?? 10, 1), 50));
	const { results } = await db
		.prepare(
			`SELECT n.id, n.title, n.type, n.tags, n.updated_at,
			        snippet(notes_fts, 1, '**', '**', '…', 16) AS snippet
			 FROM notes_fts JOIN notes n ON n.seq = notes_fts.rowid
			 WHERE ${where.join(" AND ")}
			 ORDER BY bm25(notes_fts, 5.0, 1.0, 2.0)
			 LIMIT ?`,
		)
		.bind(...params)
		.all<Omit<SearchResult, "tags"> & { tags: string }>();
	return results.map((r) => ({ ...r, tags: JSON.parse(r.tags) }));
}

export async function listRecent(
	db: D1Database,
	opts: { limit?: number; type?: NoteType } = {},
): Promise<Note[]> {
	const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);
	const stmt = opts.type
		? db
				.prepare(
					`SELECT ${COLUMNS} FROM notes WHERE deleted_at IS NULL AND type = ? ORDER BY updated_at DESC LIMIT ?`,
				)
				.bind(opts.type, limit)
		: db
				.prepare(
					`SELECT ${COLUMNS} FROM notes WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?`,
				)
				.bind(limit);
	const { results } = await stmt.all<Row>();
	return results.map(fromRow);
}

/** Perfil + notas fijadas + recuento por tipo: lo que Claude carga al empezar. */
export async function getContext(db: D1Database) {
	const [core, counts] = await db.batch<any>([
		db.prepare(
			`SELECT ${COLUMNS} FROM notes
			 WHERE deleted_at IS NULL AND (type = 'perfil' OR pinned = 1)
			 ORDER BY CASE type WHEN 'perfil' THEN 0 WHEN 'criterio' THEN 1 WHEN 'principio' THEN 2 WHEN 'voz' THEN 3 ELSE 4 END,
			          updated_at DESC
			 LIMIT 40`,
		),
		db.prepare(
			`SELECT type, COUNT(*) AS n FROM notes WHERE deleted_at IS NULL GROUP BY type ORDER BY n DESC`,
		),
	]);
	return {
		notes: (core.results as Row[]).map(fromRow),
		counts: Object.fromEntries((counts.results as { type: string; n: number }[]).map((c) => [c.type, c.n])),
	};
}

export async function allNotes(db: D1Database): Promise<Note[]> {
	const { results } = await db
		.prepare(`SELECT ${COLUMNS} FROM notes ORDER BY created_at`)
		.all<Row>();
	return results.map(fromRow);
}

/** Inserta o reemplaza conservando id y fechas (para restaurar desde el backup). */
export async function upsertNote(db: D1Database, n: Note) {
	await db
		.prepare(
			`INSERT INTO notes (${COLUMNS}) VALUES (?,?,?,?,?,?,?,?,?,?,?)
			 ON CONFLICT(id) DO UPDATE SET title=excluded.title, content=excluded.content, type=excluded.type,
			   tags=excluded.tags, source=excluded.source, visibility=excluded.visibility, pinned=excluded.pinned,
			   created_at=excluded.created_at, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at`,
		)
		.bind(
			n.id,
			n.title,
			n.content,
			n.type,
			JSON.stringify(normalizeTags(n.tags)),
			n.source,
			n.visibility,
			n.pinned ? 1 : 0,
			n.created_at,
			n.updated_at,
			n.deleted_at,
		)
		.run();
}
