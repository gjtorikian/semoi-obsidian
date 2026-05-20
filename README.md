# Semoi — Proof of Writing (for Obsidian)

An Obsidian plugin that captures keystroke evidence while you write and mints a
cryptographic certificate (a "proof") of that session via
[semoi.net](https://semoi.net). The proof gets stamped into the note's
frontmatter, and you get a link to a public verification page.

## What it does

While you type, the plugin watches CodeMirror's change stream and records
each edit as an atom: a single `ins` (insert), `del` (delete), or `rep`
(replace) with a character count and a timestamp relative to the start of the
session. It does **not** record the characters you typed, only the shape of
your editing activity.

When you run the **Mint proof for current note** command, the plugin:

1. Finalizes the active session for that file.
2. Sends the event stream, the current note content, and your client info to
   the backend's `POST /proof` endpoint.
3. Receives back a signed proof (Ed25519) and a verify URL.
4. Writes the proof reference into the note's frontmatter under a `semoi:` key.
5. Opens the verify URL in your default browser.

## Session model

A "session" is a stretch of editing in one file. Sessions live in memory until
you explicitly mint or reset them — there is no idle-rollover and no auto-mint.

Two clocks are tracked per session:

- `startedAt` / `endedAt` — wall-clock bounds. `endedAt - startedAt` is how
  long the session has been _open_, which is usually longer than you were
  actually typing.
- `activeMs` — accumulated **active typing time**. Each gap between
  consecutive keystrokes shorter than the active-typing threshold (default
  5 seconds) adds to this counter; longer gaps don't. So if you type for two
  minutes, walk away for an hour, then type for another minute, the proof
  reports ~3 minutes of active typing across a ~63-minute window.

If you delete the file, its in-memory session is dropped. If you **rename** the
file, the session carries over to the new path so a mid-session rename doesn't
lose captured keystrokes.

## Commands

- **Mint proof for current note** — finalizes the active session and submits it
  to the backend. Fails with a notice if no keystrokes have been captured yet.
- **Show proof status for current note** — reads the most recent `proofId`
  from frontmatter and asks the backend to verify it. Reports `valid` /
  `INVALID` along with the signing key's status.
- **Reset session for current note** — clears the in-memory keystroke buffer
  without minting. Useful if you started typing and don't want that session
  counted.

## Settings

| Setting                           | Notes                                                                                                                             |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Active typing threshold (seconds) | Per-keystroke gap below which the time counts as active typing (default 5). Does not roll sessions over — minting stays explicit. |

The backend URL is baked in at build time (`__SEMOI_BACKEND__` in `esbuild.config.mjs`): `https://semoi.net` for production builds, `http://localhost:3737` for dev.

## Where the proof lives

The proof reference is written into the note's frontmatter (one entry, or an
array of entries if the note has been minted multiple times):

```yaml
---
semoi:
  proofId: <24-char hex id>
  verifyUrl: https://your-backend/v/<id>
  kid: <key id that signed it>
  contentHash: <sha256 of note text at mint time>
  issuedAt: <unix ms>
---
```

The full signed proof — signature, public key, and the full claim — lives on
the backend and is fetched at verify time. The frontmatter entry is the local
pointer to it.

## What the backend sees

The mint payload (`MintPayload` in `src/session.ts`):

- `docId` — vault-relative file path
- `startedAt` / `endedAt` — unix ms (wall-clock bounds)
- `activeMs` — accumulated active typing time across the session
- `events[]` — array of `{ t, k, n }` (relative ms, kind, length)
- `content` — full note text (the backend hashes it; raw text is not stored)
- `client` — `{ name: "semoi-obsidian", version }`

## Build

```sh
npm install
npm run build      # bundles to main.js for distribution
npm run dev        # esbuild in watch mode
npm run typecheck
```

Drop `main.js`, `manifest.json` into
`<vault>/.obsidian/plugins/semoi/` and enable the plugin in Community plugins.

## Source layout

- `src/main.ts` — plugin entry, command wiring, editor extension
- `src/session.ts` — framework-free session tracker and payload builder
- `src/api.ts` — `SemoiApi` HTTP client (`/proof`, `/verify/:id`)
- `src/storage.ts` — frontmatter persistence
- `src/settings.ts` — settings tab

## Release flow

```
./scripts/release.sh patch   # or minor / major / x.y.z
```

The script validates the working tree, runs typecheck + tests + build,
then `npm version` bumps `package.json`, `manifest.json`, and
`versions.json`, commits, and creates a bare signed tag (no `v` prefix —
Obsidian requires this). The push triggers `.github/workflows/release.yml`,
which rebuilds on CI, attests `main.js` build provenance, and uploads
`main.js` + `manifest.json` to a draft GitHub release. Review and publish
from the GitHub UI.
