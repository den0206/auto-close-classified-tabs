// ファイルパス → 種別の判定。vscode に依存しない純粋なロジック。

/** 色 ID。`autoCloseClassifiedTabs.<id>` というテーマカラーとして package.json に定義してある。 */
export type ColorId =
  | 'diff' | 'test' | 'generated' | 'docs'
  | 'json' | 'yaml' | 'toml' | 'env' | 'sql' | 'shell' | 'docker'
  | 'typescript' | 'javascript' | 'dart' | 'python' | 'go' | 'rust'
  | 'jvm' | 'swift' | 'ruby' | 'php' | 'cfamily' | 'csharp'
  | 'html' | 'css' | 'xml';

export const COLOR_IDS: readonly ColorId[] = [
  'diff', 'test', 'generated', 'docs',
  'json', 'yaml', 'toml', 'env', 'sql', 'shell', 'docker',
  'typescript', 'javascript', 'dart', 'python', 'go', 'rust',
  'jvm', 'swift', 'ruby', 'php', 'cfamily', 'csharp',
  'html', 'css', 'xml',
];

export interface Category {
  color: ColorId;
  /** Explorer 用の 2 文字バッジ(タブには表示されない) */
  badge: string;
  /** タブ名の先頭に付ける記号。拡張子ごとに変えて、同じ色どうしも見分けられるようにする */
  icon: string;
}

/**
 * 拡張子 → 色と記号。キーは小文字・ドット付きの末尾一致。
 * 色は言語の公式カラーに寄せてある。見慣れた対応の方が覚え直さずに済む。
 */
const BY_SUFFIX: Record<string, Category> = {
  // --- JS / TS
  '.ts':     { color: 'typescript', badge: 'TS', icon: '🟦' },
  '.mts':    { color: 'typescript', badge: 'TS', icon: '🟦' },
  '.cts':    { color: 'typescript', badge: 'TS', icon: '🟦' },
  '.tsx':    { color: 'typescript', badge: 'TX', icon: '⚛️' },
  '.js':     { color: 'javascript', badge: 'JS', icon: '🟨' },
  '.mjs':    { color: 'javascript', badge: 'JS', icon: '🟨' },
  '.cjs':    { color: 'javascript', badge: 'JS', icon: '🟨' },
  '.jsx':    { color: 'javascript', badge: 'JX', icon: '⚛️' },

  // --- その他の言語
  '.dart':   { color: 'dart',    badge: 'DA', icon: '🎯' },
  '.py':     { color: 'python',  badge: 'PY', icon: '🐍' },
  '.pyi':    { color: 'python',  badge: 'PY', icon: '🐍' },
  '.go':     { color: 'go',      badge: 'GO', icon: '🐹' },
  '.rs':     { color: 'rust',    badge: 'RS', icon: '🦀' },
  '.java':   { color: 'jvm',     badge: 'JV', icon: '☕' },
  '.kt':     { color: 'jvm',     badge: 'KT', icon: '🟪' },
  '.kts':    { color: 'jvm',     badge: 'KT', icon: '🟪' },
  '.scala':  { color: 'jvm',     badge: 'SC', icon: '🔺' },
  '.swift':  { color: 'swift',   badge: 'SW', icon: '🐦' },
  '.m':      { color: 'swift',   badge: 'M',  icon: '🍎' },
  '.mm':     { color: 'swift',   badge: 'MM', icon: '🍎' },
  '.rb':     { color: 'ruby',    badge: 'RB', icon: '💎' },
  '.php':    { color: 'php',     badge: 'PH', icon: '🐘' },
  '.cs':     { color: 'csharp',  badge: 'C#', icon: '🟣' },
  '.c':      { color: 'cfamily', badge: 'C',  icon: '🔧' },
  '.h':      { color: 'cfamily', badge: 'H',  icon: '🔩' },
  '.cpp':    { color: 'cfamily', badge: 'C+', icon: '🔧' },
  '.cc':     { color: 'cfamily', badge: 'C+', icon: '🔧' },
  '.hpp':    { color: 'cfamily', badge: 'H+', icon: '🔩' },
  '.zig':    { color: 'cfamily', badge: 'ZG', icon: '⚡' },
  '.lua':    { color: 'shell',   badge: 'LU', icon: '🌙' },
  '.pl':     { color: 'shell',   badge: 'PL', icon: '🐪' },
  '.r':      { color: 'shell',   badge: 'R',  icon: '📊' },

  // --- シェル
  '.sh':     { color: 'shell', badge: 'SH', icon: '🐚' },
  '.bash':   { color: 'shell', badge: 'SH', icon: '🐚' },
  '.zsh':    { color: 'shell', badge: 'SH', icon: '🐚' },
  '.fish':   { color: 'shell', badge: 'SH', icon: '🐚' },
  '.ps1':    { color: 'shell', badge: 'PS', icon: '🔷' },

  // --- マークアップ / スタイル
  '.html':   { color: 'html', badge: '<>', icon: '🌐' },
  '.htm':    { color: 'html', badge: '<>', icon: '🌐' },
  '.vue':    { color: 'html', badge: 'VU', icon: '💚' },
  '.svelte': { color: 'html', badge: 'SV', icon: '🧡' },
  '.css':    { color: 'css',  badge: '#',  icon: '🎨' },
  '.scss':   { color: 'css',  badge: 'SC', icon: '🎨' },
  '.sass':   { color: 'css',  badge: 'SA', icon: '🎨' },
  '.less':   { color: 'css',  badge: 'LE', icon: '🎨' },
  '.xml':    { color: 'xml',  badge: 'XM', icon: '🏷' },
  '.svg':    { color: 'xml',  badge: 'SG', icon: '🖼' },

  // --- ドキュメント
  '.md':       { color: 'docs', badge: 'MD', icon: '📄' },
  '.markdown': { color: 'docs', badge: 'MD', icon: '📄' },
  '.mdx':      { color: 'docs', badge: 'MX', icon: '📝' },
  '.txt':      { color: 'docs', badge: 'TX', icon: '📃' },
  '.rst':      { color: 'docs', badge: 'RS', icon: '📃' },
  '.adoc':     { color: 'docs', badge: 'AD', icon: '📃' },
  '.pdf':      { color: 'docs', badge: 'PD', icon: '📕' },
  'license':   { color: 'docs', badge: 'LI', icon: '⚖️' },

  // --- 設定。同じ「設定ファイル」でも書式ごとに色と記号を分ける
  '.json':      { color: 'json',   badge: '{}', icon: '{}' },
  '.jsonc':     { color: 'json',   badge: '{}', icon: '{}' },
  '.json5':     { color: 'json',   badge: '{}', icon: '{}' },
  '.yaml':      { color: 'yaml',   badge: 'YM', icon: '📋' },
  '.yml':       { color: 'yaml',   badge: 'YM', icon: '📋' },
  '.toml':      { color: 'toml',   badge: 'TM', icon: '🧱' },
  '.ini':       { color: 'toml',   badge: 'IN', icon: '🧱' },
  '.properties':{ color: 'toml',   badge: 'PR', icon: '🧱' },
  '.env':       { color: 'env',    badge: 'EN', icon: '🔑' },
  '.sql':       { color: 'sql',    badge: 'SQ', icon: '🗄' },
  '.proto':     { color: 'sql',    badge: 'PB', icon: '🔌' },
  '.graphql':   { color: 'sql',    badge: 'GQ', icon: '🔌' },
  '.gql':       { color: 'sql',    badge: 'GQ', icon: '🔌' },
  'dockerfile': { color: 'docker', badge: 'DK', icon: '🐳' },
  'makefile':   { color: 'docker', badge: 'MK', icon: '🛠' },
};

