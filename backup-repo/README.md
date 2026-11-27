# jacobrain-backup

Copia diaria de Jacob's Brain en Markdown: una nota por archivo en `notes/`.
Se puede leer sin el sistema y sirve para reconstruir la base de datos entera.

Restaurar (desde el repo `jacobrain`):

```bash
BRAIN_URL=https://brain.jacobomiralles.com BACKUP_TOKEN=... node scripts/restore.mjs ../jacobrain-backup/notes
```
