# runway

Mini TUI (hecha con [OpenTUI](https://opentui.com/)) que muestra en vivo el usage de tus
suscripciones de **Claude Max** y **Codex (ChatGPT)**: sesión de 5h, límites semanales,
extra usage credits y créditos.

```
╭─ Claude Max ──────────────────────────────╮
│ Sesión 5h    ██████░░░░░░░░  40%  4h 25m  │
│ Semana       ████████░░░░░░  56%  2d 8h   │
│ Extra usage  ██████░░░░░░░░  42%  $83.85 / $200.00
╰───────────────────────────────────────────╯
╭─ Codex (ChatGPT) ─────────────────────────╮
│ Sesión 5h    ░░░░░░░░░░░░░░   1%  4h 59m  │
│ Semana       ███████░░░░░░░  52%  5d 12h  │
│ Créditos     disponibles                  │
╰───────────────────────────────────────────╯
 r refrescar · q salir · actualizado 21:54:27
```

## Requisitos

- [Bun](https://bun.sh)
- Sesión de **Claude Code** en esta máquina (el token se lee del Keychain de macOS,
  entrada `Claude Code-credentials`; fallback: `~/.claude/.credentials.json` o
  `CLAUDE_CODE_OAUTH_TOKEN`)
- Sesión del **Codex CLI** (`codex login` crea `~/.codex/auth.json`)

## Uso

```bash
bun start            # o: bun src/index.ts
```

Teclas: `r` refresca (con throttle de 10 s), `q` o `Ctrl+C` sale.
Auto-refresh cada 3 minutos; los countdowns avanzan cada segundo sin refetch.

Comando global opcional: `make install` compila e instala `runway` en
`~/.local/bin` (o en otro destino con `make install INSTALL_DIR=/usr/local/bin`).
También puedes usar `bun link`, que deja disponible `runway` en el PATH de Bun.

## De dónde salen los datos

| Servicio | Endpoint | Auth |
|---|---|---|
| Claude Max | `GET https://api.anthropic.com/api/oauth/usage` | Bearer del Keychain + `anthropic-beta: oauth-2025-04-20` + `User-Agent: claude-code/<v>` |
| Codex | `GET https://chatgpt.com/backend-api/wham/usage` | Bearer de `~/.codex/auth.json` + header `chatgpt-account-id` |

Si el token de Codex caduca, se refresca contra `https://auth.openai.com/oauth/token`
(mismo flujo y client id que el CLI oficial) y se persiste en `auth.json`.

## Caveats

- **Endpoints internos/no documentados**: son los mismos que usan `/usage` de Claude Code
  y `/status` de Codex, pero pueden cambiar sin aviso. Son solo lectura: lo peor que puede
  pasar es que la CLI muestre un error.
- **No bajes el polling de 180 s** para Claude ni quites el `User-Agent: claude-code/...`:
  sin él, el endpoint responde 429 de forma persistente.
- El token de Claude caduca cada ~60 min y lo refresca Claude Code al usarse; si ves
  "Token caducado", abre Claude Code.
- El refresh token de Codex **rota** en cada refresh: no compartas `auth.json` entre
  máquinas a la vez.
- El extra usage de Claude llega en céntimos de dólar; se muestra como `$usado / $límite`.
- En planes Team/Business de ChatGPT los créditos de Codex son un pool compartido del
  workspace y la API devuelve `balance: null` — el saldo solo se ve en la página de
  facturación del admin en chatgpt.com. El panel muestra el estado del pool, los resets
  de ventana disponibles y la actividad de hoy (de `wham/profiles/me`).
- Los tokens solo se envían a `api.anthropic.com`, `chatgpt.com` y `auth.openai.com`.
  Sin telemetría ni terceros.
