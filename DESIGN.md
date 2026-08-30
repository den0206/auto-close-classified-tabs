# auto-close-classified-tabs — 設計

VSCode / Cursor 拡張。タブの自動クローズと、ファイル種別に応じたタブラベルの色分け。

## 0. 設計の前提(調査結果)

| 事項 | 結論 |
|---|---|
| タブ**背景色**を変える公式 API | **存在しない**(2026-08 時点)。VS Code チームも「Tabs API では色を変えられない」と明言。実現には本体 JS/CSS の書き換えが必須 → 採用しない |
| タブ**ラベル文字色** | `FileDecorationProvider` で公式に可能(Git が変更ファイルを着色しているのと同じ仕組み)。背景色は不可 |
| タブラベルへの**絵文字挿入** | `workbench.editor.customLabels.patterns`(1.88+)で公式に可能 |
| タブの最終アクセス時刻 | API で取得不可 → 自前でメモリ上に追跡する |
| 「閉じないタブ」の指定 | **標準のピン留め (`Tab.isPinned`)** を除外条件にする → 永続化データ不要 |
| タブへの装飾表示 | `workbench.editor.decorations.colors` / `.badges` は **既定で有効**(当初「無効」と判断したのは誤り)。バッジの方はタブには描画されない |
| タブとエクスプローラーの分離 | `FileDecorationProvider` は呼び出し元を知らず、**プロバイダー側で「タブだけ」を指定できない**。分けられるのは `explorer.decorations.colors` / `.badges` を切ることだけ(Git のマーカーと問題の件数も道連れになる) |

## 1. 非機能要件(最優先)

### ストレージ
| 保存先 | 方針 |
|---|---|
| `globalState` / `workspaceState` | **一切使わない** |
| ファイル書き込み | **しない** |
| `secrets` | 使わない |
| `settings.json` | 拡張からは **読むだけ**。書き込まない |

→ アンインストール後に残留するデータが **ゼロ**。LRU 情報は揮発メモリのみで、ウィンドウを閉じれば消える。
→ 除外リストをピン留めに寄せたのは、この要件を満たすため(独自リストを持つと永続化が必要になる)。

### メモリ
- 常駐状態は `Map<string, number>`(タブキー → アクセス連番)**1 本のみ**。要素数は開いているタブ数を超えない。
- タブが閉じられるたびに `delete` + 現存タブとの突合で孤児キーを掃除。
- クロージャに `vscode.Tab` / `TextDocument` を**保持しない**(破棄済みオブジェクトを生かしてしまうため)。保持するのは文字列キーと数値だけ。
- `setInterval` を使わない。イベント駆動 + 単発 `setTimeout`(デバウンス)のみ。タイマーは常に高々 1 本。
- 全 Disposable を `context.subscriptions` に登録。`deactivate` で Map クリア + タイマー解除。
- 色分けは**状態を持たない純関数**(キャッシュなし)。

### セキュリティ
- **実行時依存パッケージ ゼロ**(devDependencies のみ)。サプライチェーン面積を最小化。
- ネットワークアクセスなし。テレメトリなし。
- ファイルの**中身を読まない**。URI のパス文字列のみ判定に使う。
- 本体パッチなし / 外部プロセス起動なし / `eval` なし。
- glob 判定は VSCode 組み込みの `languages.match` を使い、正規表現を自作しない(ReDoS 回避)。
- **未保存のタブは絶対に閉じない**(データ喪失防止 — 本拡張の最重要ガード)。

## 2. ファイル構成

既存の拡張(secondary-simulator / terminal-for-ai-cli)の構成に揃える。

```
package.json            manifest。UI 文字列は %key% で外出し
package.nls.json        既定(英語)の文字列
package.nls.ja.json     日本語の文字列
l10n/bundle.l10n.ja.json  ソース内 vscode.l10n.t() の日本語訳
.vscode/launch.json     F5 で拡張機能ホストを起動
.vscode/tasks.json      npm: compile / npm: watch
.github/workflows/ci.yml  型チェック・テスト・VSIX 梱包・監査
.github/dependabot.yml
src/rules.ts            種別判定と customLabels パターン生成(vscode 非依存)
src/autoClose.ts        クローズ選定と LRU 追跡(vscode 非依存)
src/decorate.ts         FileDecorationProvider
src/extension.ts        activate / deactivate・イベント配線・コマンド
src/*.test.ts           ユニットテスト(node --test)
src/e2e/*.test.ts       統合テスト(@vscode/test-cli)
media/icon.svg          アイコンの元データ。qlmanage + sips で PNG 化する
media/icon.png          マニフェストが参照する 128x128
README.md / README_JP.md / CHANGELOG.md / LICENSE.md
tsconfig.json / .vscodeignore / .gitignore
```