/** 自動生成物。拡張子より優先。 */
const GENERATED_SUFFIXES = [
  '.g.dart', '.freezed.dart', '.gr.dart', '.config.dart',
  '.generated.ts', '.gen.go', '_pb2.py', '.pb.go', '.d.ts',
  '.lock', '.min.js', '.min.css', '.map',
];

/** テストファイル。拡張子より優先。 */
const TEST_MARKERS = ['.test.', '.spec.', '_test.', '_spec.', '.stories.'];
const TEST_DIRS = ['/test/', '/tests/', '/__tests__/', '/spec/'];

/**
 * ドットファイル。拡張子として解釈できないので、ファイル名の先頭一致で引く。
 * `.env.local` のように後ろへ伸びるものも `.env` で拾える。
 */
const BY_DOTFILE: Record<string, Category> = {
  '.env':            { color: 'env',  badge: 'EN', icon: '🔑' },
  '.gitignore':      { color: 'toml', badge: '🚫', icon: '🚫' },
  '.dockerignore':   { color: 'toml', badge: '🚫', icon: '🚫' },
  '.eslintignore':   { color: 'toml', badge: '🚫', icon: '🚫' },
  '.prettierignore': { color: 'toml', badge: '🚫', icon: '🚫' },
  '.npmignore':      { color: 'toml', badge: '🚫', icon: '🚫' },
  '.vscodeignore':   { color: 'toml', badge: '🚫', icon: '🚫' },
  '.gitattributes':  { color: 'toml', badge: 'GA', icon: '🧱' },
  '.gitmodules':     { color: 'toml', badge: 'GM', icon: '🧱' },
  '.editorconfig':   { color: 'toml', badge: 'EC', icon: '🧱' },
  '.npmrc':          { color: 'toml', badge: 'NR', icon: '🧱' },
  '.nvmrc':          { color: 'toml', badge: 'NV', icon: '🧱' },
  '.eslintrc':       { color: 'json', badge: 'ES', icon: '{}' },
  '.prettierrc':     { color: 'json', badge: 'PR', icon: '{}' },
  '.babelrc':        { color: 'json', badge: 'BR', icon: '{}' },
  '.stylelintrc':    { color: 'json', badge: 'SR', icon: '{}' },
  '.swcrc':          { color: 'json', badge: 'SW', icon: '{}' },
  '.cursorrules':    { color: 'docs', badge: 'CR', icon: '📄' },
};

