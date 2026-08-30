import * as vscode from 'vscode';
import { LruTracker, nextToClose, pickTabsToClose, type TabLike } from './autoClose';
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
/** `enableTabDecorations` を実行する前の 4 設定の値。永続化はしない。 */
let decorationBackup: Array<boolean | undefined> | undefined;
/** このウィンドウでの一時停止。設定には書かない(ウィンドウを閉じれば解ける)。 */
let paused = false;
/** 起動直後の掃除の結果だけ知らせる。どの掃除が最初に走っても拾えるようフラグで持つ。 */
let announceStartup = false;
let log: vscode.OutputChannel | undefined;
let status: vscode.StatusBarItem | undefined;
/**
 * 直前の掃除で閉じたタブ。開き直すためだけに持つ。**保持するのは文字列と数値だけ**で、
 * Tab や TextDocument への参照は持たない(破棄済みオブジェクトを生かしてしまうため)。
 */
let lastClosed: Array<{ uri: string; viewColumn: number }> = [];

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
  if (!force && (paused || !cfg.get<boolean>('enabled', true))) return 0;

  const rules = cfg.get<Record<string, string>>('colors.rules', {}) ?? {};
  const doomed = new Set(pickTabsToClose(collect(rules), {
    maxTabs: cfg.get<number>('maxTabs', 4),
    closePreviewFirst: cfg.get<boolean>('closePreviewFirst', true),
    maxTabsByType: cfg.get<Record<string, number>>('maxTabsByType', {}) ?? {},
  }));
  if (doomed.size === 0) return 0;

  const victims: vscode.Tab[] = [];
  const reopenable: Array<{ uri: string; viewColumn: number }> = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const uriKey = tabKey(tab);
      if (!uriKey || !doomed.has(groupScoped(group.viewColumn, uriKey))) continue;
      victims.push(tab);
      // 開き直せるのは素のエディタとノートブックだけ。差分やカスタムエディタは
      // 同じものを開き直す手段が無いので覚えない(できない約束をしない)。
      const uri = tab.input instanceof vscode.TabInputText
        || tab.input instanceof vscode.TabInputNotebook ? tab.input.uri : undefined;
      if (uri) reopenable.push({ uri: uri.toString(), viewColumn: group.viewColumn });
    }
  }
  if (victims.length === 0) return 0;

  const labels = victims.map((tab) => tab.label).join(', ');
  try {
    await vscode.window.tabGroups.close(victims, true);
  } catch {
    // 候補を集めてから close するまでの間にユーザーや他の拡張がそのタブを閉じていると、
    // VS Code は `Tab close: Invalid tab not found!` を投げて **1 枚も閉じない**。
    // タブが閉じられれば onDidChangeTabs がもう一度 sweep を呼ぶので、ここは待てばよい。
    return 0;
  }

  lastClosed = reopenable;
  log?.appendLine(`${new Date().toLocaleTimeString()}  ${vscode.l10n.t('Closed {0}: {1}', victims.length, labels)}`);
  refreshStatus();
  if (announceStartup) {
    announceStartup = false;
    void announceStartupSweep(victims.length);
  }
  return victims.length;
}

/**
 * 起動直後の掃除だけは黙って済ませない。インストールした直後にウィンドウを開き直すと
 * 復元したタブが理由も告げずに減るので、「壊れた」と受け取られる。
 * 出すのは 1 ウィンドウにつき 1 回で、実際に閉じたときだけ。
 */
async function announceStartupSweep(closed: number): Promise<void> {
  const reopen = vscode.l10n.t('Reopen them');
  const settings = vscode.l10n.t('Settings');
  const picked = await vscode.window.showInformationMessage(
    vscode.l10n.t('Closed {0} tab(s) left over from the last session. Unsaved and pinned tabs are always kept.', closed),
    reopen,
    settings,
  );
  if (picked === reopen) await reopenLastClosed();
  else if (picked === settings) {
    await vscode.commands.executeCommand('workbench.action.openSettings', 'autoCloseClassifiedTabs');
  }
}

/**
 * 直前の掃除で閉じたタブを開き直す。開き直している間は掃除を止め、終わったあとに
 * 待機中の掃除も 1 回だけ捨てる。そうしないと、開き直した端から閉じ直されて見える。
 */
async function reopenLastClosed(): Promise<void> {
  const batch = lastClosed;
  if (batch.length === 0) {
    void vscode.window.showInformationMessage(
      vscode.l10n.t('Nothing to reopen. No tab has been closed automatically in this window yet.'),
    );
    return;
  }
  lastClosed = [];
  const wasPaused = paused;
  paused = true;
  try {
    for (const { uri, viewColumn } of batch) {
      try {
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(uri), {
          viewColumn,
          preview: false,
        });
      } catch {
        // 消えたファイルや開けない URI は黙って飛ばす。残りは開き直す
      }
    }
  } finally {
    paused = wasPaused;
    if (timer) clearTimeout(timer);
    timer = undefined;
    refreshStatus();
  }
}

/** このウィンドウの自動クローズを止める・再開する。設定ファイルには何も書かない。 */
function togglePause(): void {
  paused = !paused;
  refreshStatus();
  void vscode.window.showInformationMessage(paused
    ? vscode.l10n.t('Auto close paused for this window. Nothing was written to your settings.')
    : vscode.l10n.t('Auto close resumed.'));
  if (!paused) schedule();
}

/**
 * いま何枚開いていて次にどれが閉じられるかを出す。閉じたことに後から気づけるようにする。
 * ここも状態は持たず、呼ばれるたびに現在のタブから組み立てる。
 */