### 既存拡張から引き継いだ作法
- **UI 文字列は l10n 経由**。manifest は `%key%` + `package.nls*.json`、ソースは `vscode.l10n.t()`
  + `l10n/bundle.l10n.ja.json`。既定を英語にし、日本語は訳として持つ。
- **コード内のコメントは日本語**で「なぜ」を書く。
- `scripts` は `vscode:prepublish` / `compile` / `watch` / `typecheck` / `test` / `package` / `clean`。
  `test` は `pretest` に頼らず `npm run compile && ...` と直列に書く(`pretest` が走らず古い出力を
  テストしてしまう事故があったため)。
- TypeScript 7 系。`tsconfig.json` に **`types` を明示する**(TS 7 は `@types/*` を自動で拾わない)。
- `package` は `vsix/` に出力し、`@vscode/vsce` は devDependencies に置く。
- `CHANGELOG.md` は英語・Keep a Changelog 形式・`[Unreleased]` を先頭に置く。
- アイコンは `media/icon.svg` を書いて PNG に変換する。SVG は VSIX に含めない。
- CI は 型チェック → テスト → VSIX 梱包 → `npm audit` + シークレット走査。
  TruffleHog の ref は可変タグではなくリリースの SHA で固定する。

## 3. 自動クローズ

### アクセス順の追跡
- キー: `TabInputText`/`TabInputNotebook` → `uri.toString()`、`TabInputTextDiff` → `diff:<original>><modified>`。
  Terminal / Webview / Custom は**対象外**(閉じない)。
- 更新契機: `window.tabGroups.onDidChangeTabs` の `changed` のうち `isActive` なタブ。
- 起動時: アクセス履歴が無いため、**タブの並び順を初期 LRU 順**とみなす(左ほど古い)。

### 閉じる判定
```
除外(絶対に閉じない):
  isDirty      未保存
  isPinned     ユーザーが保護
  isActive     いま見ているタブ
  グループ内で唯一のタブ   ← 消えるとレイアウトが崩れるため
  対象外の input 種別

① 種別ごとの上限 (maxTabsByType) を先に適用する
   その種別のタブ数 - 上限 だけ、その種別の中の古い順に閉じる
② 全体の上限を適用する
   そのグループのタブ数 - ①で閉じる数 - maxTabs だけ、種別を問わず古い順に閉じる

閉じる順の並びは ① isPreview のタブ → ② LRU で古い順 → ③ タブの並び順
```
- 上限は **エディタグループごと**にカウント(分割時に片側が全滅しない)。
- **種別ごとの上限を先に適用するのは**、差分や自動生成物のような「用が済んだら要らない」タブが
  全体の枠を食うのを防ぐため。既定は `{ "diff": 1 }` のみ。ここに書かれていない種別は
  全体の上限だけが効くので、編集中のコードファイルが巻き込まれない。
- 種別上限で閉じると決めた数は全体の上限の計算から差し引く。差し引かないと二重に数えて閉じすぎる。
- `tabGroups.close(tabs, /* preserveFocus */ true)` へまとめて 1 回で渡す。
- デバウンス 150ms(ワークスペース復元時の連続発火を 1 回に畳む)。
- 未保存タブだらけで上限を割れない場合は**黙って諦める**(再試行ループを作らない)。

## 4. 色分け(FileDecorationProvider)

```ts
provideFileDecoration(uri) {
  const cat = categorize(uri);           // 純関数・状態なし
  return cat && { color: new ThemeColor(`autoCloseClassifiedTabs.${cat.id}`), badge: cat.badge };
}
```
- 色は `package.json` の `contributes.colors` で ID を定義し、light / dark / highContrast それぞれに既定値を持たせる。
  → テーマ追従し、ユーザーは `workbench.colorCustomizations` で上書きできる(**拡張側の保存はゼロ**)。
- 設定変更時は `onDidChangeFileDecorations.fire(undefined)` で全体を再評価。

### プリセット(組み込み・設定で上書き可)
判定は 差分 → テスト → 自動生成 → 拡張子 の順。

**色は言語・ファイル形式ごとに 1 色、全 26 色。** 当初は 9 色にまとめていたが、
`settings.json` と `pubspec.yaml` が同じ「設定ファイル」として同色になり、実機で
区別がつかなかった。色数を絞る判断より、書式ごとに分ける方が実用上の効きが大きい。
色相は言語の公式カラーに寄せてある(TS 青 / Python 黄 / Go 水色 / Rust 橙 / Ruby 赤)。

