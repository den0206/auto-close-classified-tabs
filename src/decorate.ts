import * as vscode from 'vscode';
import { categorize } from './rules';

/**
 * タブと Explorer にファイル種別の色とバッジを出す。
 * 状態は設定のキャッシュのみで、ファイルごとの情報は一切保持しない(= メモリもストレージも消費しない)。
 */
export class TabDecorations implements vscode.FileDecorationProvider, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<undefined>();
  readonly onDidChangeFileDecorations = this.emitter.event;

  private enabled = true;
  private rules: Record<string, string> = {};

  constructor() {
    this.reload();
  }

  /** 設定を読み直し、全ファイルの再描画を促す。 */
  reload(): void {
    const cfg = vscode.workspace.getConfiguration('autoCloseClassifiedTabs');
    this.enabled = cfg.get<boolean>('colors.enabled', true);
    this.rules = cfg.get<Record<string, string>>('colors.rules', {}) ?? {};
    this.emitter.fire(undefined);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (!this.enabled) return undefined;
    const cat = categorize(uri.path, uri.scheme, this.rules);
    if (!cat) return undefined;
    return {
      badge: cat.badge.slice(0, 2), // VS Code の上限は 2 文字
      color: new vscode.ThemeColor(`autoCloseClassifiedTabs.${cat.color}`),
      tooltip: vscode.l10n.t("Type: {0}", cat.color),
    };
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
