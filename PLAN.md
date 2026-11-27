# Plan: Jacob's Brain (MVP en la nube + MCP)

> Segundo cerebro propio, alojado en la nube y accesible desde Claude (o cualquier cliente MCP).
> Versión 2 — 27/11/2026. Parte de `../memorybrain/PLAN-memorybrain-personal.md`, con ajustes técnicos y las ideas de la charla de Carlos Moya (25/11/2026).
> Revisa precios y límites antes de empezar: cambian.

---

## 1. Objetivo

- Un cerebro personal donde **yo aloje mi información**, sin depender de un servicio de terceros.
- **Que no dependa de ningún ordenador mío.**
- Accesible desde **Claude** (web, móvil, escritorio, Claude Code) y otros clientes **mediante un servidor MCP remoto**.
- Que guarde **no solo lo que leo, sino mi criterio**: cómo decido, qué priorizo y cómo escribo.
- **MVP a 0 €/mes.**

## 2. Decisiones tomadas

| Decisión | Elección | Motivo |
|---|---|---|
| Alojamiento | **Cloudflare**, en la cuenta que ya tengo para la web personal | Un solo proveedor, siempre encendido (no se pausa como Supabase gratis), plantilla oficial de MCP remoto con OAuth |
| Supabase / Vercel | **No se usan** | Supabase es de Canon: no mezclar datos, y el plan gratuito pausa por inactividad. Vercel no aporta nada aquí |
| Lenguaje | **TypeScript** | SDK de MCP + Workers |
| Almacén principal | **D1** (SQLite) | Gratis, FTS5, Time Travel |
| Búsqueda en el MVP | **FTS5** (palabras clave) | Claude reformula las consultas; la semántica llega después |
| Copia de seguridad | **Markdown diario en repo privado de GitHub** | Segunda copia independiente y legible sin el sistema |
| Acceso | **OAuth con GitHub**, restringido a mi usuario | Es lo que pide claude.ai para un conector remoto |
| Dominio | **`brain.jacobomiralles.com`** (custom domain en Cloudflare, como la web) | 0 €, dominio ya en Cloudflare. `*.workers.dev` queda como respaldo |
| Archivos originales | **Fuera del MVP** | Texto extraído + enlace a la fuente. Más adelante: R2 |
| Nombre | **jacobrain** (Worker, BD, repo) | No confundir con Memory Brain de Carlos |

**Regla de oro:** datos en **dos sitios independientes**, uno legible sin el sistema.

## 3. Arquitectura

```
Claude (web / móvil / desktop / Code)  ─┐
Otros clientes MCP                      ─┤  HTTPS + OAuth (Streamable HTTP)
                                         ▼
                        ┌──────────────────────────────┐
                        │ Cloudflare Worker "jacobrain"│
                        │  MCP: get_context, capture,  │
                        │  search, get_note,           │
                        │  update_note, list_recent    │
                        │  + GET /export (token)       │
                        └───────┬──────────────┬───────┘
                                │              │
                         ┌──────▼─────┐  ┌─────▼──────┐
                         │ D1 (notas  │  │ KV (OAuth / │
                         │ + FTS5)    │  │ sesiones)   │
                         └────────────┘  └────────────┘
                                ▲
                                │ GitHub Action diaria: llama a /export
                                │ y hace UN commit
                   Repo privado GitHub: notes/<id>.md
```

## 4. Datos

### 4.1 Tipos de nota

| Tipo | Para qué |
|---|---|
| `idea`, `nota`, `tarea`, `lectura`, `persona`, `decision` | Lo del plan original |
| `criterio` / `principio` | **Cómo pienso y decido** (idea de Carlos: el cerebro guarda criterio, no solo datos) |
| `voz` | Mi estilo de escritura + textos de ejemplo, para redactar como yo (LinkedIn, etc.) |
| `termino` | Glosario/ontología propia: Nova, BX, Canon, ponentes, jerga. Ayuda a Claude (y más adelante a la transcripción de voz) |
| `perfil` | Quién soy, en qué estoy, prioridades actuales. Lo devuelve `get_context` |

