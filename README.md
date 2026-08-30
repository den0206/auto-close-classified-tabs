<p align="center">
  <img src="media/icon.png" width="128" alt="Auto Close Classified Tabs">
</p>

# Auto Close Classified Tabs

Closes tabs you are not using, and colors tab labels by file type.
Japanese version: [README_JP.md](README_JP.md)

- Unsaved tabs are **never** closed
- Keep as many tabs as you want (default 3, counted per editor group)
- Pinned tabs are excluded from auto close
- Tab labels get a color and a badge (`TS`, `PY`, `DA`, …) based on the file type

<p align="center">
  <img src="media/demo.gif" width="1148" alt="Unused tabs closing on their own while the remaining tab labels stay colored by file type">
</p>

## Getting started

```bash
npm install
npm run compile
```

Open this folder in VS Code and press `F5` to launch an Extension Development Host.
To install it for real, run `npm run package` and install the `.vsix` it writes to `vsix/`.

### One-time setup: put the colors on tabs only

VS Code draws decorations on tabs only when two settings are on (older versions ship them
off), and the Explorer keeps its own decorations on. The extension offers to line all four
up once per window, or you can run the command yourself:

> **Auto Close Classified Tabs: Show Type Colors on Tabs Only**

```jsonc
"workbench.editor.decorations.colors": true,   // colors on tabs
"workbench.editor.decorations.badges": true,   // badges on tabs
"explorer.decorations.colors": false,          // Explorer stays plain
"explorer.decorations.badges": false
```

The `explorer.decorations.*` pair is shared by every decoration provider, so turning them
off also **removes what Git and the problem markers put in the Explorer** — the file name
colors and the `M` / `U` / error-count badges on the right. A provider cannot tell whether
the Explorer or a tab is asking, so this is the only way to keep the decorations on tabs
alone. Set either back to `true` if you would rather have the Git markers, or run

> **Auto Close Classified Tabs: Restore Default Colors and Badges**

to drop all four settings and get the VS Code defaults back.

## Keeping a tab open

Right-click the tab → **Protect From Auto Close (Toggle Pin)**.

This toggles the built-in pin, so there is no separate list to keep in sync and nothing
gets written anywhere. The standard "Pin" menu entry and `Ctrl/Cmd+K Shift+Enter` do the
same thing.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `autoCloseClassifiedTabs.enabled` | `true` | Close unused tabs automatically |
| `autoCloseClassifiedTabs.maxTabs` | `3` | Tabs to keep per editor group |
| `autoCloseClassifiedTabs.maxTabsByType` | `{"diff": 1}` | Per-type limits, applied before `maxTabs` |
| `autoCloseClassifiedTabs.closePreviewFirst` | `true` | Close preview (italic) tabs first |
| `autoCloseClassifiedTabs.colors.enabled` | `true` | Color tab labels and show badges |
| `autoCloseClassifiedTabs.colors.rules` | `{}` | Override the type of a file |

### Limiting a type to a few tabs

`maxTabsByType` caps how many tabs of one kind may be open at once, and it runs **before**
`maxTabs`. Diffs are capped at 1 out of the box — a diff you opened three files ago is
almost never one you still want. Keys are the color names from the table below, and a type
you do not list is bound only by `maxTabs`, which is what keeps your actual code files out
of it.

```jsonc
"autoCloseClassifiedTabs.maxTabsByType": {
  "diff": 1,        // one diff at a time
  "generated": 1,   // generated files come and go
  "docs": 2,        // a couple of markdown files
  "json": 2
}
```

Setting a type to `0` closes every tab of that kind as soon as you leave it. Unsaved,
pinned and active tabs are still never closed, so a limit can be exceeded when the tabs
holding it up are protected.

A key in `colors.rules` containing `/` matches anywhere in the path; otherwise it matches
the end of the path.

```jsonc
"autoCloseClassifiedTabs.colors.rules": {
  ".proto":   "sql",
  "docs/":    "docs",
  "src/api/": "typescript"
}
```

## Colors

One color per language or file format, 26 in all. Two settings files in different formats
(`settings.json` and `pubspec.yaml`) get different colors, so tabs stay distinguishable
even when they are the same kind of file.

| Color | Matches |
|---|---|
| `diff` | diff editors, Git versions of a file |
| `test` | `*.test.*` `*_test.*` `*.spec.*`, `test/` |
| `generated` | `*.g.dart` `*.freezed.dart` `*.d.ts` `*.lock`, `node_modules/` |
| `docs` | `.md` `.txt` `.rst` `.pdf` `LICENSE` |
| `json` | `.json` `.jsonc` `.json5` |
| `yaml` | `.yaml` `.yml` |
| `toml` | `.toml` `.ini` `.properties` |
| `env` | `.env` |
| `sql` | `.sql` `.proto` `.graphql` |
| `shell` | `.sh` `.bash` `.zsh` `.ps1` `.lua` `.pl` `.r` |
| `docker` | `Dockerfile` `Makefile` |
| `typescript` | `.ts` `.tsx` `.mts` `.cts` |
| `javascript` | `.js` `.jsx` `.mjs` `.cjs` |
| `dart` | `.dart` |
| `python` | `.py` `.pyi` |
| `go` | `.go` |
| `rust` | `.rs` |
| `jvm` | `.java` `.kt` `.kts` `.scala` |
| `swift` | `.swift` `.m` `.mm` |
| `ruby` | `.rb` |
| `php` | `.php` |
| `cfamily` | `.c` `.h` `.cpp` `.hpp` `.zig` |
| `csharp` | `.cs` |
| `html` | `.html` `.vue` `.svelte` |
| `css` | `.css` `.scss` `.sass` `.less` |
| `xml` | `.xml` `.svg` |

