// タブ文字色が実機で見分けられる距離を保っているかを機械的に見張る。
// 色を足す・変えるときにここが落ちたら、その色は既存のどれかと近すぎる。

const { test } = require('node:test');
const assert = require('node:assert').strict;
const { paletteFromManifest, rankPairs, hexToLab, deltaE2000 } = require('./color-distance.js');

/**
 * 許容する最小の色差。CIEDE2000。
 * 実測の下限は dark 6.2 / light 6.3 なので、6.0 を割ったら「新しく入れた色が近すぎる」。
 * この値を下げて通すのではなく、色相か明度を動かして距離を取ること。
 */
const FLOOR = 6.0;

/** 文字色として背景から浮くのに要る比。WCAG AA(通常サイズの文字)。 */
const MIN_CONTRAST = 4.5;
/** 既定テーマのエディタ背景に近い値。装飾は前景色なのでこの上に載る。 */
const BACKGROUND = { dark: '#1F1F1F', light: '#FFFFFF' };
/** 自動生成物は「沈ませる」のが仕事なので、コントラストの下限から外す。 */
const DELIBERATELY_DIM = new Set(['generated']);

const palette = paletteFromManifest();

for (const theme of ['dark', 'light']) {
  test(`${theme}: どの 2 色も ΔE2000 ${FLOOR} 以上離れている`, () => {
    const closest = rankPairs(palette, theme)[0];
    assert.ok(
      closest.delta >= FLOOR,
      `${closest.a} と ${closest.b} が ΔE2000 ${closest.delta.toFixed(1)} しか離れていない`,
    );
  });

  test(`${theme}: どの色も背景に対して ${MIN_CONTRAST}:1 以上のコントラストがある`, () => {
    for (const color of palette) {
      if (DELIBERATELY_DIM.has(color.id)) continue;
      const ratio = contrast(color[theme], BACKGROUND[theme]);
      assert.ok(ratio >= MIN_CONTRAST, `${color.id} (${color[theme]}) が ${ratio.toFixed(2)}:1 しかない`);
    }
  });
}

test('色差は CIE76 ではなく CIEDE2000 で測っている', () => {
  // CIE76 は青系の差を過大に見積もる。本拡張は暖色を避けた結果いちばん青が混んでいるので、
  // ここを取り違えると近すぎる色を「離れている」と誤判定する(実際に一度そうなった)。
  const a = hexToLab('#2863A4'); // かつての typescript(light)
  const b = hexToLab('#0060AC'); // かつての xml(light)
  const cie76 = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  assert.ok(cie76 > 6, `CIE76 では ${cie76.toFixed(1)} と離れて見える`);
  assert.ok(deltaE2000(a, b) < 2, 'CIEDE2000 ではほぼ同色と出るはず');
});

function contrast(fg, bg) {
  const lum = (hex) => {
    const ch = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}