### 4.2 Esquema D1

```sql
CREATE TABLE notes (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT, -- rowid estable para FTS5
  id          TEXT NOT NULL UNIQUE,              -- n_<ULID>, id público
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,                    -- Markdown
  type        TEXT NOT NULL,                    -- ver 4.1
  tags        TEXT NOT NULL DEFAULT '[]',       -- array JSON: ["ia","negocio"]
  source      TEXT,
  visibility  TEXT NOT NULL DEFAULT 'private',  -- private | shareable (para compartir el cerebro en el futuro)
  pinned      INTEGER NOT NULL DEFAULT 0,       -- 1 = entra en get_context
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT                              -- borrado lógico
);

CREATE VIRTUAL TABLE notes_fts USING fts5(
  title, content, tags,
  content='notes', content_rowid='seq',
  tokenize='unicode61 remove_diacritics 2'      -- "decision" encuentra "decisión"
);

CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, title, content, tags)
  VALUES (new.seq, new.title, new.content, new.tags);
END;

CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, content, tags)
  VALUES ('delete', old.seq, old.title, old.content, old.tags);
END;

-- En UPDATE hay que borrar la entrada vieja antes de insertar la nueva,
-- o el índice queda corrupto sin avisar.
CREATE TRIGGER notes_au AFTER UPDATE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, content, tags)
  VALUES ('delete', old.seq, old.title, old.content, old.tags);
  INSERT INTO notes_fts(rowid, title, content, tags)
  VALUES (new.seq, new.title, new.content, new.tags);
END;
```

Notas de búsqueda:
- FTS5 no tiene stemming en español: el Worker añade prefijo a cada término (`idea*` encuentra "ideas").
- Filtrar por etiqueta con `json_each(tags)`.
- Excluir siempre `deleted_at IS NOT NULL`.

### 4.3 Backup en GitHub

- Un archivo por nota: `notes/<id>.md` (el id no cambia al renombrar → sin duplicados ni huérfanos).
- Las notas borradas se exportan con `deleted: true` en el frontmatter (no desaparecen del backup).
- **GitHub Action diaria** llama a `GET /export` del Worker (protegido con un token secreto), escribe los archivos y hace **un solo commit**. Más sencillo que hacer commits desde el Worker con la API de GitHub.

```markdown
---
id: n_01J...
type: criterio
tags: [producto, priorización]
visibility: private
pinned: true
source: conversación con Claude
created: 2026-11-27T10:00:00Z
updated: 2026-11-27T10:00:00Z
deleted: false
---

# Priorizo problemas con usuarios reales antes que features pedidas por stakeholders

Contenido...
```

Script de restauración: `notes/*.md` → D1. Se prueba una vez en el MVP.

### 4.4 Datos sensibles

- **No guardar**: contraseñas, datos bancarios, salud.
- **Datos de terceros**: las notas de los eventos de Nova incluyen correos de asistentes → **quitarlos antes de importar**. Se guardan nombre, empresa y lo que aportaron.
- Cloudflare cifra en reposo pero tiene la llave: aceptable para un cerebro personal general.

## 5. Herramientas MCP

| Herramienta | Entrada | Qué hace |
|---|---|---|
| `get_context` | — | Devuelve las notas `perfil` + `pinned` (quién soy, prioridades, criterios clave, voz). Claude lo llama al empezar |
| `capture` | `title`, `content`, `type`, `tags?`, `source?`, `pinned?` | Crea una nota |
| `search` | `query`, `type?`, `tags?`, `limit?` | FTS5: título + fragmento + id |
| `get_note` | `id` | Nota completa |
| `update_note` | `id`, campos | Corrige o amplía |
| `list_recent` | `limit?`, `type?` | Últimas notas |

**Server instructions del MCP** (clave para que el cerebro se llene solo): cuándo llamar a `get_context`, cuándo proponer `capture` (decisiones, criterios, lecturas, personas), qué `type` elegir y que busque antes de crear para no duplicar.

