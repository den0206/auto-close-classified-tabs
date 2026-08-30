import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { LruTracker, pickTabsToClose, type TabLike } from './autoClose';

const OPTS = { maxTabs: 3, closePreviewFirst: true };

/** order は配列の並び順から自動で振る。 */
function tabs(...specs: Array<Partial<TabLike> & { key: string }>): TabLike[] {
  const counters = new Map<number, number>();
  return specs.map((s) => {
    const group = s.group ?? 1;
    const order = counters.get(group) ?? 0;
    counters.set(group, order + 1);
    return {
      group, order,
      isDirty: false, isPinned: false, isActive: false, isPreview: false,
      closable: true, lastUsed: 0,
      ...s,
    };
  });
}

test('上限以下なら何も閉じない', () => {
  const t = tabs({ key: 'a' }, { key: 'b' }, { key: 'c' });
  assert.deepEqual(pickTabsToClose(t, OPTS), []);
});

test('上限を 2 超過したらちょうど 2 枚だけ閉じる', () => {
  const t = tabs(
    { key: 'a', lastUsed: 1 }, { key: 'b', lastUsed: 2 }, { key: 'c', lastUsed: 3 },
    { key: 'd', lastUsed: 4 }, { key: 'e', lastUsed: 5, isActive: true },
  );
  assert.deepEqual(pickTabsToClose(t, OPTS), ['a', 'b']);
});

test('未保存のタブは閉じない', () => {
  const t = tabs(
    { key: 'a', lastUsed: 1, isDirty: true }, { key: 'b', lastUsed: 2 },
    { key: 'c', lastUsed: 3 }, { key: 'd', lastUsed: 4 },
  );
  assert.deepEqual(pickTabsToClose(t, OPTS), ['b']);
});

test('ピン留めしたタブは閉じない', () => {
  const t = tabs(
    { key: 'a', lastUsed: 1, isPinned: true }, { key: 'b', lastUsed: 2 },
    { key: 'c', lastUsed: 3 }, { key: 'd', lastUsed: 4 },
  );
  assert.deepEqual(pickTabsToClose(t, OPTS), ['b']);
});

test('アクティブなタブは閉じない', () => {
  const t = tabs(
    { key: 'a', lastUsed: 1, isActive: true }, { key: 'b', lastUsed: 2 },
    { key: 'c', lastUsed: 3 }, { key: 'd', lastUsed: 4 },
  );
  assert.deepEqual(pickTabsToClose(t, OPTS), ['b']);
});

test('グループ内で唯一のタブは閉じない', () => {
  const t = tabs({ key: 'only', lastUsed: 1 });
  assert.deepEqual(pickTabsToClose(t, { maxTabs: 1, closePreviewFirst: true }), []);
});

test('ターミナルと並んだ最後のエディタは閉じない', () => {
  // 対象外のタブは「残る最後の 1 枚」の数に入れない
  const t = tabs({ key: 'term', closable: false }, { key: 'only', lastUsed: 1 });
  assert.deepEqual(pickTabsToClose(t, { maxTabs: 0, closePreviewFirst: true }), []);
});

test('プレビュータブを古い通常タブより先に閉じる', () => {
  const t = tabs(
    { key: 'old', lastUsed: 1 }, { key: 'mid', lastUsed: 2 },
    { key: 'preview', lastUsed: 9, isPreview: true }, { key: 'new', lastUsed: 10, isActive: true },
  );
  assert.deepEqual(pickTabsToClose(t, OPTS), ['preview']);
});

test('closePreviewFirst が false なら純粋な LRU 順', () => {
  const t = tabs(
    { key: 'old', lastUsed: 1 }, { key: 'mid', lastUsed: 2 },
    { key: 'preview', lastUsed: 9, isPreview: true }, { key: 'new', lastUsed: 10, isActive: true },
  );
  assert.deepEqual(pickTabsToClose(t, { maxTabs: 3, closePreviewFirst: false }), ['old']);
});

test('全タブが保護対象なら諦めて空を返す', () => {
  const t = tabs(
    { key: 'a', isDirty: true }, { key: 'b', isPinned: true },
    { key: 'c', isDirty: true }, { key: 'd', isActive: true },
  );
  assert.deepEqual(pickTabsToClose(t, OPTS), []);
});