| 分類 | 色 ID |
|---|---|
| 状態 | `diff` `test` `generated` |
| 文書 | `docs` |
| 設定 | `json` `yaml` `toml` `env` `sql` `docker` |
| 言語 | `typescript` `javascript` `dart` `python` `go` `rust` `jvm` `swift` `ruby` `php` `cfamily` `csharp` `shell` |
| 画面 | `html` `css` `xml` |

ドットファイル(`.gitignore` `.eslintrc` `.env.local` など)は拡張子として解釈できないので、
ファイル名の先頭一致で引く別テーブルを持つ。ただし **拡張子を先に見る** ので、
`.eslintrc.json` は JSON、`.eslintrc.yaml` は YAML として扱われる。書式が分かるならその色を優先する。

色の彩度は実機で見てから調整した。`json` の初期値 `#B5CEA8` は彩度が低く、非アクティブタブで
薄く描画されると無彩色に見えたため `#C3E88D` に上げ、隣接していた `yaml` は緑からミント
`#4EC9A0` へ色相をずらして衝突を避けている。

橙系が複数に割り当たるのは避けられないので、記号(§4.1 ③)と併用して補う。

### 設定による上書き
glob ではなく単純なマッチにした。依存を増やさず、ReDoS の余地も無く、テストしやすい。
キーが `/` を含めばパスの部分一致、含まなければ末尾一致。

```jsonc
"autoCloseClassifiedTabs.colors.rules": { ".proto": "json", "docs/": "docs" }
```
**上書きするのは色だけ**で、記号は拡張子から決まったものを残す。色をまとめても書式ごとの
見分けが失われないようにするため。未知の色名を指定された場合は黙って無視する。

### 既知の制約(README に明記する)
- **文字色とバッジのみ**。背景色は変わらない。
- Git 拡張も同じ decoration 機構を使うため、変更済みファイルでは**色が競合**しうる(片方が優先される)。
- `explorer.decorations.colors` / `.badges` が `false` だと表示されない。
- diff タブへの適用可否は実機検証が必要(スキーム判定で拾える見込み)。

## 4.1 識別性の強化(背景色の代替)

背景色が使えない前提で、**公式機能だけ**で識別力を積み上げる。3 手法を重ねる。

### ① 文字色(FileDecorationProvider)— 主軸
上記のとおり。VS Code チームも「タブの前景色は変えられる」と明言している唯一の公式ルート。

**適用先はタブに限定する。** プロバイダーは Explorer とタブの両方に同じ装飾を出し、呼び出し元を
知る手段が無いので、`explorer.decorations.colors` と `.badges` を `false` にして分離する。
これらは全プロバイダー共通のスイッチなので **Git の色とバッジ(M / U)、問題の件数も一緒に消える**。
避ける方法は無く、エクスプローラーを素の表示に保つことを優先する。

### ② バッジ(FileDecoration の `badge`、2 文字)
`badge: "TS"` を出す。**実機で確認したところ、タブには表示されなかった** — VS Code が
タブに描くのは装飾の色だけで、バッジは Explorer と Open Editors ビュー止まりだった。
設計時に「実機検証が必要」としていた点で、結果は否定。エクスプローラーを素の表示にする
以上ほぼ出番は無いが、`explorer.decorations.badges` を戻した人のために定義は残す。

**この結果、タブで使える軸は「色」と「③ の記号」の 2 つだけになった。** ③ の重要度が上がり、
記号を拡張子ごとに固有にする方針もここから来ている。

### ③ タブラベルへの絵文字プレフィックス(`workbench.editor.customLabels.patterns`)
VS Code 1.88+ の公式設定。glob → ラベルテンプレートで、タブ名の先頭に絵文字を差し込める。
```jsonc
"workbench.editor.customLabels.patterns": {
  "**/*.dart":     "🎯 ${filename}",
  "**/*.test.ts":  "🧪 ${filename}",
  "**/*.md":       "📄 ${filename}"
}
```
- **拡張は勝手に書き込まない。** コマンド実行時のみ、ユーザー設定に書き込む。
- 対になる削除コマンドを必ず用意する(→ 一時データを完全に消せる原則の遵守)。
- 影響範囲はタブと Open Editors ビューのみ。Explorer の表示は変わらない。

①② を常時、③ をコマンドによる任意適用とする。タブ上は**「色 + 記号」の 2 軸**になる。

