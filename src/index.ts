import { env } from "cloudflare:workers";
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { GitHubHandler } from "./github-handler";
import {
	createNote,
	getContext,
	getNote,
	listRecent,
	NOTE_TYPES,
	searchNotes,
	updateNote,
	VISIBILITIES,
} from "./notes";
import type { Props } from "./utils";

const INSTRUCTIONS = `Jacob's Brain es el segundo cerebro de Jacobo Miralles: guarda lo que lee, lo que decide, cómo piensa (su criterio) y cómo escribe (su voz).

Cuándo usar cada herramienta:
- get_context: al empezar una conversación en la que te sirva saber quién es Jacobo, sus prioridades o su criterio, y siempre antes de escribir algo en su nombre.
- search: antes de responder sobre algo que Jacobo pueda haber guardado (personas, proyectos, decisiones, lecturas) y SIEMPRE antes de capture, para no duplicar. La búsqueda es por palabras: si no hay resultados, prueba sinónimos o términos más cortos.
- capture: cuando Jacobo pida guardar algo, o cuando en la conversación aparezca una decisión, un criterio, una idea o una lectura que valga la pena recordar (en ese caso, propónselo antes de guardarlo). Una idea por nota, con un título que se entienda solo.
- update_note: si ya existe una nota sobre el tema, amplíala (append) o corrígela en vez de crear otra.

Tipos de nota: nota, idea, decision, lectura, persona, tarea, criterio (cómo decide), principio (reglas generales), voz (estilo de escritura y ejemplos), termino (glosario propio: Nova, BX, Canon…), perfil (quién es y en qué está).

No guardes contraseñas, datos bancarios, datos de salud ni correos o teléfonos de terceros.`;

const noteType = z.enum(NOTE_TYPES);
const json = (data: unknown) => ({
	content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});
const notFound = (id: string) => ({
	content: [{ type: "text" as const, text: `No existe ninguna nota con id ${id}` }],
	isError: true,
});

function createServer() {
	const server = new McpServer(
		{ name: "Jacob's Brain", version: "0.1.0" },
		{ instructions: INSTRUCTIONS },
	);
	const db = env.DB;

	server.registerTool(
		"get_context",
		{
			description:
				"Devuelve el perfil de Jacobo y sus notas fijadas (criterios, principios, voz, prioridades), más el recuento de notas por tipo.",
			inputSchema: z.object({}),
		},
		async () => json(await getContext(db)),
	);

	server.registerTool(
		"capture",
		{
			description: "Guarda una nota nueva en el cerebro. Busca antes con search para no duplicar.",
			inputSchema: z.object({
				title: z.string().min(1).max(300).describe("Título que se entienda sin leer la nota"),
				content: z.string().min(1).describe("Cuerpo en Markdown"),
				type: noteType,
				tags: z.array(z.string()).optional().describe("Etiquetas en minúscula, p.ej. ['ia','nova']"),
				source: z.string().optional().describe("URL o procedencia, p.ej. 'conversación con Claude'"),
				pinned: z.boolean().optional().describe("true para que salga siempre en get_context"),
				visibility: z.enum(VISIBILITIES).optional().describe("private (por defecto) o shareable"),
			}),
		},
		async (input) => {
			const n = await createNote(db, input);
			return json({ saved: true, id: n.id, title: n.title, type: n.type });
		},
	);

	server.registerTool(
		"search",
		{
			description:
				"Busca notas por palabras clave (título, contenido y etiquetas). Devuelve id, título y un fragmento; usa get_note para leer una completa.",
			inputSchema: z.object({
				query: z.string().min(1),
				type: noteType.optional(),
				tags: z.array(z.string()).optional().describe("Solo notas que tengan todas estas etiquetas"),
				limit: z.number().int().min(1).max(50).optional(),
			}),
		},
		async (input) => json(await searchNotes(db, input)),
	);

	server.registerTool(
		"get_note",
		{
			description: "Devuelve una nota completa por su id.",
			inputSchema: z.object({ id: z.string() }),
		},
		async ({ id }) => {
			const n = await getNote(db, id);
			return n ? json(n) : notFound(id);
		},
	);

	server.registerTool(
		"update_note",
		{
			description:
				"Corrige o amplía una nota. Pasa solo los campos que cambian. 'append' añade texto al final; 'deleted: true' la borra (borrado lógico, recuperable con 'deleted: false').",
			inputSchema: z.object({
				id: z.string(),
				title: z.string().min(1).max(300).optional(),
				content: z.string().optional().describe("Reemplaza el cuerpo entero"),
				append: z.string().optional().describe("Texto que se añade al final del cuerpo"),
				type: noteType.optional(),
				tags: z.array(z.string()).optional().describe("Reemplaza las etiquetas"),
				source: z.string().nullable().optional(),
				pinned: z.boolean().optional(),
				visibility: z.enum(VISIBILITIES).optional(),
				deleted: z.boolean().optional(),
			}),
		},
		async ({ id, ...patch }) => {
			const n = await updateNote(db, id, patch);
			return n ? json({ updated: true, note: n }) : notFound(id);
		},
	);

	server.registerTool(
		"list_recent",
		{
			description: "Últimas notas guardadas o editadas.",
			inputSchema: z.object({
				limit: z.number().int().min(1).max(50).optional(),
				type: noteType.optional(),
			}),
		},
		async (input) => json(await listRecent(db, input)),
	);

	return server;
}

const mcpHandler = createMcpHandler(createServer);
const apiHandler = {
	fetch(request: Request, bindings: Env, ctx: ExecutionContext) {
		// Doble control: aunque el login ya filtra en /callback, rechazamos cualquier token de otro usuario.
		const props = (ctx as ExecutionContext & { props?: Props }).props;
		if (!props || props.login !== bindings.ALLOWED_GITHUB_LOGIN) {
			return new Response("Forbidden", { status: 403 });
		}
		return mcpHandler(request, bindings, ctx);
	},
} satisfies ExportedHandler<Env>;

export default new OAuthProvider<Env>({
	apiHandler,
	apiRoute: "/mcp",
	authorizeEndpoint: "/authorize",
	clientRegistrationEndpoint: "/register",
	defaultHandler: GitHubHandler as any,
	tokenEndpoint: "/token",
	resourceMetadata: { resource: env.MCP_RESOURCE },
});
