import * as vscode from 'vscode';
import { LruTracker, pickTabsToClose, type TabLike } from './autoClose';
import { TabDecorations } from './decorate';
import { buildLabelPatterns, categorize } from './rules';

const DEBOUNCE_MS = 150;
const LABEL_SETTING = 'workbench.editor.customLabels.patterns';
const lru = new LruTracker();
let timer: NodeJS.Timeout | undefined;
/**
 * 装飾が無効な旨の案内は 1 ウィンドウにつき 1 回だけ。永続化はしない
 * (「後で」を覚えるだけのために `globalState` を持つと、この拡張がデータを一切残さない
 * という前提が崩れる。新しいウィンドウで再び聞かれるのはその対価)。
 */
let noticeShown = false;
/** 実行中の掃除。次の掃除はこれの後ろに並ぶ(下の `sweep` を参照)。 */
let pending: Promise<number> = Promise.resolve(0);

/** タブの安定キー。undefined を返したタブは閉じない・数えない。 */
function tabKey(tab: vscode.Tab): string | undefined {
  const i = tab.input;
  if (i instanceof vscode.TabInputText) return i.uri.toString();
  if (i instanceof vscode.TabInputNotebook) return `nb:${i.uri.toString()}`;
  if (i instanceof vscode.TabInputTextDiff) return `diff:${i.original}>${i.modified}`;
  if (i instanceof vscode.TabInputNotebookDiff) return `nbdiff:${i.original}>${i.modified}`;
  if (i instanceof vscode.TabInputCustom) return `custom:${i.viewType}:${i.uri}`;
  return undefined; // ターミナル / Webview などは対象外
}

/** タブが指す URI。タブのコンテキストメニューが渡してくるものと同じ(差分は modified 側)。 */
function tabResource(tab: vscode.Tab): vscode.Uri | undefined {
  const i = tab.input;
  if (i instanceof vscode.TabInputText) return i.uri;
  if (i instanceof vscode.TabInputNotebook) return i.uri;
  if (i instanceof vscode.TabInputCustom) return i.uri;
  if (i instanceof vscode.TabInputTextDiff) return i.modified;
  if (i instanceof vscode.TabInputNotebookDiff) return i.modified;
  return undefined;
}

/**
 * 閉じる対象を一意に指すキー。**グループ番号を含める**。
 * 同じファイルを 2 つのグループで開くと URI だけでは区別がつかず、片方のグループの選定結果で
 * もう片方(ピン留めやアクティブかもしれない)まで閉じてしまう。
 * LRU の方は URI のままにする — 利用実績はファイル単位で共有したい。
 */
function groupScoped(group: number, key: string): string {
  return `${group}\u0000${key}`;
}

function isDiffTab(tab: vscode.Tab): boolean {
  return tab.input instanceof vscode.TabInputTextDiff
    || tab.input instanceof vscode.TabInputNotebookDiff;
}

/** タブが指しているファイルの種別。色分けと同じ判定を使う。 */
function tabType(tab: vscode.Tab, rules: Record<string, string>): string | undefined {
  const uri = tabResource(tab);
  return uri && categorize(uri.path, uri.scheme, rules, isDiffTab(tab))?.color;
}

function collect(rules: Record<string, string>): TabLike[] {
  const out: TabLike[] = [];
  for (const group of vscode.window.tabGroups.all) {
    group.tabs.forEach((tab, order) => {
      const uriKey = tabKey(tab);
      out.push({
        key: uriKey === undefined
          ? `opaque:${group.viewColumn}:${order}`
          : groupScoped(group.viewColumn, uriKey),
        group: group.viewColumn,
        isDirty: tab.isDirty,
        isPinned: tab.isPinned,
        isActive: tab.isActive,
        isPreview: tab.isPreview,
        closable: uriKey !== undefined,
        order,
        lastUsed: uriKey ? lru.lastUsed(uriKey) : 0,
        type: tabType(tab, rules),
      });
    });
  }
  return out;
}

function liveKeys(): Set<string> {
  const keys = new Set<string>();
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const key = tabKey(tab);
      if (key) keys.add(key);
    }
  }
  return keys;
}

/**
 * 掃除を 1 本ずつ直列に流す。並行に走ると、先に走った方が閉じたタブを後から走った方が掴み、
 * `close()` が例外を投げて **1 枚も閉じないまま 0 を返す**。`closeUnused` から呼ばれると
 * 「閉じられるタブがありません」という誤った案内になってしまう。
 */