test('グループごとに独立して選定する', () => {
  const t = tabs(
    { key: 'g1a', group: 1, lastUsed: 1 }, { key: 'g1b', group: 1, lastUsed: 2 },
    { key: 'g1c', group: 1, lastUsed: 3 }, { key: 'g1d', group: 1, lastUsed: 4 },
    { key: 'g2a', group: 2, lastUsed: 1 }, { key: 'g2b', group: 2, lastUsed: 2 },
    { key: 'g2c', group: 2, lastUsed: 3 }, { key: 'g2d', group: 2, lastUsed: 4 },
  );
  assert.deepEqual(pickTabsToClose(t, OPTS).sort(), ['g1a', 'g2a']);
});

test('LRU が同点(未訪問)なら並び順で左を選ぶ', () => {
  const t = tabs(
    { key: 'left' }, { key: 'mid' }, { key: 'right' }, { key: 'active', isActive: true },
  );
  assert.deepEqual(pickTabsToClose(t, OPTS), ['left']);
});

test('対象外のタブは候補にも上限カウントにも入れない', () => {
  const t = tabs(
    { key: 'term1', closable: false }, { key: 'term2', closable: false },
    { key: 'a', lastUsed: 1 }, { key: 'b', lastUsed: 2 }, { key: 'c', lastUsed: 3 },
  );
  assert.deepEqual(pickTabsToClose(t, OPTS), []);
});

test('maxTabs が 0 や負でも最低 1 枚は残す', () => {
  const t = tabs({ key: 'a', lastUsed: 1 }, { key: 'b', lastUsed: 2, isActive: true });
  assert.deepEqual(pickTabsToClose(t, { maxTabs: 0, closePreviewFirst: true }), ['a']);
  assert.deepEqual(pickTabsToClose(t, { maxTabs: -5, closePreviewFirst: true }), ['a']);
});

test('種別ごとの上限が全体の上限より先に効く', () => {
  const t = tabs(
    { key: 'd1', type: 'diff', lastUsed: 1 },
    { key: 'd2', type: 'diff', lastUsed: 2 },
    { key: 'd3', type: 'diff', lastUsed: 3 },
    { key: 'code', type: 'dart', lastUsed: 4, isActive: true },
  );
  // 全体は 3 枚まで(=1 枚超過)だが、diff が 1 枚までなので diff を 2 枚閉じる
  assert.deepEqual(
    pickTabsToClose(t, { ...OPTS, maxTabsByType: { diff: 1 } }).sort(),
    ['d1', 'd2'],
  );
});

test('種別上限で閉じた分は全体の上限から差し引かれる', () => {
  const t = tabs(
    { key: 'old', type: 'dart', lastUsed: 1 },
    { key: 'd1', type: 'diff', lastUsed: 2 },
    { key: 'd2', type: 'diff', lastUsed: 3 },
    { key: 'c1', type: 'dart', lastUsed: 4 },
    { key: 'c2', type: 'dart', lastUsed: 5, isActive: true },
  );
  // 5 枚 → diff 上限で 1 枚 → 残り 4 枚 → 全体 3 枚まであと 1 枚 = 合計 2 枚
  const got = pickTabsToClose(t, { ...OPTS, maxTabsByType: { diff: 1 } });
  assert.equal(got.length, 2, '二重に数えて閉じすぎ／閉じなさすぎ');
  assert.ok(got.includes('d1'), '古い方の diff が閉じられていない');
  assert.ok(got.includes('old'), '全体の上限ぶんが LRU 順で閉じられていない');
});

test('全体の上限は種別を問わず LRU 順で閉じる', () => {
  const t = tabs(
    { key: 'd1', type: 'diff', lastUsed: 1 },
    { key: 'd2', type: 'diff', lastUsed: 2 },
    { key: 'c1', type: 'dart', lastUsed: 3 },
    { key: 'c2', type: 'dart', lastUsed: 4 },
    { key: 'c3', type: 'dart', lastUsed: 5, isActive: true },
  );
  // 種別上限で d1 が消え、全体の上限ぶんは残りで最も古い d2 が選ばれる
  assert.deepEqual(
    pickTabsToClose(t, { ...OPTS, maxTabsByType: { diff: 1 } }).sort(),
    ['d1', 'd2'],
  );
});