const GENERATED: Category = { color: 'generated', badge: '🔒', icon: '🔒' };
const TEST: Category      = { color: 'test',      badge: '🧪', icon: '🧪' };
const DIFF: Category      = { color: 'diff',      badge: '±',  icon: '🔀' };
/** ユーザー設定だけが当たったときの土台。拡張子が未知でも色は付ける。 */
const GENERIC: Category   = { color: 'docs',      badge: '●',  icon: '📌' };

/** キーが `/` を含めばパスの部分一致、含まなければ末尾一致。glob より弱いが依存も ReDoS も無い。 */
function ruleMatches(path: string, key: string): boolean {
  const k = key.toLowerCase();
  return k.includes('/') ? path.includes(k) : path.endsWith(k);
}

function isDiffScheme(scheme: string): boolean {
  return scheme === 'git' || scheme === 'gitfs' || scheme === 'gitlens'
    || scheme === 'review' || scheme === 'conflictResolution';
}

/** 拡張子・ファイル名・パスから決まる分類。ユーザー設定は見ない。 */
function preset(p: string, scheme: string, isDiffTab: boolean): Category | undefined {
  if (isDiffTab || isDiffScheme(scheme)) return DIFF;
  if (TEST_MARKERS.some((m) => p.includes(m)) || TEST_DIRS.some((d) => p.includes(d))) return TEST;
  if (GENERATED_SUFFIXES.some((s) => p.endsWith(s)) || p.includes('/node_modules/')) return GENERATED;

  const dot = p.lastIndexOf('.');
  const slash = p.lastIndexOf('/');
  if (dot > slash) {
    const hit = BY_SUFFIX[p.slice(dot)];
    if (hit) return hit;
  }
  const name = p.slice(slash + 1);
  const named = BY_SUFFIX[name]; // Dockerfile / Makefile / LICENSE
  if (named) return named;

  if (name.startsWith('.')) {
    for (const [key, cat] of Object.entries(BY_DOTFILE)) {
      if (name === key || name.startsWith(`${key}.`)) return cat;
    }
  }
  return undefined;
}

/**
 * ファイルの分類を返す。判定できなければ undefined(= 色を付けない)。
 * ユーザー設定は**色だけ**を差し替える。バッジと記号は拡張子から決まったものを残すので、
 * 色をまとめても書式ごとの見分けは失われない。
 * @param path  URI のパス。区切りは `/`。
 * @param scheme URI のスキーム。
 * @param userRules 設定 `autoCloseClassifiedTabs.colors.rules`。
 * @param isDiffTab タブが差分エディタなら true。
 */
export function categorize(
  path: string,
  scheme: string,
  userRules: Record<string, string> = {},
  isDiffTab = false,
): Category | undefined {
  const p = path.toLowerCase();
  const base = preset(p, scheme, isDiffTab);

  for (const [key, value] of Object.entries(userRules)) {
    if (!ruleMatches(p, key)) continue;
    const color = value as ColorId;
    if (!COLOR_IDS.includes(color)) continue; // 綴り間違いで装飾ごと消さない。拡張子の判定を残す
    return { ...(base ?? GENERIC), color };
  }
  return base;
}

/**
 * `workbench.editor.customLabels.patterns` 用のパターンを組み立てる。
 * 記号が同じ拡張子はまとめるので、設定は 30 行前後に収まる。
 * test / generated は色で判別できるため、パターンの優先順位争いを避けてここでは扱わない。
 */
export function buildLabelPatterns(): Record<string, string> {
  const byIcon = new Map<string, string[]>();
  for (const [suffix, cat] of Object.entries(BY_SUFFIX)) {
    if (!suffix.startsWith('.')) continue; // Dockerfile 等は大小の表記が定まらないので対象外
    const list = byIcon.get(cat.icon);
    if (list) list.push(suffix.slice(1)); else byIcon.set(cat.icon, [suffix.slice(1)]);
  }
  const patterns: Record<string, string> = {};
  for (const [icon, exts] of byIcon) {
    patterns[`**/*.{${exts.sort().join(',')}}`] = `${icon} \${filename}`;
  }

  const dotByIcon = new Map<string, string[]>();
  for (const [name, cat] of Object.entries(BY_DOTFILE)) {
    const list = dotByIcon.get(cat.icon);
    if (list) list.push(name); else dotByIcon.set(cat.icon, [name]);
  }
  for (const [icon, names] of dotByIcon) {
    // .env は .env.local のように後ろへ伸びるので、そこだけ前方一致にする。
    // 他を前方一致にすると .eslintrc.json が拡張子側のパターンと競合してしまう。
    const key = names.length === 1 && names[0] === '.env'
      ? '**/.env*'
      : `**/{${names.sort().join(',')}}`;
    patterns[key] = `${icon} \${filename}`;
  }
  return patterns;
}
