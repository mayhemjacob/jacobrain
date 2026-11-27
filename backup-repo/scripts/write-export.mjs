// Escribe cada nota del export en notes/<id>.md. Nunca borra archivos:
// las notas borradas llegan con `deleted` en el frontmatter.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const data = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (!Array.isArray(data.files)) throw new Error("Export sin 'files'");
for (const f of data.files) {
	if (!/^notes\/n_[0-9A-Z]+\.md$/.test(f.path)) throw new Error(`Ruta inesperada: ${f.path}`);
	mkdirSync(dirname(f.path), { recursive: true });
	writeFileSync(f.path, f.markdown);
}
console.log(`${data.files.length} notas escritas (${data.exported_at})`);
