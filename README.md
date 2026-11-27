# Jacob's Brain

Segundo cerebro personal de Jacobo, alojado en Cloudflare y accesible desde Claude (o cualquier cliente MCP) en `https://brain.jacobomiralles.com/mcp`.

- **Plan y decisiones:** [PLAN.md](PLAN.md)
- **Stack:** Cloudflare Workers + D1 (SQLite con FTS5) + KV, OAuth con GitHub (solo `mayhemjacob`)
- **Backup:** Markdown diario en un repo privado aparte (`backup-repo/` es la plantilla)

## Herramientas MCP

`get_context`, `capture`, `search`, `get_note`, `update_note`, `list_recent`.

## Endpoints HTTP (con token propio)

| Ruta | Token | Uso |
|---|---|---|
| `GET /export` | `BACKUP_TOKEN` | Todas las notas en Markdown (GitHub Action) |
| `POST /import` | `BACKUP_TOKEN` | Restaurar desde el backup (`scripts/restore.mjs`) |
| `POST /capture` | `CAPTURE_TOKEN` | Crear nota desde fuera (Pally, atajos…) |

```bash
curl -X POST https://brain.jacobomiralles.com/capture \
  -H "Authorization: Bearer $CAPTURE_TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"…","content":"…","type":"idea","tags":["ia"]}'
```

## Desarrollo local

```bash
npm install
cp .dev.vars.example .dev.vars   # y rellena los valores
npx wrangler d1 migrations apply jacobrain --local
npm run dev
```

Nota: en local, `wrangler dev` reescribe el host a `brain.jacobomiralles.com` por la ruta de dominio propio, así que el descubrimiento OAuth solo se puede probar desplegado.
