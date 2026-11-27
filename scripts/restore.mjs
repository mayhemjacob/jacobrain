// Restaura notas desde el backup: lee <dir>/*.md y las envía a POST /import.
// Uso: BRAIN_URL=... BACKUP_TOKEN=... node scripts/restore.mjs <dir-notes>
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [dir] = process.argv.slice(2);
const { BRAIN_URL, BACKUP_TOKEN } = process.env;
if (!dir || !BRAIN_URL || !BACKUP_TOKEN) {
	console.error("Uso: BRAIN_URL=... BACKUP_TOKEN=... node scripts/restore.mjs <dir-notes>");
	process.exit(1);
}
const files = readdirSync(dir)
	.filter((f) => f.endsWith(".md"))
	.map((f) => ({ path: `notes/${f}`, markdown: readFileSync(join(dir, f), "utf8") }));

let imported = 0;
const errors = [];
for (let i = 0; i < files.length; i += 50) {
	const res = await fetch(`${BRAIN_URL}/import`, {
		method: "POST",
		headers: { Authorization: `Bearer ${BACKUP_TOKEN}`, "Content-Type": "application/json" },
		body: JSON.stringify({ files: files.slice(i, i + 50) }),
	});
	if (!res.ok) throw new Error(`/import respondió ${res.status}: ${await res.text()}`);
	const r = await res.json();
	imported += r.imported;
	errors.push(...r.errors);
}
console.log(`${imported}/${files.length} notas restauradas`);
if (errors.length) {
	console.error("Errores:", errors);
	process.exit(1);
}
