# CLAUDE.md

Guidance for AI assistants working in this repository. Read this before making
non-trivial changes — the project pairs a browser extension with an Electron
desktop app, and the two halves share a strict on-disk format that other code
relies on.

## Project overview

MakerWorld Helper is a tool for archiving 3D-printing model pages from
`makerworld.com.cn` / `makerworld.com` to a local library and browsing what's
been saved. It has two cooperating components:

- **Browser extension (MV3)** at the repo root — captures the page, downloads
  pictures and `.3mf` files, writes a fixed directory layout to a user-chosen
  folder via the File System Access API.
- **Desktop client (Electron + React + Vite)** under `client/` — scans a root
  directory of saved projects, reads `metadata.json` / `save-manifest.json`,
  supports search, repository management, project moves, and 3MF import.

A legacy in-extension library page exists at `library/library.{html,js,css}`
that mirrors the desktop client's read flow inside the browser. New library
features should go into the Electron client; only touch the legacy page if a
bug specifically affects it.

UI strings are in **Simplified Chinese**. Code identifiers, comments where
they exist, and IPC channel names are in English.

## Repository layout

```
.
├── manifest.json              # MV3 manifest (host perms, content scripts)
├── background.js              # Service worker; routes popup ↔ content script
├── src/content.js             # Parses __NEXT_DATA__, calls design-service API
├── popup/                     # Extension popup UI (vanilla JS + HTML/CSS)
│   ├── popup.html
│   ├── popup.js               # Save flow: File System Access API → disk
│   └── popup.css
├── library/                   # Legacy in-extension library viewer (vanilla JS)
│   ├── library.html
│   ├── library.js
│   └── library.css
├── client/                    # Electron desktop app (active development)
│   ├── electron/
│   │   ├── main.js            # Main process: IPC, scan, import, custom protocol
│   │   └── preload.js         # Exposes window.desktopAPI to renderer
│   ├── src/
│   │   ├── main.jsx           # React entry; HashRouter + StrictMode
│   │   ├── App.jsx            # Library state, modals, dialog plumbing
│   │   ├── pages/LibraryPage.jsx
│   │   └── styles.css
│   ├── scripts/
│   │   ├── bump-version.js    # Bumps patch in package.json + lock
│   │   └── generate-icon.ps1  # Windows-only icon generator (PowerShell)
│   ├── vite.config.js         # Vite on 127.0.0.1:5173, base "./"
│   ├── index.html
│   └── package.json           # electron-builder config lives here
├── .github/workflows/build-desktop-release.yml
├── README.md                  # User-facing overview (Chinese)
└── TODO_DESKTOP_V3.md         # Roadmap for desktop perf work
```

There is no test suite, no linter config, and no formatter config. Match the
surrounding style instead of running a tool.

## The on-disk project format (canonical)

Both halves of the app read and write the same layout. Do not invent new
top-level files; if you need to store more data, extend `save-manifest.json`
or `metadata.json` rather than adding sibling files. Current `parserVersion`
is `2`.

```
<rootPath>/
├── <repoName>/                  # optional grouping folder
│   ├── .mw-repo.json            # marker proving this dir is a managed repo
│   └── <projectFolder>/
│       ├── metadata.json        # parsed page data; the source of truth
│       ├── save-manifest.json   # what was actually written + file index
│       ├── summary.txt
│       ├── source-url.txt
│       ├── download-hints.json
│       ├── comments-preview.json
│       ├── creator/avatar.jpg
│       ├── model/
│       │   ├── files/
│       │   └── images/{cover.jpg,cover-landscape.jpg,cover-portrait.jpg,detail-*.jpg}
│       └── instances/
│           └── <instanceId>-<slugified-title>/
│               ├── instance.json
│               ├── instance-cover.{jpg|png|webp|gif|jpeg}
│               ├── files/                # .3mf, .stl, .zip, .step, .obj, .amf
│               └── plates/plate-*.png
└── <projectFolder>/             # projects may also live directly in root
```

Key invariants other code relies on:

- A directory is treated as a **project** iff it contains `metadata.json`.
- A directory is treated as a **repo** iff it contains `.mw-repo.json`, or it
  contains at least one project (in which case the desktop app creates the
  marker on first scan — see `ensureRepoMarker` in `client/electron/main.js`).
- Instance directory names come from `getInstanceDirectoryName` /
  `sanitizeFolderName` (`<id>-<title>`, replacing `<>:"/\\|?*` and control
  chars with `-`). The exact same slugging logic lives in `src/content.js`
  (`slugifySegment`) and `popup/popup.js` (`sanitizeName`) — if you change one,
  change all three.
- Supported model file extensions: `3mf, stl, zip, step, stp, obj, amf`
  (`MODEL_FILE_EXTENSIONS` in `client/electron/main.js`). Update both this set
  and any UI affordances if you add a format.
