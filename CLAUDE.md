# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

VS Code / Cursor 拡張。タブの自動クローズと、ファイル種別によるタブラベルの色分け。

## コマンド

```bash
npm run typecheck    # tsc --noEmit
npm test             # compile + ユニットテスト (node --test)。VS Code 不要
npm run test:e2e     # compile + 統合テスト (@vscode/test-cli が VS Code を起動)
npm run package      # vsix/auto-close-classified-tabs.vsix を生成
npm run clean        # out / vsix / .vscode-test を消す
```

- **単体のテストだけ流す**: `npm run compile && node --test --test-name-pattern='テスト名の一部' out/rules.test.js`
- テストは `out/` のコンパイル済み JS を実行する。`pretest` に頼らず `test` 内で `compile` を直列に呼んでいる（古い出力をテストする事故があったため）。ソースを直したら必ず `npm test` 経由で走らせる。
- 手元での動作確認は `F5`（`.vscode/launch.json` の Run Extension）。
- 色や記号が実際にどう見えるかはテストで検証できない。追加・変更したら `F5` で目視する。

## アーキテクチャ

vscode API に依存する層としない層を分けてある。ロジックの大半は非依存側にあり、そこをユニットテストで厚く覆う。

| ファイル | 役割 | vscode 依存 |
|---|---|---|
| `src/rules.ts` | パス → 種別（色・バッジ・記号）の判定、`customLabels` パターン生成 | なし |
| `src/autoClose.ts` | 閉じるタブの選定 `pickTabsToClose`、`LruTracker` | なし |
| `src/decorate.ts` | `FileDecorationProvider`。状態は設定キャッシュのみ | あり |
| `src/extension.ts` | activate / イベント配線 / コマンド。`vscode.Tab` → `TabLike` への変換もここ | あり |

- `extension.ts` は `vscode.Tab` を `TabLike`（文字列キーと数値のみ）へ落としてから `pickTabsToClose` に渡す。**クロージャやマップに `Tab` / `TextDocument` を保持しない**（破棄済みオブジェクトを生かしてしまうため）。
- 閉じる判定の順序: 種別ごとの上限 `maxTabsByType` を先に適用 → 残りに全体の上限 `maxTabs`。エディタグループごとに独立して数える。未保存・ピン留め・アクティブ・グループ内で唯一のタブは絶対に閉じない。
- 種別の判定順: 差分 → テスト → 自動生成 → 拡張子 → ドットファイル。ユーザー設定 `colors.rules` は**色だけ**を差し替え、バッジと記号は拡張子由来のものを残す。

### 譲れない前提（変更前に DESIGN.md を読む）

- **実行時依存パッケージゼロ**（`devDependencies` のみ）。`dependencies` を足すとテストが落ちる。
- **永続データを持たない**。`globalState` / `workspaceState` / ファイル書き込みは使わない。LRU も案内の既読フラグも揮発メモリのみ。
- `settings.json` へ書くのはユーザーがコマンドを実行したときだけで、**書き込むコマンドには必ず取り消すコマンドを対で用意する**（`enableTabDecorations` ↔ `restoreDecorationDefaults`、`applyLabelIcons` ↔ `removeLabelIcons`）。VS Code はアンインストールのフックを拡張に渡さないため。
- タブ背景色を変える API は存在しない。識別の軸は「色」と「タブ名の記号」の 2 つだけ。バッジはタブには描画されず Explorer 専用。
- 正規表現による glob 自作をしない（ReDoS 回避）。`colors.rules` は末尾一致 / パス部分一致の単純マッチ。

## 複数ファイルの同期

`src/rules.test.ts` 末尾の整合性テストが、以下のずれを検出する。テストが落ちたらまず同期漏れを疑う。

- **色 ID を足す**: `src/rules.ts` の `ColorId` と `COLOR_IDS`、`package.json` の `contributes.colors` と `maxTabsByType` の `propertyNames.enum`、`package.nls.json` / `package.nls.ja.json` の `color.<id>` の 5 箇所すべて。`/add-file-type` コマンドに手順がある。
- **UI 文字列**: manifest は `%key%` + `package.nls.json` / `package.nls.ja.json`（キーが揃っていること）。ソースは `vscode.l10n.t()` + `l10n/bundle.l10n.ja.json`（原文がそのままキーなので、**文言を直したら訳のキーも直す**）。
- 既定は英語、日本語は訳として持つ。コード内のコメントは日本語で「なぜ」を書く。

## リリース

`release/Ver_X.Y.Z` ブランチを push すると `.github/workflows/release.yml` が全部やる（テスト → CHANGELOG 切り出し → VSIX → GitHub Release → Open VSX → main へ版を戻す）。

- **CHANGELOG の項目を手で移動しない。** `[Unreleased]` の下に英語で書く。`scripts/release-changelog.js` がリリース時に `## [X.Y.Z] — date` へ移す。公開ページが表示するのは **VSIX 内の** CHANGELOG.md なので、切り出しはパッケージより前に走る。
- 公開済みバージョンは不変。既存タグと同じ／より古い版はワークフローが弾く。
- `ci.yml` は `release/**` では走らない。公開前のゲートは `release.yml` だけ。