test('種別上限でも未保存とピン留めは閉じない', () => {
  const t = tabs(
    { key: 'd1', type: 'diff', lastUsed: 1, isDirty: true },
    { key: 'd2', type: 'diff', lastUsed: 2, isPinned: true },
    { key: 'd3', type: 'diff', lastUsed: 3 },
    { key: 'code', type: 'dart', lastUsed: 4, isActive: true },
  );
  assert.deepEqual(pickTabsToClose(t, { ...OPTS, maxTabsByType: { diff: 1 } }), ['d3']);
});

test('コードファイルは種別上限の対象外なら全体の上限だけが効く', () => {
  const t = tabs(
    { key: 'c1', type: 'dart', lastUsed: 1 },
    { key: 'c2', type: 'ruby', lastUsed: 2 },
    { key: 'c3', type: 'dart', lastUsed: 3 },
    { key: 'c4', type: 'ruby', lastUsed: 4, isActive: true },
  );
  assert.deepEqual(pickTabsToClose(t, { ...OPTS, maxTabsByType: { diff: 1 } }), ['c1']);
});

test('種別上限が 0 ならその種別を全部閉じる', () => {
  const t = tabs(
    { key: 'g1', type: 'generated', lastUsed: 1 },
    { key: 'g2', type: 'generated', lastUsed: 2 },
    { key: 'code', type: 'dart', lastUsed: 3, isActive: true },
  );
  assert.deepEqual(
    pickTabsToClose(t, { ...OPTS, maxTabsByType: { generated: 0 } }).sort(),
    ['g1', 'g2'],
  );
});

test('種別が判定できないタブは種別上限に巻き込まれない', () => {
  const t = tabs(
    { key: 'u1', lastUsed: 1 },
    { key: 'd1', type: 'diff', lastUsed: 2 },
    { key: 'd2', type: 'diff', lastUsed: 3 },
    { key: 'code', type: 'dart', lastUsed: 4, isActive: true },
  );
  assert.deepEqual(pickTabsToClose(t, { ...OPTS, maxTabsByType: { diff: 1 } }), ['d1']);
});

test('LruTracker: アクセスで順序が更新される', () => {
  const lru = new LruTracker();
  lru.touch('a');
  lru.touch('b');
  assert.ok(lru.lastUsed('b') > lru.lastUsed('a'));
  assert.equal(lru.lastUsed('unknown'), 0);
});

test('LruTracker: 同じキーの再訪問でエントリは増えない', () => {
  const lru = new LruTracker();
  lru.touch('a');
  const first = lru.lastUsed('a');
  lru.touch('a');
  assert.equal(lru.size, 1);
  assert.ok(lru.lastUsed('a') > first);
});

test('LruTracker: 閉じたタブのキーは消える', () => {
  const lru = new LruTracker();
  lru.touch('a');
  lru.forget('a');
  assert.equal(lru.size, 0);
  assert.equal(lru.lastUsed('a'), 0);
});

test('LruTracker: retain で孤児キーが消える', () => {
  const lru = new LruTracker();
  ['a', 'b', 'c'].forEach((k) => lru.touch(k));
  lru.retain(['b']);
  assert.equal(lru.size, 1);
  assert.equal(lru.lastUsed('a'), 0);
  assert.ok(lru.lastUsed('b') > 0);
});

test('LruTracker: 開閉を 1000 回繰り返しても現存タブ数を超えない', () => {
  const lru = new LruTracker();
  const live = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    const key = `file-${i}`;
    lru.touch(key);
    live.add(key);
    if (live.size > 5) {
      const oldest = live.values().next().value as string;
      live.delete(oldest);
      lru.forget(oldest);
    }
    lru.retain(live);
    assert.ok(lru.size <= live.size, `size ${lru.size} > live ${live.size} at i=${i}`);
  }
  assert.ok(lru.size <= 5);
});

test('LruTracker: dispose で空になる', () => {
  const lru = new LruTracker();
  ['a', 'b'].forEach((k) => lru.touch(k));
  lru.dispose();
  assert.equal(lru.size, 0);
  assert.equal(lru.lastUsed('a'), 0);
});
