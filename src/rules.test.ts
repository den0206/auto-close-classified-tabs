import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildLabelPatterns, categorize, COLOR_IDS } from './rules';

const cat = (path: string, scheme = 'file', rules = {}, isDiff = false) =>
  categorize(path, scheme, rules, isDiff)?.color;
const icon = (path: string) => categorize(path, 'file')?.icon;

test('代表的な拡張子がそれぞれの色になる', () => {
  assert.equal(cat('/a/main.dart'), 'dart');
  assert.equal(cat('/a/index.ts'), 'typescript');
  assert.equal(cat('/a/app.py'), 'python');
  assert.equal(cat('/a/main.go'), 'go');
  assert.equal(cat('/a/lib.rs'), 'rust');
  assert.equal(cat('/a/style.scss'), 'css');
  assert.equal(cat('/a/README.md'), 'docs');
  assert.equal(cat('/a/tsconfig.json'), 'json');
});

test('同じ設定ファイルでも書式ごとに色と記号が分かれる', () => {
  assert.equal(cat('/a/settings.json'), 'json');
  assert.equal(cat('/a/pubspec.yaml'), 'yaml');
  assert.equal(cat('/a/analysis_options.yaml'), 'yaml');
  assert.equal(cat('/a/pyproject.toml'), 'toml');
  assert.notEqual(cat('/a/settings.json'), cat('/a/pubspec.yaml'));
  assert.notEqual(icon('/a/settings.json'), icon('/a/pubspec.yaml'));
});

test('テストファイルは言語の種別より優先される', () => {
  assert.equal(cat('/a/foo.test.ts'), 'test');
  assert.equal(cat('/a/foo_test.go'), 'test');
  assert.equal(cat('/a/foo.spec.js'), 'test');
  assert.equal(cat('/a/tests/helper.py'), 'test');
});

test('自動生成ファイルは言語の種別より優先される', () => {
  assert.equal(cat('/a/model.g.dart'), 'generated');
  assert.equal(cat('/a/model.freezed.dart'), 'generated');
  assert.equal(cat('/a/types.d.ts'), 'generated');
  assert.equal(cat('/a/pnpm-lock.yaml'), 'yaml'); // .lock ではないので YAML 扱い
  assert.equal(cat('/a/yarn.lock'), 'generated');
  assert.equal(cat('/a/node_modules/x/index.js'), 'generated');
});

test('git スキームは差分になる', () => {
  assert.equal(cat('/a/main.dart', 'git'), 'diff');
  assert.equal(cat('/a/main.dart', 'gitlens'), 'diff');
  assert.equal(cat('/a/main.dart', 'file', {}, true), 'diff');
});

test('ユーザー設定が色を上書きする', () => {
  assert.equal(cat('/a/schema.proto', 'file', { '.proto': 'docs' }), 'docs');
  assert.equal(cat('/a/legacy/old.ts', 'file', { 'legacy/': 'generated' }), 'generated');
  assert.equal(cat('/a/foo.test.ts', 'file', { '.test.ts': 'typescript' }), 'typescript');
});

test('色を上書きしても拡張子から決まった記号は残る', () => {
  const overridden = categorize('/a/pubspec.yaml', 'file', { 'pubspec.yaml': 'docs' });
  assert.equal(overridden?.color, 'docs');
  assert.equal(overridden?.icon, icon('/a/pubspec.yaml'), '記号まで置き換わっている');
});

test('拡張子が未知でもユーザー設定があれば色が付く', () => {
  assert.equal(cat('/a/mystery.qqq', 'file', { '.qqq': 'python' }), 'python');
});

test('未知の拡張子には色を付けない', () => {
  assert.equal(cat('/a/mystery.qqq'), undefined);
  assert.equal(cat('/a/noextension'), undefined);
});

test('拡張子の大文字小文字を区別しない', () => {
  assert.equal(cat('/a/README.MD'), 'docs');
  assert.equal(cat('/a/Main.DART'), 'dart');
});

test('ドットファイルも判定できる', () => {
  assert.equal(cat('/a/.eslintignore'), 'toml');
  assert.equal(cat('/a/.gitignore'), 'toml');
  assert.equal(cat('/a/.npmrc'), 'toml');
  assert.equal(cat('/a/.editorconfig'), 'toml');
  assert.equal(cat('/a/.eslintrc'), 'json');
  assert.equal(cat('/a/.prettierrc'), 'json');
});

test('ドットファイルの後ろに伸びた名前も拾える', () => {
  assert.equal(cat('/a/.env.local'), 'env');
  assert.equal(cat('/a/.env.production'), 'env');
});

test('ドットファイルでも明示的な拡張子があればそちらを優先する', () => {
  // 書式が分かるならその色にする。.eslintrc.json は JSON として読める
  assert.equal(cat('/a/.eslintrc.json'), 'json');
  assert.equal(cat('/a/.eslintrc.yaml'), 'yaml');
  assert.equal(cat('/a/.prettierrc.yml'), 'yaml');
});