### 検討して却下した案
| 案 | 却下理由 |
|---|---|
| 本体 JS/CSS のパッチ(tabscolor 方式) | 「破損」警告・更新のたびに再パッチ・本体への書き込み権限 → セキュリティ方針と衝突 |
| Custom CSS and JS Loader への依存 | 同上。加えて外部拡張への依存が増える |
| 独自のファイルアイコンテーマを提供 | タブ左のアイコンを色分けできるが、ユーザーの既存アイコンテーマ(Material Icon Theme 等)を**置き換えてしまう**ため侵襲的 |
| `workbench.colorCustomizations` の `tab.*` | 全タブ一律にしか効かない。個別指定は不可能 |
| 種別ごとにエディタグループを分割 | レイアウトを勝手に壊す。過剰 |

なお本拡張は本体パッチ方式の拡張と**干渉しない**ので、どうしても背景色が必要な場合は
tabscolor 等と併用できる(README には記載しない)。

## 5. 設定項目(6 個)

```jsonc
"autoCloseClassifiedTabs.enabled":           true   // 自動クローズの有効・無効
"autoCloseClassifiedTabs.maxTabs":           3      // グループごとの上限(既定 3)
"autoCloseClassifiedTabs.maxTabsByType": { "diff": 1 }  // 種別ごとの上限。maxTabs より先に適用
"autoCloseClassifiedTabs.closePreviewFirst": true   // プレビュータブを優先して閉じる
"autoCloseClassifiedTabs.colors.enabled":    true   // 色分けの有効・無効
"autoCloseClassifiedTabs.colors.rules":      {}     // 末尾一致 / パス部分一致 → 種別 の上書き
```

## 6. コマンド / メニュー

| コマンド | 内容 |
|---|---|
| `autoCloseClassifiedTabs.closeUnused` | 使っていないタブを今すぐ閉じる(`enabled` が false でも動く) |
| `autoCloseClassifiedTabs.toggleProtect` | 自動クローズから保護(ピン留めの切替)。タブの右クリックメニューにも出す |
| `autoCloseClassifiedTabs.enableTabDecorations` | タブの装飾を有効化し、`explorer.decorations.colors` / `.badges` を無効化して装飾をタブだけに限定する |
| `autoCloseClassifiedTabs.applyLabelIcons` | §4.1 ③ のパターンをユーザー設定へ書き込む |
| `autoCloseClassifiedTabs.removeLabelIcons` | 書き込んだパターンだけを削除(ユーザー独自の分は残す) |

`toggleProtect` は右クリックしたタブがアクティブとは限らないため、受け取った URI を先に前面へ出してから
`workbench.action.pinEditor` / `unpinEditor` を呼ぶ。ピン留めの状態は VS Code が持つので保存は不要。

装飾が無効な場合の案内は 1 ウィンドウにつき 1 回だけ出す。この「出したか」はモジュール変数で持ち、
**永続化しない**(有効化すれば条件自体が偽になり二度と出ない)。

## 7. テスト

テストは**積極的に書く**。ロジックの大半を vscode API 非依存の純関数に切り出し、
そこをユニットテストで厚くカバーしたうえで、API の実挙動だけを統合テストで確認する。

### レイヤ 1: ユニットテスト(`node --test`、vscode 非依存)
テスト容易性のため、タブは最小構造体で受け取る:
`{ key, group, isDirty, isPinned, isActive, isPreview, kind, order, lastUsed }`

**`pickTabsToClose(tabs, opts)`**
| # | ケース | 期待 |
|---|---|---|
| 1 | タブ数が上限以下 | 何も閉じない |
| 2 | 上限を 2 超過 | ちょうど 2 枚だけ閉じる |
| 3 | 未保存タブが候補に含まれる | 閉じない |
| 4 | ピン留めタブ | 閉じない |
| 5 | アクティブタブ | 閉じない |
| 6 | グループ内で唯一のタブ | 閉じない |
| 7 | preview と 古い通常タブが混在 | preview を先に閉じる |
| 8 | `closePreviewFirst: false` | 純粋な LRU 順で閉じる |
| 9 | 全タブが保護対象 | 空配列を返す(諦める・例外を投げない) |
| 10 | 2 グループが各々超過 | グループごとに独立して選定される |
| 11 | LRU 同点(どちらも未訪問) | タブ並び順で左(古い方)を選ぶ |
| 12 | Terminal / Webview タブ | 候補にも上限カウントにも入れない |
| 13 | `maxTabs: 0` などの異常値 | クランプして最低 1 枚は残す |
| 14 | 種別上限が全体の上限より先に効く | 全体に余裕があっても種別超過分は閉じる |
| 15 | 種別上限で閉じた分の差し引き | 二重に数えて閉じすぎない |
| 16 | 種別上限と保護条件 | 未保存・ピン留めは種別上限でも閉じない |
| 17 | 種別上限に無い種別 | 全体の上限だけが効く(コードファイルが巻き込まれない) |
| 18 | 種別上限が `0` | その種別を全部閉じる |
| 19 | 種別が判定できないタブ | 種別上限に巻き込まれない |