## 6. Costes

| Pieza | Plan gratuito | Coste |
|---|---|---|
| Workers | 100.000 peticiones/día | 0 € |
| D1 + FTS5 | 5 M lecturas/día, 100.000 escrituras/día, 500 MB | 0 € |
| KV (OAuth) | Incluido | 0 € |
| GitHub (repo privado + Actions) | Gratis | 0 € |
| Dominio | `brain.jacobomiralles.com` (ya en Cloudflare) | 0 € |
| **Total** | | **0 €/mes** |

En el plan gratuito, D1 falla al superar el límite diario en lugar de cobrar.
Siguiente nivel (~5 $/mes Workers Paid): Vectorize, más CPU, Time Travel de 30 días.

## 7. Seguridad

- OAuth obligatorio en `/mcp`; `/export` con token aparte.
- 2FA en Cloudflare y GitHub.
- Repo de backup privado.
- Secretos con `wrangler secret`, nunca en el repo.

## 8. Pasos

1. **Cuentas**: Cloudflare (ya existe) y GitHub. Confirmar 2FA en ambas.
2. **Proyecto**: plantilla oficial de Cloudflare "remote MCP server" con GitHub OAuth. Instalar `wrangler`.
3. **D1**: `wrangler d1 create jacobrain` → migración con el esquema 4.2.
4. **Herramientas**: las 6 del apartado 5 + server instructions.
5. **OAuth**: GitHub OAuth App, restringida a mi usuario.
6. **Desplegar**: en `wrangler.jsonc`, `"routes": [{ "pattern": "brain.jacobomiralles.com", "custom_domain": true }]` (mismo sistema que `webjacob`; Cloudflare crea el DNS solo). `wrangler deploy` → `https://brain.jacobomiralles.com/mcp`.
7. **Conectar**: conector personalizado en claude.ai; en Claude Code `claude mcp add --transport http jacobrain https://brain.jacobomiralles.com/mcp`.
8. **Sembrar**: nota `perfil`, 5–10 `criterio`, una `voz` con textos míos, glosario básico (`termino`).
9. **Backup**: endpoint `/export` + GitHub Action diaria.
10. **Restauración**: script `notes/*.md` → D1, probarlo una vez.
11. **Probar**: guardar, buscar, editar desde Claude móvil y Code; forzar backup y restauración.
12. **Primer contenido real**: notas de los 7 eventos de Nova, sin correos de asistentes.

## 9. Hoja de ruta después del MVP

1. Búsqueda semántica: Workers AI (`bge-m3`) + Vectorize → búsqueda híbrida.
2. **Compartir el cerebro** (idea de Carlos): acceso de solo lectura para otros a las notas `shareable`, con su propio login.
3. Ingesta: pasar URL/PDF/vídeo y que extraiga notas automáticamente.
4. Generar cursos o explicaciones a partir de mis fuentes.
5. Voz: transcripción (Whisper) usando el glosario `termino`.
6. Archivos originales en R2.
7. Relaciones entre notas y vista de grafo.

## 10. Verificar antes de empezar

- [ ] Límites actuales del plan gratuito de Workers, D1 y KV.
- [ ] Plantilla vigente de Cloudflare para MCP remoto con GitHub OAuth.
- [ ] Cómo añadir un conector remoto en claude.ai hoy.
- [ ] Si Vectorize tiene plan gratuito (para la fase 2).

## Fuentes

- [Workers: precios](https://developers.cloudflare.com/workers/platform/pricing/)
- [Workers: límites](https://developers.cloudflare.com/workers/platform/limits/)
- [D1: límites](https://developers.cloudflare.com/d1/platform/limits/)
- [D1: changelog](https://developers.cloudflare.com/changelog/product/d1/)
- [Workers AI: precios](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- Notas de Gemini de la charla "Rent Your Brain with AI" (Carlos Moya, Nova, 25/11/2026)
