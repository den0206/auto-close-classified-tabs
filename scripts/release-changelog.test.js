// CHANGELOG のバージョン切り出しを検証する。
//
// 公開ページ(Open VSX / Marketplace)が出すのは **VSIX 内の CHANGELOG.md** なので、
// 切り出しに失敗すると利用者からは「全部 Unreleased」に見える。手作業に頼らないよう
// スクリプト化してあり、ここではその振る舞いと、いま入っている CHANGELOG の形を見る。
const { test } = require('node:test');
const assert = require('node:assert').strict;
const fs = require('node:fs');
const path = require('node:path');

const { cutRelease } = require('./release-changelog.js');

const root = path.join(__dirname, '..');
const SAMPLE = `# Changelog

## [Unreleased]

### Added

- Something new

## [0.1.1] — 2026-08-18

### Fixed

- Something old
`;

test('[Unreleased] が日付付きの見出しへ移る', () => {
  const { changed, text } = cutRelease(SAMPLE, '0.2.0', '2026-09-01');
  assert.equal(changed, true);
  assert.match(text, /^## \[0\.2\.0\] — 2026-09-01$/m);
  // 新しい見出しの下に入り、過去のリリースは壊れない
  assert.ok(text.indexOf('- Something new') < text.indexOf('## [0.1.1]'));
  assert.match(text, /## \[0\.1\.1\] — 2026-08-18/);
  assert.match(text, /- Something old/);
});

test('[Unreleased] は残って空になる', () => {
  const { text } = cutRelease(SAMPLE, '0.2.0', '2026-09-01');
  const between = text.slice(
    text.indexOf('## [Unreleased]') + '## [Unreleased]'.length,
    text.indexOf('## [0.2.0]'),
  );
  assert.equal(between.trim(), '');
});

// +N 再ビルドは同じ X.Y.Z を共有するので、2 度目は何もしないことが要る。
test('同じバージョンを 2 度切っても増えない', () => {
  const once = cutRelease(SAMPLE, '0.2.0', '2026-09-01');
  const twice = cutRelease(once.text, '0.2.0', '2026-09-02');
  assert.equal(twice.changed, false);
  assert.equal(twice.text, once.text);
});

test('項目が無ければ空の見出しを作らない', () => {
  const empty = '# Changelog\n\n## [Unreleased]\n\n## [0.1.1] — 2026-08-18\n\n- x\n';
  const r = cutRelease(empty, '0.2.0', '2026-09-01');
  assert.equal(r.changed, false);
  assert.match(r.reason, /項目が無い/);
});

test('入力が壊れていたら止まる', () => {
  assert.throws(() => cutRelease('# Changelog\n', '0.2.0', '2026-09-01'), /Unreleased/);
  assert.throws(() => cutRelease(SAMPLE, 'v0.2', '2026-09-01'), /X\.Y\.Z/);
  assert.throws(() => cutRelease(SAMPLE, '0.2.0', '2026/09/01'), /YYYY-MM-DD/);
});

// ここから下は、いま入っている CHANGELOG.md 自体の形を見る。
const actual = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
const headings = actual.split('\n').filter((l) => l.startsWith('## ')).map((l) => l.trim());

test('先頭は [Unreleased]、リリース済みは日付付きで新しい順', () => {
  assert.equal(headings[0], '## [Unreleased]');
  const versions = headings.slice(1).map((h) => {
    assert.match(h, /^## \[\d+\.\d+\.\d+\] — \d{4}-\d{2}-\d{2}$/, h);
    return /\[(\d+\.\d+\.\d+)\]/.exec(h)[1].split('.').map(Number);
  });
  for (let i = 1; i < versions.length; i++) {
    const [a, b] = [versions[i - 1], versions[i]];
    assert.ok(a[0] - b[0] || a[1] - b[1] || a[2] - b[2] > 0, `${a} の次に ${b}`);
  }
});

test('公開中の版の見出しがある', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(headings.some((h) => h.includes(`[${pkg.version}]`)), `${pkg.version} の見出しが無い`);
});

// 公開ページは全世界から読まれる。日本語が混ざるとその節だけ読めない人が出る
// (コミットメッセージやコードのコメントは日本語のままでよい)。
test('英語で書かれていて、節の見出しは Keep a Changelog の表記', () => {
  const ja = actual.split('\n')
    .map((line, i) => (/[぀-ゟ゠-ヿ一-鿿]/.test(line) ? `${i + 1}行目` : null))
    .filter(Boolean);
  assert.equal(ja.length, 0, ja.slice(0, 5).join(', '));

  // Keep a Changelog の 6 節 + Notes(どの節にも属さない補足。0.1.0 で使っている)
  const known = new Set(['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security', 'Notes']);
  const unknown = [...new Set(actual.split('\n').filter((l) => l.startsWith('### ')).map((l) => l.slice(4).trim()))]
    .filter((s) => !known.has(s));
  assert.equal(unknown.length, 0, unknown.join(', '));
});
