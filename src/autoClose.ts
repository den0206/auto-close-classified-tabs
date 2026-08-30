// クローズ対象の選定と LRU 追跡。vscode に依存しない純粋なロジック。

export interface TabLike {
  /** URI などから作る安定キー */
  key: string;
  /** エディタグループ番号 */
  group: number;
  isDirty: boolean;
  isPinned: boolean;
  isActive: boolean;
  isPreview: boolean;
  /** 閉じてよい種別か (Terminal / Webview などは false) */
  closable: boolean;
  /** グループ内の並び順。左が小さい */
  order: number;
  /** 最終アクセスの連番。未訪問は 0 */
  lastUsed: number;
  /** 色 ID と同じ種別名。判定できなかったタブは undefined */
  type?: string;
}

export interface CloseOptions {
  maxTabs: number;
  closePreviewFirst: boolean;
  /** 種別ごとの上限。指定の無い種別は全体の上限だけが効く */
  maxTabsByType?: Record<string, number>;
}

/**
 * 閉じるべきタブのキーを返す。未保存・ピン留め・アクティブ・グループ内で唯一のタブは決して含まない。
 * 保護対象ばかりで上限を割れない場合は、閉じられる分だけ返す(例外は投げない)。
 */
export function pickTabsToClose(tabs: readonly TabLike[], opts: CloseOptions): string[] {
  const max = Math.max(1, Math.floor(opts.maxTabs) || 1);
  const groups = new Map<number, TabLike[]>();
  for (const t of tabs) {
    const list = groups.get(t.group);
    if (list) list.push(t); else groups.set(t.group, [t]);
  }

  const byType = opts.maxTabsByType ?? {};
  const doomed: string[] = [];

  for (const list of groups.values()) {
    // 対象外の種別は上限のカウントにも候補にも入れない
    const counted = list.filter((t) => t.closable);
    if (counted.length <= 1) continue; // グループに残る最後のエディタは閉じない

    const candidates = counted
      .filter((t) => !t.isDirty && !t.isPinned && !t.isActive)
      .sort((a, b) => {
        if (opts.closePreviewFirst && a.isPreview !== b.isPreview) return a.isPreview ? -1 : 1;
        if (a.lastUsed !== b.lastUsed) return a.lastUsed - b.lastUsed;
        return a.order - b.order;
      });

    const picked = new Set<string>();
    const take = (from: readonly TabLike[], count: number): void => {
      for (const t of from) {
        if (count <= 0) break;
        if (picked.has(t.key)) continue;
        picked.add(t.key);
        count--;
      }
    };

    // 1. 種別ごとの上限。差分やドキュメントを 1〜2 枚に抑えたい用途を想定している
    for (const [type, rawLimit] of Object.entries(byType)) {
      const limit = Math.max(0, Math.floor(rawLimit) || 0);
      const ofType = counted.filter((t) => t.type === type);
      take(candidates.filter((t) => t.type === type), ofType.length - limit);
    }

    // 2. 全体の上限。1 で閉じると決めた分は既に減っているものとして数える
    take(candidates, counted.length - picked.size - max);

    for (const key of picked) doomed.push(key);
  }
  return doomed;
}

/**
 * タブごとの最終アクセス順を持つ。時計に依存しない単調増加カウンタを使う。
 * 保持するのは文字列キーと数値だけで、Tab や Document への参照は一切持たない。
 */
export class LruTracker {
  private readonly seen = new Map<string, number>();
  private clock = 0;

  get size(): number { return this.seen.size; }

  touch(key: string): void {
    this.seen.set(key, ++this.clock);
  }

  lastUsed(key: string): number {
    return this.seen.get(key) ?? 0;
  }

  forget(key: string): void {
    this.seen.delete(key);
  }

  /** 現存するタブに無いキーを捨てる。これでエントリ数がタブ数を超えることはない。 */
  retain(liveKeys: Iterable<string>): void {
    const live = liveKeys instanceof Set ? liveKeys : new Set(liveKeys);
    for (const key of this.seen.keys()) {
      if (!live.has(key)) this.seen.delete(key);
    }
  }

  dispose(): void {
    this.seen.clear();
    this.clock = 0;
  }
}
