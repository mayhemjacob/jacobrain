// Formato del backup: un archivo Markdown por nota, legible sin el sistema.
// Cada valor del frontmatter va en JSON (que también es YAML válido),
// así se puede volver a leer sin ambigüedad para restaurar.

import { NOTE_TYPES, VISIBILITIES, type Note } from "./notes";

export function notePath(n: Note): string {
	return `notes/${n.id}.md`;
}

export function toMarkdown(n: Note): string {
	const fm: Record<string, unknown> = {
		id: n.id,
		title: n.title,
		type: n.type,
		tags: n.tags,
		source: n.source,
		visibility: n.visibility,
		pinned: n.pinned,
		created: n.created_at,
		updated: n.updated_at,
		deleted: n.deleted_at,
	};
	const header = Object.entries(fm)
		.map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
		.join("\n");
	return `---\n${header}\n---\n\n# ${n.title}\n\n${n.content}\n`;
}

export function fromMarkdown(text: string): Note {
	const m = text.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/);
	if (!m) throw new Error("Falta el frontmatter");
	const fm: Record<string, any> = {};
	for (const line of m[1].split("\n")) {
		const i = line.indexOf(": ");
		if (i > 0) fm[line.slice(0, i)] = JSON.parse(line.slice(i + 2));
	}
	let body = m[2];
	const heading = `# ${fm.title}\n\n`;
	if (body.startsWith(heading)) body = body.slice(heading.length);
	else if (body.startsWith(`# ${fm.title}\n`)) body = body.slice(`# ${fm.title}\n`.length);
	body = body.replace(/\n$/, "");

	if (typeof fm.id !== "string" || typeof fm.title !== "string") throw new Error("Faltan id o title");
	if (!NOTE_TYPES.includes(fm.type)) throw new Error(`Tipo desconocido: ${fm.type}`);
	return {
		id: fm.id,
		title: fm.title,
		content: body,
		type: fm.type,
		tags: Array.isArray(fm.tags) ? fm.tags : [],
		source: fm.source ?? null,
		visibility: VISIBILITIES.includes(fm.visibility) ? fm.visibility : "private",
		pinned: fm.pinned === true,
		created_at: fm.created,
		updated_at: fm.updated,
		deleted_at: fm.deleted ?? null,
	};
}