**`categorize(uri, userRules)`**
| # | ケース | 期待 |
|---|---|---|
| 1 | 各カテゴリの代表拡張子 | 対応カテゴリを返す |
| 2 | `foo.test.ts` | `code` ではなく `test`(優先順位) |
| 3 | `main.g.dart` | `code` ではなく `generated` |
| 4 | `git:` スキームの URI | `diff` |
| 5 | ユーザールールが一致 | プリセットより優先される |
| 6 | 未知の拡張子 | `undefined`(色をつけない) |
| 7 | `README.MD`(大文字) | `docs`(大小無視) |
| 8 | `Dockerfile`(拡張子なし) | `config` |
| 9 | 不正なユーザールール(値が未知のカテゴリ) | 無視して落ちない |

**`LruTracker`**(メモリリーク防止の直接検証 — 最重要)
| # | ケース | 期待 |
|---|---|---|
| 1 | タブをアクティブ化 | カウンタが更新される |
| 2 | 同じ URI を再訪問 | エントリが増えず値だけ更新 |
| 3 | タブを閉じた | キーが削除される |
| 4 | 現存タブ集合と突合 | 孤児キーが消える |
| 5 | 開閉を 1000 回繰り返す | `map.size <= 現在のタブ数` が常に成立 |
| 6 | `dispose()` 後 | `map.size === 0`、タイマーが残っていない |

### レイヤ 2: 統合テスト(`@vscode/test-cli` + `@vscode/test-electron`、devDependencies)
実際に VS Code を起動して検証する。API の実挙動に依存する部分のみ。
| # | ケース | 期待 |
|---|---|---|
| 1 | 5 ファイルを開く | 3 枚に収束する |
| 2 | 1 枚を編集して未保存にする | そのタブは残る |
| 3 | 1 枚をピン留めする | そのタブは残る |
| 4 | エディタを分割し両側で超過させる | 両グループとも上限まで減る |
| 5 | 差分タブを開く | 自動クローズの対象として扱われる |
| 6 | `enabled: false` | 1 枚も閉じられない |
| 7 | `maxTabs` を変更 | 即座に反映される |
| 8 | コマンドの登録 | 5 つすべて登録されている |
| 9 | 種別アイコンの適用 → 解除 | 設定が適用前と完全に同一に戻る |
| 10 | 装飾をタブだけに限定 | タブの装飾が有効、`explorer.decorations.colors` / `.badges` が無効になる |
| 11 | 差分タブを 3 つ開く | `maxTabsByType: { diff: 1 }` で 1 枚に収束する |
| 12 | 同じ設定でコードファイルを 3 つ開く | 種別上限に巻き込まれず 3 枚のまま |

色とバッジがタブに**表示されること自体**は自動テストでは検証できない(描画結果を取得する API が無い)。
README に目視確認の手順を書く。

### 実行
```
npm test           # ユニット(高速・CI の既定)
npm run test:e2e   # 統合(VSCode をダウンロードして起動)
```
CI(GitHub Actions)で両方を実行する。

**実績: ユニット 51 件 / 統合 12 件、VS Code 1.135.0 上ですべて成功。VSIX は 20.8 KB / 14 ファイル。**


## 8. やらないこと
- タブ背景色 — 公式 API が存在せず本体パッチが必須のため(§4.1 参照)。代わりに 色 + 記号 の 2 軸で識別する
- 時間経過による自動クローズ(タイマー常駐を避ける。上限方式で足りる)
- 種別上限のグループ別名(`code` でまとめて指定する等)。色 ID をそのまま書けば足りる
- 閉じたタブの履歴・復元(標準の `Ctrl/Cmd+Shift+T` で足りる)
- 全言語の色網羅(プリセットは主要言語のみ。残りは設定で追加)
- 種別ごとに色を増やすこと(9 色で打ち止め。それ以上は見分けがつかず、バッジの仕事)
- 装飾を出したかどうかの永続化(セッション内の変数で足りる)