function sweep(force = false): Promise<number> {
  const next = pending.then(() => runSweep(force), () => runSweep(force));
  pending = next.catch(() => 0);
  return next;
}

/** 閉じたタブの枚数を返す。0 なら閉じられるタブが 1 枚も無かった。 */
async function runSweep(force = false): Promise<number> {
  const cfg = vscode.workspace.getConfiguration('autoCloseClassifiedTabs');
  if (!force && !cfg.get<boolean>('enabled', true)) return 0;

  const rules = cfg.get<Record<string, string>>('colors.rules', {}) ?? {};
  const doomed = new Set(pickTabsToClose(collect(rules), {
    maxTabs: cfg.get<number>('maxTabs', 4),
    closePreviewFirst: cfg.get<boolean>('closePreviewFirst', true),
    maxTabsByType: cfg.get<Record<string, number>>('maxTabsByType', {}) ?? {},
  }));
  if (doomed.size === 0) return 0;

  const victims: vscode.Tab[] = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const uriKey = tabKey(tab);
      if (uriKey && doomed.has(groupScoped(group.viewColumn, uriKey))) victims.push(tab);
    }
  }
  if (victims.length === 0) return 0;

  try {
    await vscode.window.tabGroups.close(victims, true);
  } catch {
    // 候補を集めてから close するまでの間にユーザーや他の拡張がそのタブを閉じていると、
    // VS Code は `Tab close: Invalid tab not found!` を投げて **1 枚も閉じない**。
    // タブが閉じられれば onDidChangeTabs がもう一度 sweep を呼ぶので、ここは待てばよい。
    return 0;
  }
  return victims.length;
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    void sweep();
  }, DEBOUNCE_MS);
}

/**
 * 何も閉じなかったときだけ伝える。閉じたときはタブが消えるのを見れば分かるので黙っている。
 * 無言だとコマンドが壊れているのか、閉じる対象が無いのかをユーザーが区別できない。
 */
async function closeUnusedNow(): Promise<void> {
  if (await sweep(true) > 0) return;
  void vscode.window.showInformationMessage(
    vscode.l10n.t('No tabs to close. Everything open is active, unsaved, pinned or the last tab in its group.'),
  );
}

/**
 * タブの装飾に必要な 2 つの設定は VS Code の版によって既定が異なるので、無効なら有効化を促す。
 * 同時に Explorer 側の色は落とす(エクスプローラーのファイル名まで色が変わるのは求められていない)。
 */
async function offerTabDecorations(): Promise<void> {
  if (noticeShown) return;
  const editorCfg = vscode.workspace.getConfiguration('workbench.editor.decorations');
  const explorerCfg = vscode.workspace.getConfiguration('explorer.decorations');
  const tabsReady = editorCfg.get<boolean>('colors', false) && editorCfg.get<boolean>('badges', false);
  const explorerDecorated =
    explorerCfg.get<boolean>('colors', true) || explorerCfg.get<boolean>('badges', true);
  if (tabsReady && !explorerDecorated) return;
  noticeShown = true;

  const yes = vscode.l10n.t('Enable it');
  const picked = await vscode.window.showInformationMessage(
    vscode.l10n.t('Show file type colors on tabs only? This turns on tab decorations and leaves the Explorer plain.'),
    yes,
    vscode.l10n.t('Later'),
  );
  if (picked === yes) await vscode.commands.executeCommand('autoCloseClassifiedTabs.enableTabDecorations');
}

/**
 * `explorer.decorations.*` は全プロバイダー共通のスイッチなので、これを切ると Git の色と
 * バッジ(M / U)や問題の件数もエクスプローラーから消える。タブ側の装飾はそのまま残る。
 */
async function enableTabDecorations(): Promise<void> {
  const editorCfg = vscode.workspace.getConfiguration('workbench.editor.decorations');
  await editorCfg.update('colors', true, vscode.ConfigurationTarget.Global);
  await editorCfg.update('badges', true, vscode.ConfigurationTarget.Global);

  const explorerCfg = vscode.workspace.getConfiguration('explorer.decorations');
  await explorerCfg.update('colors', false, vscode.ConfigurationTarget.Global);
  await explorerCfg.update('badges', false, vscode.ConfigurationTarget.Global);

  void vscode.window.showInformationMessage(
    vscode.l10n.t('Colors and badges now show on tabs only. The Explorer is left plain. "Restore Default Colors and Badges" undoes this — run it before uninstalling, since VS Code leaves these settings behind.'),
  );
}

