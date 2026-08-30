# Changelog

Written in English so the public extension pages (Open VSX / Marketplace) read the same
for everyone. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and versions follow [Semantic Versioning](https://semver.org/).

`[Unreleased]` holds changes for the next release.

## [Unreleased]

### Added

- A status bar item showing how many tabs the active group holds against the limit, the
  tab that goes next on hover, and a click to close unused tabs now. Turn it off with
  `autoCloseClassifiedTabs.statusBar`.
- **Reopen Tabs Just Closed** brings back the tabs from the most recent sweep. The list is
  held in memory for the window and covers one sweep; diffs and custom editors are left out
  because there is no way to reopen those at the same URI.
- **Show Auto Close Log** opens an output channel recording every sweep and the tab names.
- **Pause or Resume Auto Close (This Window)** stops closing without writing to settings.
  It resumes when the window is reopened; `autoCloseClassifiedTabs.enabled` is still the
  switch that sticks.
- The sweep that runs when a window opens now says how many tabs it closed, once per
  window, with **Reopen them** and **Settings** on the notice. Installing the extension and
  reloading used to trim a restored session with no explanation at all.

### Fixed

- A file open in two editor groups is no longer closed in both. The key used to pick tabs
  was the URI alone, so a decision made for one group also took out the copy in the other —
  including one that was pinned or active, which the extension promises never to close.
  The key now carries the group; the usage order stays per file.
- **Protect From Auto Close** read the pin state off the first tab matching the URI, which
  could belong to a different group than the one being acted on, turning the toggle into a
  no-op. It now prefers the tab in the active group.
- Sweeps run one at a time. Two overlapping sweeps made the second one grab a tab the first
  had already closed, which threw and closed nothing, so **Close Unused Tabs Now** reported
  "no tabs to close" when there were.
- **Remove Type Icons From Tab Names** no longer deletes patterns you wrote yourself. It
  matched anything under `**/` carrying one of its emoji, so `"**/vendor/*.js": "🟨 ${filename}"`
  went with it. It now only removes keys shaped the way it writes them.
- Diff detection no longer depends on how a URI scheme is capitalized.

### Changed

- Tab label colors are measured with CIEDE2000 instead of CIE76, and nine of them moved to
  clear a floor of ΔE 6. CIE76 overstates differences among blues, which is exactly where
  this palette is most crowded: in the light theme `typescript` and `xml` were 1.8 apart —
  effectively the same color on a tab — while CIE76 reported a comfortable 7.0. `python`,
  `xml`, `ruby`, `toml`, `env`, `sql`, `swift` and `javascript` shifted with it; most moves
  are too small to notice.
- Every type color now clears 4.5:1 against the default editor background (WCAG AA for
  normal text). Six did not: `csharp` in dark, and `test`, `css`, `dart`, `shell` and `go`
  in light. Light `shell` (2.84:1) and `dart` (2.59:1) were the worst and are noticeably
  deeper now. `generated` is exempt — fading into the background is its job.

## [0.0.2] — 2026-08-30

### Changed

- Tab label colors now follow [GitHub Linguist](https://github.com/github-linguist/linguist),
  the palette GitHub uses for the language bar on a repository, so a `.ts` tab is
  TypeScript blue. Linguist picks those values for small solid dots, so the lightness is
  shifted per theme to keep a label readable while the hue and saturation are kept as they
  are. `diff`, `test` and `generated` are states rather than languages and have no Linguist
  color, so they are unchanged, and `json` keeps its green too — the Linguist value is a
  near-black `#292929` that a tab cannot tell apart from `generated` gray. Anything you set
  in `workbench.colorCustomizations` still wins.
- No file type is red, orange or yellow any more. A tab label is where VS Code paints
  errors and warnings, and a type wearing those hues reads as a problem that is not there.
  The eleven types Linguist puts in the warm band — `javascript`, `yaml`, `ruby`, `swift`,
  `cfamily`, `rust`, `jvm`, `sql`, `env`, `toml` and `html` — moved to the cool side of the
  wheel: JavaScript is pink, YAML teal, Ruby periwinkle, HTML green, `.env` magenta.
- `autoCloseClassifiedTabs.maxTabs` now defaults to 4 instead of 3.

## [0.0.1] — 2026-08-30

### Changed

- Renamed to Auto Close Classified Tabs. The settings, theme color IDs and command IDs all
  moved to the `autoCloseClassifiedTabs` prefix. Nothing had shipped yet, so this breaks
  no existing configuration.
- When several `autoCloseClassifiedTabs.colors.rules` entries match one file, the longest
  key now wins. It used to be whichever entry came first, so reordering `settings.json`
  could change a color.
- `autoCloseClassifiedTabs.maxTabsByType` only accepts real type names now; a typo such as
  `diffs` is flagged in the settings editor instead of being silently ignored.
- The two commands that write settings now name the command that undoes them, and say that
  VS Code leaves the settings behind on uninstall. Both READMEs gained a "before you
  uninstall" section for the same reason: without it, an uninstall can leave the Explorer
  with its Git colors and badges switched off and nothing to explain why.

### Added

- An icon (`media/icon.png`), drawn from `media/icon.svg`.
- A demo GIF and the icon at the top of both READMEs.
- A release workflow (`.github/workflows/release.yml`): pushing a `release/Ver_X.Y.Z`
  branch runs the tests, builds the VSIX, cuts `[Unreleased]` into a version heading with
  `scripts/release-changelog.js`, creates the GitHub Release, and publishes to Open VSX
  when the `OVSX_TOKEN` secret is set — that step is skipped with a warning when it is not.
- **Restore Default Colors and Badges** removes the four settings written by **Show Type
  Colors on Tabs Only**, so every command that writes a setting now has one that undoes it.
- `autoCloseClassifiedTabs.closeOnStartup` (default `true`). Turn it off and a restored
  session is left alone until you open the next tab — enough of a pause to pin what you
  want to keep, without exempting those tabs for good.
- **Close Unused Tabs Now** says so when it closed nothing. Running a command and getting
  no response at all gave no way to tell a broken command from having nothing to close.

### Fixed

- A misspelled type in `autoCloseClassifiedTabs.colors.rules` no longer strips the file of
  all decoration; the entry is ignored and the extension falls back to the file extension.
- Tabs that cannot be closed (terminals, webviews) no longer count toward the "last tab in
  the group" rule, so the last editor beside a terminal is kept open.
- The `colors.rules` examples in the settings descriptions and both READMEs used type names
  that do not exist (`config`, `systems`), which would have produced no decoration at all.
- **Protect From Auto Close** now pins the tab you right-clicked. On a diff, notebook or
  custom editor it used to open a second, plain text tab for the same file and pin that
  one, leaving the tab you aimed at unprotected; on a tab in another editor group it
  dragged the file into the active group. The command hands the menu's arguments to the
  built-in pin command instead of focusing the tab itself.
- **Remove Type Icons From Tab Names** now also removes patterns written by an earlier
  version. Adding one extension changes the pattern's key (`**/*.{js,jsx}` becomes
  `**/*.{cjs,js,jsx}`), and entries under the old key were left in `settings.json`
  forever. Patterns you wrote yourself are still kept.
- A sweep no longer fails wholesale when one of its tabs disappears first. Closing a tab
  that a user or another extension has already closed makes VS Code throw
  `Tab close: Invalid tab not found!`, which rejected unhandled and left every other tab
  in that batch open. The next tab event sweeps them instead.
- After a restart, the tab that was active in each editor group is treated as the most
  recently used one. Startup has no access history and fell back to left-to-right order,
  which could close the tab next to the one you were last looking at.

## [0.1.0] — 2026-08-30

### Added

- Tabs beyond `autoCloseClassifiedTabs.maxTabs` (default 3, counted per editor group) are closed
  automatically, least recently used first. Unsaved, pinned and active tabs are never
  closed, and neither is the last tab in a group — losing it would collapse the split.
  Preview tabs go first when `autoCloseClassifiedTabs.closePreviewFirst` is on, since a tab opened
  by a single click is rarely one you meant to keep.
- `autoCloseClassifiedTabs.maxTabsByType` caps how many tabs of one kind stay open, and runs before
  `maxTabs`. Diffs default to 1: a diff opened three files ago is rarely one you still
  want, and left alone it eats the general budget that your actual code files need. A type
  that is not listed is bound only by `maxTabs`, which is what keeps editing files out of
  it. Whatever the per-type pass closes is subtracted from the general count, so the two
  passes never close the same slot twice.
- Pinning a tab protects it from auto close. The right-click entry "Protect From Auto
  Close" toggles the built-in pin rather than keeping a list of its own, so nothing has
  to be stored anywhere and the state survives exactly as long as VS Code keeps it.
- Tab labels are colored by file type through `FileDecorationProvider`: 26 colors, one
  per language or file format, following each language's own color where it has one.
  Config files are split by format rather than lumped together, so `settings.json` and
  `pubspec.yaml` do not come out the same shade. Badges are also provided, but VS Code
  draws only the color on a tab — the badge reaches the Explorer and the Open Editors
  view and stops there. Dotfiles are matched by name rather than extension, so
  `.gitignore` and `.env.local` are colored too, while `.eslintrc.json` still follows its
  real format.
- "Show Type Colors on Tabs Only" turns on `workbench.editor.decorations.colors` and
  `.badges`, and turns off `explorer.decorations.colors` and `.badges`. The first pair is
  off by default in VS Code and nothing is drawn on a tab without them; the second pair
  leaves the Explorer plain. A decoration provider cannot tell which surface is asking, so
  those switches are the only way to separate the two — and because every provider shares
  them, the colors and `M` / `U` / error-count badges Git and the problem markers put in
  the Explorer go away with them.
- "Add Type Icons to Tab Names" writes emoji prefixes into
  `workbench.editor.customLabels.patterns` (`🎯 main.dart`), and its counterpart removes
  exactly the patterns it wrote, leaving any the user added by hand. Every extension gets
  its own symbol, which is what separates `{} settings.json` from `📋 pubspec.yaml` where
  the colors alone would be close. Since badges never reach a tab, this is the only way
  to put a symbol on one.
- `autoCloseClassifiedTabs.colors.rules` overrides the color of a file, leaving its icon alone. A key containing `/` matches
  anywhere in the path, otherwise it matches the end of it — deliberately weaker than
  glob so that no dependency is needed and no pattern can backtrack.

### Notes

- The extension stores nothing: no `globalState`, no `workspaceState`, no files, no
  network. Tab usage order lives in memory only and goes away with the window. It has no
  runtime dependencies.
