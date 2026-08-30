import * as vscode from 'vscode';
import { LruTracker, pickTabsToClose, type TabLike } from './autoClose';
import { TabDecorations } from './decorate';
import { buildLabelPatterns, categorize } from './rules';

const DEBOUNCE_MS = 150;
const LABEL_SETTING = 'workbench.editor.customLabels.patterns';

const lru = new LruTracker();
let timer: NodeJS.Timeout | undefined;
/** 装飾が無効な旨の案内は 1 ウィンドウにつき 1 回だけ。永続化はしない。 */
let noticeShown = false;

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
      const key = tabKey(tab);
      out.push({
        key: key ?? `opaque:${group.viewColumn}:${order}`,
        group: group.viewColumn,
        isDirty: tab.isDirty,
        isPinned: tab.isPinned,
        isActive: tab.isActive,
        isPreview: tab.isPreview,
        closable: key !== undefined,
        order,
        lastUsed: key ? lru.lastUsed(key) : 0,
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

async function sweep(force = false): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('autoCloseClassifiedTabs');
  if (!force && !cfg.get<boolean>('enabled', true)) return;

  const rules = cfg.get<Record<string, string>>('colors.rules', {}) ?? {};
  const doomed = new Set(pickTabsToClose(collect(rules), {
    maxTabs: cfg.get<number>('maxTabs', 3),
    closePreviewFirst: cfg.get<boolean>('closePreviewFirst', true),
    maxTabsByType: cfg.get<Record<string, number>>('maxTabsByType', {}) ?? {},
  }));
  if (doomed.size === 0) return;

  const victims: vscode.Tab[] = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const key = tabKey(tab);
      if (key && doomed.has(key)) victims.push(tab);
    }
  }
  if (victims.length > 0) await vscode.window.tabGroups.close(victims, true);
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    void sweep();
  }, DEBOUNCE_MS);
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
    vscode.l10n.t('Colors and badges now show on tabs only. The Explorer is left plain.'),
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
    ? vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .find((tab) => tabResource(tab)?.toString() === uri.toString())
    : vscode.window.tabGroups.activeTabGroup.activeTab;
  if (!target) return;
  await vscode.commands.executeCommand(
    target.isPinned ? 'workbench.action.unpinEditor' : 'workbench.action.pinEditor',
    ...args,
  );
}

async function applyLabelIcons(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration();
  const current = cfg.get<Record<string, string>>(LABEL_SETTING, {}) ?? {};
  await cfg.update(
    LABEL_SETTING,
    { ...current, ...buildLabelPatterns() },
    vscode.ConfigurationTarget.Global,
  );
  void vscode.window.showInformationMessage(vscode.l10n.t('Type icons added to tab names.'));
}

async function removeLabelIcons(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration();
  const current = cfg.get<Record<string, string>>(LABEL_SETTING, {}) ?? {};
  const mine = buildLabelPatterns();
  const rest: Record<string, string> = {};
  for (const [key, value] of Object.entries(current)) {
    if (!(key in mine)) rest[key] = value; // ユーザーが自分で足した分は残す
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

  // 起動時はアクセス履歴が無いので、並び順を LRU 順とみなす(左ほど古い)
  for (const key of liveKeys()) lru.touch(key);

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

    vscode.commands.registerCommand('autoCloseClassifiedTabs.closeUnused', () => sweep(true)),
    vscode.commands.registerCommand('autoCloseClassifiedTabs.toggleProtect', toggleProtect),
    vscode.commands.registerCommand('autoCloseClassifiedTabs.enableTabDecorations', enableTabDecorations),
    vscode.commands.registerCommand('autoCloseClassifiedTabs.restoreDecorationDefaults', restoreDecorationDefaults),
    vscode.commands.registerCommand('autoCloseClassifiedTabs.applyLabelIcons', applyLabelIcons),
    vscode.commands.registerCommand('autoCloseClassifiedTabs.removeLabelIcons', removeLabelIcons),

    { dispose: () => { if (timer) clearTimeout(timer); timer = undefined; lru.dispose(); } },
  );

  if (vscode.workspace.getConfiguration('autoCloseClassifiedTabs').get<boolean>('colors.enabled', true)) {
    void offerTabDecorations();
  }
  schedule();
}

export function deactivate(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
  lru.dispose();
  noticeShown = false;
}