/**
 * `enableTabDecorations` が書いた 4 つの設定を消して VS Code の既定へ戻す。
 * 設定を書くコマンドには必ず取り消す相手を用意する(`applyLabelIcons` と `removeLabelIcons` も同じ関係)。
 */
async function restoreDecorationDefaults(): Promise<void> {
  const editorCfg = vscode.workspace.getConfiguration('workbench.editor.decorations');
  await editorCfg.update('colors', undefined, vscode.ConfigurationTarget.Global);
  await editorCfg.update('badges', undefined, vscode.ConfigurationTarget.Global);

  const explorerCfg = vscode.workspace.getConfiguration('explorer.decorations');
  await explorerCfg.update('colors', undefined, vscode.ConfigurationTarget.Global);
  await explorerCfg.update('badges', undefined, vscode.ConfigurationTarget.Global);

  // 再び案内を出すと、戻したばかりの設定をもう一度勧めることになる
  noticeShown = true;

  void vscode.window.showInformationMessage(
    vscode.l10n.t('Decoration settings restored. The Explorer shows Git colors and badges again.'),
  );
}

/**
 * 右クリックされたタブのピン留めを切り替える。タブのコンテキストメニューは
 * `(resource, { groupId, editorIndex })` を渡してくるので、**そのまま**組み込みコマンドへ流し、
 * どのエディタが対象かは VS Code に解決させる。
 *
 * 自前で `showTextDocument` して前面に出してはいけない。差分・ノートブック・カスタム
 * エディタのタブでは同じファイルのテキストタブが新しく開いて**そちら**がピン留めされ、
 * 目的のタブは無保護のまま残る。別グループのタブならアクティブなグループへ移動もしてしまう。
 * ピン留めか解除かの判定にだけ、URI から対象のタブを引く。
 */
async function toggleProtect(...args: unknown[]): Promise<void> {
  const uri = args[0] instanceof vscode.Uri ? args[0] : undefined;
  const target = uri
    ? findTabFor(uri)
    : vscode.window.tabGroups.activeTabGroup.activeTab;
  if (!target) return;
  await vscode.commands.executeCommand(
    target.isPinned ? 'workbench.action.unpinEditor' : 'workbench.action.pinEditor',
    ...args,
  );
}

/**
 * URI に対応するタブを探す。同じファイルが複数グループで開かれていると候補が複数になり、
 * どれを見るかでピン留めか解除かの判定が変わる。メニューが渡してくる `groupId` は
 * **公開 API から TabGroup へ解決できない**(`TabGroup` は `viewColumn` しか持たない)ので、
 * タブを右クリックするとそのグループがアクティブになることを使って、アクティブなグループの
 * 分を優先する。実際にどのタブを操作するかは組み込みコマンドが `args` から解決する。
 */
function findTabFor(uri: vscode.Uri): vscode.Tab | undefined {
  const want = uri.toString();
  const hit = (group: vscode.TabGroup): vscode.Tab | undefined =>
    group.tabs.find((tab) => tabResource(tab)?.toString() === want);

  const active = hit(vscode.window.tabGroups.activeTabGroup);
  if (active) return active;
  for (const group of vscode.window.tabGroups.all) {
    const found = hit(group);
    if (found) return found;
  }
  return undefined;
}

async function applyLabelIcons(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration();
  const current = cfg.get<Record<string, string>>(LABEL_SETTING, {}) ?? {};
  await cfg.update(
    LABEL_SETTING,
    { ...current, ...buildLabelPatterns() },
    vscode.ConfigurationTarget.Global,
  );
  void vscode.window.showInformationMessage(vscode.l10n.t('Type icons added to tab names. "Remove Type Icons From Tab Names" undoes this — run it before uninstalling, since VS Code leaves this setting behind.'));
}

