// Endpoints HTTP fuera de MCP, protegidos con tokens propios (no con OAuth):
//   GET  /export   → todas las notas en Markdown (GitHub Action de backup)  [BACKUP_TOKEN]
//   POST /import   → restaurar notas desde el backup                        [BACKUP_TOKEN]
//   POST /capture  → crear una nota (Pally, atajos, automatizaciones)       [CAPTURE_TOKEN]

import type { Hono } from "hono";
import { z } from "zod";
import { fromMarkdown, notePath, toMarkdown } from "./markdown";
import { allNotes, createNote, NOTE_TYPES, upsertNote } from "./notes";

async function tokenMatches(header: string | undefined, expected: string | undefined) {
	if (!expected || !header?.startsWith("Bearer ")) return false;
	const enc = new TextEncoder();
	// Comparación en tiempo constante a través de un hash.
	const [a, b] = await Promise.all([
		crypto.subtle.digest("SHA-256", enc.encode(header.slice(7))),
		crypto.subtle.digest("SHA-256", enc.encode(expected)),
	]);
	return crypto.subtle.timingSafeEqual(a, b);
}

const captureBody = z.object({
	title: z.string().min(1).max(300),
	content: z.string().min(1).max(100_000),
	type: z.enum(NOTE_TYPES).default("nota"),
	tags: z.array(z.string().max(50)).max(20).optional(),
	source: z.string().max(2000).optional(),
});

export function registerHttpApi(app: Hono<{ Bindings: Env }>) {
	app.get("/export", async (c) => {
		if (!(await tokenMatches(c.req.header("Authorization"), c.env.BACKUP_TOKEN)))
			return c.json({ error: "unauthorized" }, 401);
		const notes = await allNotes(c.env.DB);
		return c.json({
			exported_at: new Date().toISOString(),
			count: notes.length,
			files: notes.map((n) => ({ path: notePath(n), markdown: toMarkdown(n) })),
		});
	});

	app.post("/import", async (c) => {
		if (!(await tokenMatches(c.req.header("Authorization"), c.env.BACKUP_TOKEN)))
			return c.json({ error: "unauthorized" }, 401);
		const body = await c.req.json<{ files?: { path: string; markdown: string }[] }>();
		const errors: { path: string; error: string }[] = [];
		let imported = 0;
		for (const f of body.files ?? []) {
			try {
				await upsertNote(c.env.DB, fromMarkdown(f.markdown));
				imported++;
			} catch (e: any) {
				errors.push({ path: f.path, error: String(e?.message ?? e) });
			}
		}
		return c.json({ imported, errors });
	});

	app.post("/capture", async (c) => {
		if (!(await tokenMatches(c.req.header("Authorization"), c.env.CAPTURE_TOKEN)))
			return c.json({ error: "unauthorized" }, 401);
		const parsed = captureBody.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success) return c.json({ error: "invalid body", issues: parsed.error.issues }, 400);
		const note = await createNote(c.env.DB, {
			...parsed.data,
			source: parsed.data.source ?? "captura externa",
		});
		return c.json({ id: note.id, title: note.title, type: note.type }, 201);
	});
}