function refreshStatus(): void {
  if (!status) return;
  const cfg = vscode.workspace.getConfiguration('autoCloseClassifiedTabs');
  if (!cfg.get<boolean>('statusBar', true)) {
    status.hide();
    return;
  }

  const group = vscode.window.tabGroups.activeTabGroup;
  const max = Math.max(1, Math.floor(cfg.get<number>('maxTabs', 4)) || 1);
  const rules = cfg.get<Record<string, string>>('colors.rules', {}) ?? {};
  const here = collect(rules).filter((t) => t.group === group.viewColumn);
  const open = here.filter((t) => t.closable).length;
  const off = paused || !cfg.get<boolean>('enabled', true);

  const next = off ? undefined : nextToClose(here, cfg.get<boolean>('closePreviewFirst', true));
  const doomed = next === undefined ? undefined : group.tabs.find((tab) => {
    const key = tabKey(tab);
    return key !== undefined && groupScoped(group.viewColumn, key) === next;
  })?.label;

  status.text = off ? `$(circle-slash) ${open}` : `$(clear-all) ${open}/${max}`;
  status.tooltip = [
    off
      ? vscode.l10n.t('Auto close is off. {0} tab(s) open in this group.', open)
      : vscode.l10n.t('{0} of {1} tabs in this group.', open, max),
    doomed === undefined ? undefined : vscode.l10n.t('Next to close: {0}', doomed),
    vscode.l10n.t('Click to close unused tabs now.'),
  ].filter((line) => line !== undefined).join('\n');
  status.show();
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

/** `enableTabDecorations` が書き換える 4 つの設定と、有効にしたときの値。 */
const DECORATION_SETTINGS = [
  ['workbench.editor.decorations', 'colors', true],
  ['workbench.editor.decorations', 'badges', true],
  ['explorer.decorations', 'colors', false],
  ['explorer.decorations', 'badges', false],
] as const;

/**
 * `explorer.decorations.*` は全プロバイダー共通のスイッチなので、これを切ると Git の色と
 * バッジ(M / U)や問題の件数もエクスプローラーから消える。タブ側の装飾はそのまま残る。
 */
async function enableTabDecorations(): Promise<void> {
  // 取り消したときに VS Code の既定ではなく**ユーザーが元々書いていた値**へ戻せるよう、
  // 書き換える前の設定を控える。永続化はしない(ウィンドウを閉じれば消える)。
  decorationBackup = DECORATION_SETTINGS.map(([section, key]) =>
    vscode.workspace.getConfiguration(section).inspect<boolean>(key)?.globalValue);

  for (const [section, key, value] of DECORATION_SETTINGS) {
    await vscode.workspace.getConfiguration(section)
      .update(key, value, vscode.ConfigurationTarget.Global);
  }

  void vscode.window.showInformationMessage(
    vscode.l10n.t('Colors and badges now show on tabs only. The Explorer is left plain. "Restore Default Colors and Badges" undoes this — run it before uninstalling, since VS Code leaves these settings behind.'),
  );
}

/**
 * `enableTabDecorations` が書いた 4 つの設定を元へ戻す。
 * 設定を書くコマンドには必ず取り消す相手を用意する(`applyLabelIcons` と `removeLabelIcons` も同じ関係)。
 *
 * 同じウィンドウで有効化していれば**その前の値**へ、そうでなければ設定ごと消して
 * VS Code の既定へ戻す。控えを永続化しないので、別のウィンドウや再起動後は後者になる。
 */
async function restoreDecorationDefaults(): Promise<void> {
  const backup = decorationBackup;
  for (const [i, [section, key]] of DECORATION_SETTINGS.entries()) {
    await vscode.workspace.getConfiguration(section)
      .update(key, backup?.[i], vscode.ConfigurationTarget.Global);
  }
  decorationBackup = undefined;

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
  log = vscode.window.createOutputChannel('Auto Close Classified Tabs');
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = 'autoCloseClassifiedTabs.closeUnused';

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
    log,
    status,
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
      refreshStatus();
      schedule();
    }),

    // グループの追加・分割・フォーカス移動でも枚数の見え方が変わる
    vscode.window.tabGroups.onDidChangeTabGroups(() => refreshStatus()),

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('autoCloseClassifiedTabs.colors')) decorations.reload();
      if (e.affectsConfiguration('autoCloseClassifiedTabs')) {
        refreshStatus();
        schedule();
      }
    }),

    vscode.commands.registerCommand('autoCloseClassifiedTabs.closeUnused', closeUnusedNow),
    vscode.commands.registerCommand('autoCloseClassifiedTabs.reopenLastClosed', reopenLastClosed),
    vscode.commands.registerCommand('autoCloseClassifiedTabs.togglePause', togglePause),
    vscode.commands.registerCommand('autoCloseClassifiedTabs.showLog', () => log?.show(true)),
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
  refreshStatus();
  // ここが唯一「イベント由来でない」掃除。切ると復元したセッションはそのまま残るが、
  // 以降はタブを開くたびに通常どおり掃除する(このフラグは起動時の 1 回だけに効く)。
  if (cfg.get<boolean>('closeOnStartup', true)) {
    announceStartup = true;
    schedule();
  }
}

export function deactivate(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
  lru.dispose();
  noticeShown = false;
  decorationBackup = undefined;
  paused = false;
  announceStartup = false;
  lastClosed = [];
  log = undefined;
  status = undefined;
}