// `applyLabelIcons` が書く形のキーか。書き込むキーは次の 3 形しかない:
//   `**/*.{ts,mts,cts}` `**/{.gitignore,.npmignore}` `**/.env*`
// ここで絞らずに値(記号)だけで消すと、同じ絵文字を使ったユーザー自身のパターン
// (`"**/vendor/*.js": "🟨 ${filename}"` など)まで巻き込んで消してしまう。
function looksLikeOurKey(key: string): boolean {
  return key === '**/.env*'
    || ((key.startsWith('**/*.{') || key.startsWith('**/{')) && key.endsWith('}'));
}

async function removeLabelIcons(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration();
  const current = cfg.get<Record<string, string>>(LABEL_SETTING, {}) ?? {};
  const mine = buildLabelPatterns();
  // 拡張子を 1 つ足すとキーの字面(`**/*.{js,jsx}` → `**/*.{cjs,js,jsx}`)が変わるので、
  // キー一致だけでは旧版が書いたパターンが settings.json に残り続ける。値(記号)でも拾う。
  const mineValues = new Set(Object.values(mine));
  const rest: Record<string, string> = {};
  for (const [key, value] of Object.entries(current)) {
    const ours = key in mine || (looksLikeOurKey(key) && mineValues.has(value));
    if (!ours) rest[key] = value; // ユーザーが自分で足した分は残す
  }
  // 何も残らないなら設定ごと消す。使わなくなったデータは中途半端に残さない。
  await cfg.update(
    LABEL_SETTING,
    Object.keys(rest).length > 0 ? rest : undefined,
    vscode.ConfigurationTarget.Global,
  );
  void vscode.window.showInformationMessage(vscode.l10n.t('Type icons removed from tab names.'));
}

export function activate(context: vscode.ExtensionContext): void {
  const decorations = new TabDecorations();

  // 起動時はアクセス履歴が無いので、並び順を LRU 順とみなす(左ほど古い)。
  // ただし各グループのアクティブタブだけは「直前まで見ていたタブ」なので最後に触る
  // (左端にあるアクティブタブの隣が、復元直後の掃除で真っ先に閉じられるのを避ける)。
  for (const key of liveKeys()) lru.touch(key);
  for (const group of vscode.window.tabGroups.all) {
    const key = group.activeTab && tabKey(group.activeTab);
    if (key) lru.touch(key);
  }

  context.subscriptions.push(
    decorations,
    vscode.window.registerFileDecorationProvider(decorations),

    vscode.window.tabGroups.onDidChangeTabs((e) => {
      for (const tab of e.closed) {
        const key = tabKey(tab);
        if (key) lru.forget(key);
      }
      for (const tab of [...e.opened, ...e.changed]) {
        if (!tab.isActive) continue;
        const key = tabKey(tab);
        if (key) lru.touch(key);
      }
      if (e.closed.length > 0) lru.retain(liveKeys()); // 取りこぼしたキーを掃除
      schedule();
    }),

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('autoCloseClassifiedTabs.colors')) decorations.reload();
      if (e.affectsConfiguration('autoCloseClassifiedTabs')) schedule();
    }),

    vscode.commands.registerCommand('autoCloseClassifiedTabs.closeUnused', closeUnusedNow),
    vscode.commands.registerCommand('autoCloseClassifiedTabs.toggleProtect', toggleProtect),
    vscode.commands.registerCommand('autoCloseClassifiedTabs.enableTabDecorations', enableTabDecorations),
    vscode.commands.registerCommand('autoCloseClassifiedTabs.restoreDecorationDefaults', restoreDecorationDefaults),
    vscode.commands.registerCommand('autoCloseClassifiedTabs.applyLabelIcons', applyLabelIcons),
    vscode.commands.registerCommand('autoCloseClassifiedTabs.removeLabelIcons', removeLabelIcons),

    { dispose: () => { if (timer) clearTimeout(timer); timer = undefined; lru.dispose(); } },
  );

  const cfg = vscode.workspace.getConfiguration('autoCloseClassifiedTabs');
  if (cfg.get<boolean>('colors.enabled', true)) {
    void offerTabDecorations();
  }
  // ここが唯一「イベント由来でない」掃除。切ると復元したセッションはそのまま残るが、
  // 以降はタブを開くたびに通常どおり掃除する(このフラグは起動時の 1 回だけに効く)。
  if (cfg.get<boolean>('closeOnStartup', true)) schedule();
}

export function deactivate(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
  lru.dispose();
  noticeShown = false;
}