- `INVALID_COMPATIBILITY_CODES = {"O1D", "O1S", "N1"}` is duplicated in
  `src/content.js`, `popup/popup.js`, and `client/electron/main.js`. These are
  internal Bambu codenames that must be filtered out of user-visible printer
  compatibility strings; keep the three copies in sync.

## How the extension half works

1. User clicks the toolbar icon → `popup/popup.html` opens.
2. Popup → `chrome.runtime.sendMessage({type: "mwqs:get-active-model"})` →
   `background.js` finds the active tab, validates it's a MakerWorld model
   page (`isMakerWorldModelPage`), and forwards `mwqs:extract-model` to the
   content script. If the content script isn't loaded yet, background falls
   back to `chrome.scripting.executeScript` to inject `src/content.js` and
   retries.
3. `src/content.js` re-fetches the page HTML to get a fresh `__NEXT_DATA__`
   payload (cookies included), parses it, and for each instance calls
   `/api/v1/design-service/instance/<id>/f3mf?type=download` with the
   `X-BBL-Client-*` headers to obtain a short-lived signed `.3mf` URL.
   Returns a normalized record (see `buildModelRecord`).
4. Popup renders the summary; on "保存" the user picks a directory via
   `showDirectoryPicker` and `saveAssets` writes the layout above. If a signed
   `.3mf` URL has already expired (`shouldRefreshRecordDownloads`), the popup
   re-runs extraction first.

Captcha / HTTP 418 from the design-service API means the user must complete
the MakerWorld page's "I'm not a robot" check in their browser tab and retry.
The string "not a robot" and HTTP codes 418/429/5xx are matched by
`isRetryableDownloadError` and `isCaptchaBlockedMessage`; preserve these if
you touch error handling.

Host permissions in `manifest.json` must include any new asset CDN you decide
to fetch from — currently `makerworld.com[.cn]`, `makerworld.bblmw.cn`, and
the Bambu/Maker CDNs.

## How the desktop client works

The renderer never touches `fs` or `electron` directly. Everything goes
through `window.desktopAPI` (defined in `client/electron/preload.js`) and is
handled by `ipcMain.handle("<channel>", ...)` in `client/electron/main.js`.
IPC channels:

| Renderer call                           | Channel                          |
|-----------------------------------------|----------------------------------|
| `pickDirectory()`                       | `dialog:pick-directory`          |
| `openPath(path)`                        | `shell:open-path`                |
| `openExternal(url)`                     | `shell:open-external`            |
| `showInstanceContextMenu(path)`         | `instance:show-context-menu`     |
| `readLibraryCache(rootPath)`            | `library:read-cache`             |
| `scanRoot(rootPath)`                    | `library:scan-root`              |
| `refreshProject(rootPath, projectPath)` | `library:refresh-project`        |
| `import3mf(rootPath, targetDirectory)`  | `library:import-3mf`             |
| `createRepo / renameRepo / deleteRepo`  | `library:create/rename/delete-repo` |
| `moveProject / deleteProject`           | `library:move-project / delete-project` |

To add a new capability, add it in **all three** places: the IPC handler in
`main.js`, the `contextBridge.exposeInMainWorld` entry in `preload.js`, and
the React caller. The renderer guards every call with `?.` because
`window.desktopAPI` is undefined when Vite is opened in a plain browser
(`hasDesktopApi` check in `App.jsx`); keep that pattern.

Local assets are served via a custom protocol `mwlocal://local/<encoded-path>`
registered in `app.whenReady().then(...)`. Image URLs include `?v=<mtimeMs>`
so the renderer's cache invalidates when files change on disk. Don't bypass
this by switching to `file://` — Electron's strict origin rules will break
`<img>` loading.

### Scan and cache behavior

- `scanRootDirectory` walks the root once, treating any subdirectory with a
  `metadata.json` as a root-level project and everything else as a candidate
  repo (skipping empty unmarked directories).
- Per-project results are reused via `cacheFingerprint` — a `|`-joined string
  of size+mtime for `metadata.json`, `save-manifest.json`, `instances/`, and
  `model/images/`. Bump `LIBRARY_CACHE_VERSION` if you change the shape of
  cached project objects; old caches will be ignored automatically.
- Cache lives at `app.getPath("userData")/library-cache/<sha1(rootPath)>.json`.
- `App.jsx` first calls `readLibraryCache` to paint a stale snapshot, then
  calls `scanRoot` to refresh — preserve this two-phase flow when you add new
  startup work; `TODO_DESKTOP_V3.md` is the roadmap for finer incremental
  scans.

### 3MF import

`importSingle3mfProject` synthesizes a `metadata.json` / `save-manifest.json`
from a user-supplied `.3mf` so imported files coexist with web-saved ones.
Source of fields:

- `3D/3dmodel.model` → `<metadata>` entries (Title, Designer, Description,
  License, CreationDate, ModificationDate, DesignerUserId).
