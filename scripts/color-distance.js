// タブ文字色の見分けやすさを測る。CIEDE2000 で色差を出し、近すぎる組を洗い出す。
//
// 以前は CIE76(Lab のユークリッド距離)で測っていたが、あれは**青系の差を過大に見積もる**。
// 本拡張の色は暖色を避けた結果いちばん青が混み合っているので、CIE76 では
// `typescript` と `xml` の差が 7.0 と出て通ってしまい、実機ではほぼ同色だった。
// 以後は CIEDE2000 で測る。CLI として実行すると近い順に一覧を出す。
//
//   node scripts/color-distance.js          近い組を上から 12 件
//   node scripts/color-distance.js --all    しきい値未満の組を全部

'use strict';

const path = require('node:path');

/** sRGB の 16 進(`#RRGGBB`)→ CIELAB。D65 / 2°。 */
function hexToLab(hex) {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = ch.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const x = 0.4124 * r + 0.3576 * g + 0.1805 * b;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = 0.0193 * r + 0.1192 * g + 0.9505 * b;
  const white = [0.95047, 1, 1.08883];
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  const [fx, fy, fz] = [f(x / white[0]), f(y / white[1]), f(z / white[2])];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIEDE2000。kL = kC = kH = 1。 */
function deltaE2000(lab1, lab2) {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;
  const rad = Math.PI / 180;
  const deg = 180 / Math.PI;

  const cBar = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const g = 0.5 * (1 - Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7)));
  const ap1 = (1 + g) * a1;
  const ap2 = (1 + g) * a2;
  const cp1 = Math.hypot(ap1, b1);
  const cp2 = Math.hypot(ap2, b2);

  const hue = (b, a) => {
    if (a === 0 && b === 0) return 0;
    const h = Math.atan2(b, a) * deg;
    return h < 0 ? h + 360 : h;
  };
  const hp1 = hue(b1, ap1);
  const hp2 = hue(b2, ap2);

  const dL = L2 - L1;
  const dC = cp2 - cp1;
  let dh = 0;
  if (cp1 * cp2 !== 0) {
    dh = hp2 - hp1;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(cp1 * cp2) * Math.sin((dh / 2) * rad);

  const lBar = (L1 + L2) / 2;
  const cpBar = (cp1 + cp2) / 2;
  let hBar;
  if (cp1 * cp2 === 0) {
    hBar = hp1 + hp2;
  } else if (Math.abs(hp1 - hp2) > 180) {
    hBar = (hp1 + hp2 + (hp1 + hp2 < 360 ? 360 : -360)) / 2;
  } else {
    hBar = (hp1 + hp2) / 2;
  }

  const t = 1
    - 0.17 * Math.cos((hBar - 30) * rad)
    + 0.24 * Math.cos(2 * hBar * rad)
    + 0.32 * Math.cos((3 * hBar + 6) * rad)
    - 0.20 * Math.cos((4 * hBar - 63) * rad);

  const sL = 1 + (0.015 * (lBar - 50) ** 2) / Math.sqrt(20 + (lBar - 50) ** 2);
  const sC = 1 + 0.045 * cpBar;
  const sH = 1 + 0.015 * cpBar * t;
  const rt = -Math.sin(2 * (30 * Math.exp(-(((hBar - 275) / 25) ** 2))) * rad)
    * (2 * Math.sqrt(cpBar ** 7 / (cpBar ** 7 + 25 ** 7)));

  return Math.sqrt(
    (dL / sL) ** 2 + (dC / sC) ** 2 + (dH / sH) ** 2 + rt * (dC / sC) * (dH / sH),
  );
}

/** `package.json` の `contributes.colors` を `{ id, dark, light }` の配列で返す。 */
function paletteFromManifest(manifestPath = path.join(__dirname, '..', 'package.json')) {
  const manifest = require(manifestPath);
  return manifest.contributes.colors.map((c) => ({
    id: c.id.replace(/^.*\./, ''),
    dark: c.defaults.dark,
    light: c.defaults.light,
  }));
}

/** あるテーマの全組み合わせを色差の小さい順に返す。 */
function rankPairs(palette, theme) {
  const labs = palette.map((c) => ({ id: c.id, lab: hexToLab(c[theme]) }));
  const out = [];
  for (let i = 0; i < labs.length; i++) {
    for (let j = i + 1; j < labs.length; j++) {
      out.push({ a: labs[i].id, b: labs[j].id, delta: deltaE2000(labs[i].lab, labs[j].lab) });
    }
  }
  return out.sort((x, y) => x.delta - y.delta);
}

module.exports = { hexToLab, deltaE2000, paletteFromManifest, rankPairs };

if (require.main === module) {
  const all = process.argv.includes('--all');
  const palette = paletteFromManifest();
  for (const theme of ['dark', 'light']) {
    const ranked = rankPairs(palette, theme);
    console.log(`\n[${theme}] ${palette.length} 色 / ${ranked.length} 組  最小 ΔE2000 = ${ranked[0].delta.toFixed(1)}`);
    for (const p of all ? ranked.filter((p) => p.delta < 8) : ranked.slice(0, 12)) {
      console.log(`  ${p.delta.toFixed(1).padStart(5)}  ${p.a} ~ ${p.b}`);
    }
  }
}