Dotfiles are matched by name, since they have no usable extension: `.gitignore`
`.eslintignore` `.editorconfig` `.npmrc` go to `toml`, `.eslintrc` `.prettierrc` to
`json`, and `.env` — along with `.env.local` and friends — to `env`. A dotfile that does
carry a real extension keeps that format's color, so `.eslintrc.json` is JSON green and
`.eslintrc.yaml` is YAML mint.

Rules are checked in this order: diff, test, generated, then the extension. Your
`colors.rules` entries override the **color** and leave the icon alone. When more than one
of your rules matches a file, the **longest key wins**, so reordering `settings.json` never
changes a color.

Colors are contributed as theme colors, so you can change any of them:

```jsonc
"workbench.colorCustomizations": {
  "autoCloseClassifiedTabs.python": "#ff9900"
}
```

### Badges do not appear on tabs

`FileDecoration` badges (`TS`, `PY`, `{}`) show up in the Explorer but **not on editor
tabs** — VS Code only draws the decoration color there. If the color alone is not enough,
add the type icons below; that is the only way to get a symbol onto a tab.

## Type icons in tab names (optional)

Run **Auto Close Classified Tabs: Add Type Icons to Tab Names** and the extension writes emoji
patterns into `workbench.editor.customLabels.patterns`, so `main.dart` shows up as
`🎯 main.dart` next to its color. Each extension gets its own symbol, so `{} settings.json`
and `📋 pubspec.yaml` differ even where the colors are close. It writes about 42 patterns, dotfiles included.

**Remove Type Icons From Tab Names** takes out exactly the patterns it wrote and leaves
any you added yourself.

## What gets stored

Nothing.

- No `globalState` or `workspaceState`
- No files written, no network access, no telemetry
- File contents are never read — only the path string is inspected
- Zero runtime dependencies

Tab usage order lives in memory and goes away when the window closes. Settings are only
written by **Show Type Colors on Tabs Only** and **Add Type Icons to Tab Names**, and each
has a command that undoes it (**Restore Default Colors and Badges** / **Remove Type Icons
From Tab Names**).

## Development

```bash
npm run typecheck   # tsc --noEmit
npm test            # unit tests (60, no VS Code needed)
npm run test:e2e    # integration tests (12, launches VS Code)
npm run package     # build vsix/auto-close-classified-tabs.vsix
```

Whether colors and badges actually render on tabs cannot be asserted from a test — there
is no API that reads back what was drawn. Check it by eye:

1. Press `F5`
2. Run **Show Type Colors on Tabs Only**
3. Open a `.ts`, a `.py` and a `.md` and confirm the label colors and badges differ

### Regenerating the icon

`media/icon.svg` is the source; `media/icon.png` is what the manifest points at. macOS can
render one from the other without any extra tooling:

```bash
sips -s format png -Z 128 media/icon.svg --out media/icon.png
```

Do not use `qlmanage` for this: it flattens the transparent area outside the rounded corners
onto white, which shows up as white notches on a dark background.

## Releasing

1. Create a `release/Ver_X.Y.Z` branch from `main` and push it
2. [release.yml](.github/workflows/release.yml) type checks, runs both test suites, builds
   the VSIX, creates a GitHub Release tagged `Ver_X.Y.Z` and attaches the VSIX
3. If the `OVSX_TOKEN` secret is set it also publishes to Open VSX. Without it that step is
   skipped with a warning and everything else still goes out
4. The `package.json` version and the cut `CHANGELOG.md` are committed back to `main`

Notes:

- **Do not move changelog entries by hand.** Write them under `[Unreleased]`;
  [`scripts/release-changelog.js`](scripts/release-changelog.js) moves them under
  `## [X.Y.Z] — date` at release time. The public extension page renders the
  **`CHANGELOG.md` inside the VSIX**, so the cut happens before packaging — fixing `main`
  afterwards leaves the published page reading "Unreleased". That same section becomes the
  release notes
- **The changelog is written in English** so the public pages read the same for everyone.
  `scripts/release-changelog.test.js` enforces that, the Keep a Changelog section names,
  and that the version being shipped has a heading
- Releasing with an empty `[Unreleased]` writes no version heading, and the release notes
  fall back to the commit log
- If `Ver_X.Y.Z` already exists the rebuild is numbered `Ver_X.Y.Z+1` — published releases
  are immutable. Open VSX rejects a duplicate version, so a `+N` rebuild is GitHub-only
- A version older than the newest existing tag is rejected, since Open VSX cannot unpublish
- The Open VSX namespace is created once by hand:
  `npx ovsx create-namespace yuuki-sakai -p <token>`
- `ci.yml` does not run on `release/**`, so `release.yml` is the only gate before publishing

## License

MIT