- `Metadata/project_settings.config` → filament list and printer compatibility
  (`printer_model`, `print_compatible_printers`, `upward_compatible_machine`).
- `Auxiliaries/.thumbnails/thumbnail_middle.png` (preferred) or the first
  `Auxiliaries/Model Pictures/*` → cover image.
- `Metadata/plate_*.png|jpg|jpeg|webp` → plate thumbnails.

If you change the synthesized metadata shape, also check `readProject` and the
`LibraryPage` rendering paths that consume those fields.

## Development workflows

### Browser extension

There's no build step. To iterate:

1. Open `chrome://extensions` or `edge://extensions`, enable Developer Mode.
2. "Load unpacked" → select the repo root.
3. After edits, hit the reload button on the extension card. Content-script
   changes also require reloading the MakerWorld tab.

Test against a real MakerWorld model page — the page must contain a populated
`#__NEXT_DATA__` script tag.

### Desktop client

All commands run from `client/`. Node 20 is what CI uses.

```bash
cd client
npm install                # first time only
npm run dev:desktop        # vite + electron with hot reload
npm run dev                # vite-only (renderer in a browser, no IPC)
npm run build              # vite build → client/dist
npm run pack:desktop       # unpacked Electron build to client/release
npm run dist:desktop       # NSIS installer for Windows x64
npm run dist:desktop:patch # bump patch version then build installer
npm run icon:desktop       # regenerates build/icon.ico (Windows only)
```

`npm run dev:desktop` runs `concurrently` over Vite and an `electron .` that
waits on `http://127.0.0.1:5173`. The main process retries `loadURL` once
after a `did-fail-load`; if dev keeps failing, check that port 5173 is free
(it uses `strictPort: true`).

There are no automated tests or linters. Verify changes by running
`dev:desktop` and exercising the affected flows.

### Release flow

- Tag `v*` on `master` (or trigger `workflow_dispatch`) — `.github/workflows/
  build-desktop-release.yml` runs `npm ci && npm run dist:desktop` on
  `windows-latest` and, for tagged runs, uploads `client/release/*.exe`,
  `*.blockmap`, and `*.zip` to the GitHub release.
- macOS / Linux packaging targets are not yet configured; see
  `TODO_DESKTOP_V3.md §7` before adding them.

## Coding conventions

- JavaScript only — no TypeScript anywhere in this repo. Don't introduce it.
- React function components with hooks; no class components.
- 2-space indent, double quotes, semicolons, trailing newlines.
- Use named functions inside components (`function handleFoo() {}`) rather
  than arrow-assigned helpers, matching the existing style.
- IPC handlers return `{ ok: true, ...payload }` on success and
  `{ ok: false, error: "<chinese message>" }` on failure. The renderer
  surfaces `result.error` directly to the user via `setStatus`, so error
  strings must be Chinese end-user copy.
- User-facing strings (status text, button labels, dialog titles) are
  Simplified Chinese. Keep that consistent in any new UI.
- Don't use `alert/confirm/prompt` in the React app — use
  `requestTextDialog`, `requestConfirmDialog`, `requestChoiceDialog` from
  `App.jsx` and the `ModalShell`-based components.
- Use `path.join` everywhere; never string-concatenate filesystem paths.
- Validate caller paths with `isPathInside(rootPath, targetPath)` before any
  destructive op — the desktop app does this on import/delete and you should
  too.
- `removeDirectorySafely` prefers `shell.trashItem` and falls back to
  `fs.rm` with retries for `EBUSY`/`EPERM`/`ENOTEMPTY`. Reuse it; don't roll
  your own delete.
- `electron-builder` config sits under `"build"` in `client/package.json`.
  Keep `directories.output` at `release` so CI's artifact glob still matches.

## Git workflow

- Active branch for this task: `claude/claude-md-docs-A2DGP`. Develop here,
  commit, push to the same branch.
- `master` is the release branch; tagged commits there trigger the Windows
  build. Do not push directly to `master`.
- Don't open PRs unless asked.
- `client/package.json` and `client/package-lock.json` versions are bumped
  together by `scripts/bump-version.js` — invoke it via
  `npm run version:patch` (or the combined `npm run dist:desktop:patch`)
  rather than hand-editing.
- `manifest.json` version (extension) and `client/package.json` version
  (desktop) are tracked independently; bump only the one you ship.

## When in doubt

- Field names from `__NEXT_DATA__`: read `buildModelRecord` and `mapInstance`
  in `src/content.js`.
- Project record shape consumed by the React UI: read `readProject` in
  `client/electron/main.js` — it's the schema bridge between disk and the
  renderer.
- What gets saved to disk and under what name: `saveAssets` and the manifest
  construction in `popup/popup.js`.
- Roadmap and architectural intent for upcoming desktop work:
  `TODO_DESKTOP_V3.md`.