test('未知のドットファイルには色を付けない', () => {
  assert.equal(cat('/a/.unknownrcfile'), undefined);
});

test('拡張子の無いファイル名も判定できる', () => {
  assert.equal(cat('/a/Dockerfile'), 'docker');
  assert.equal(cat('/a/Makefile'), 'docker');
  assert.equal(cat('/a/LICENSE'), 'docs');
});

test('複数のルールが当たったら長いキーが勝つ', () => {
  // settings.json の並べ替えで色が変わらないこと(記述順に依存しない)
  const rules = { '.ts': 'docs', 'src/api/': 'json' };
  const reversed = { 'src/api/': 'json', '.ts': 'docs' };
  assert.equal(cat('/a/src/api/client.ts', 'file', rules), 'json');
  assert.equal(cat('/a/src/api/client.ts', 'file', reversed), 'json');
  assert.equal(cat('/a/src/ui/view.ts', 'file', rules), 'docs');
});

test('長いキーの種別が不正なら次に長いキーへ落ちる', () => {
  assert.equal(cat('/a/src/api/client.ts', 'file', { 'src/api/': 'rainbow', '.ts': 'docs' }), 'docs');
});

test('未知の種別を指定した設定は無視して落ちない', () => {
  // 綴り間違いで装飾ごと消えず、拡張子の判定に戻る
  assert.equal(cat('/a/main.dart', 'file', { '.dart': 'rainbow' }), 'dart');
  assert.doesNotThrow(() => cat('/a/main.dart', 'file', { '': 'code' }));
});

test('ディレクトリ名の途中に拡張子があっても誤判定しない', () => {
  assert.equal(cat('/a/x.md/main.dart'), 'dart');
});

test('customLabels のパターンが組み立てられる', () => {
  const p = buildLabelPatterns();
  const keys = Object.keys(p).filter((k) => k.startsWith('**/*.{'));
  assert.ok(keys.length > 0);
  assert.ok(keys.every((k) => k.endsWith('}')));
  assert.ok(Object.values(p).every((v) => v.endsWith(' ${filename}')));
  // 拡張子がどのパターンにも重複して現れない(customLabels の優先順位争いを避ける)
  const seen = new Set<string>();
  for (const k of keys) {
    for (const ext of k.slice('**/*.{'.length, -1).split(',')) {
      assert.ok(!seen.has(ext), `拡張子 ${ext} が重複している`);
      seen.add(ext);
    }
  }
  assert.ok(seen.has('dart') && seen.has('py') && seen.has('md'));
});

test('customLabels がドットファイルもカバーする', () => {
  const p = buildLabelPatterns();
  assert.ok(p['**/.env*'], '.env のパターンが無い');
  const ignore = Object.keys(p).find((k) => k.includes('.gitignore'));
  assert.ok(ignore, '.gitignore のパターンが無い');
  assert.ok(!ignore!.endsWith('*'), 'ドットファイルの前方一致は拡張子側と競合する');
});

test('customLabels のパターンが json と yaml を別々の記号に分ける', () => {
  const p = buildLabelPatterns();
  const find = (ext: string) =>
    Object.entries(p).find(([k]) => k.slice('**/*.{'.length, -1).split(',').includes(ext))?.[1];
  assert.ok(find('json'));
  assert.ok(find('yaml'));
  assert.notEqual(find('json'), find('yaml'), 'json と yaml が同じ記号になっている');
});

// --- マニフェストとの整合性。色を足したときの更新漏れをここで止める。
const root = path.join(__dirname, '..');
const readJson = (f: string): Record<string, any> =>
  JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));

test('色 ID が package.json の contributes.colors と一致している', () => {
  const declared = (readJson('package.json').contributes.colors as Array<{ id: string }>)
    .map((c) => c.id.replace('autoCloseClassifiedTabs.', ''));
  assert.deepEqual([...COLOR_IDS].sort(), declared.sort());
});

test('すべての色 ID に英語と日本語の説明がある', () => {
  for (const f of ['package.nls.json', 'package.nls.ja.json']) {
    const nls = readJson(f);
    for (const id of COLOR_IDS) {
      assert.ok(nls[`color.${id}`], `${f} に color.${id} が無い`);
    }
  }
});

test('package.nls.json と package.nls.ja.json のキーが揃っている', () => {
  const en = Object.keys(readJson('package.nls.json')).sort();
  const ja = Object.keys(readJson('package.nls.ja.json')).sort();
  assert.deepEqual(en, ja);
});

test('マニフェストの %key% がすべて nls に定義されている', () => {
  const nls = readJson('package.nls.json');
  const used = JSON.stringify(readJson('package.json')).match(/%[a-zA-Z0-9._]+%/g) ?? [];
  for (const token of new Set(used)) {
    assert.ok(nls[token.slice(1, -1)], `${token} が package.nls.json に無い`);
  }
});

test('実行時依存パッケージを増やしていない', () => {
  assert.equal(readJson('package.json').dependencies, undefined);
});
