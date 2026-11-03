/*
 * 流光毛玻璃的可读性模型（来自 YoLink web/appearance.js）。
 *
 * 玻璃填充（--glass-bg，透明度 alpha）合成在背景暗化层（.wallpaper-dimmer，dimmer）之上，
 * 后者再盖在壁纸上。模糊过的壁纸接近它的平均色；模糊半径很小时，最亮或最暗的像素会透出来，
 * 所以模糊越小，遮盖度下限越高。
 *
 * 最差情形：深色玻璃配纯白壁纸，浅色玻璃配纯黑壁纸。文字色与 tokens.css 保持一致，
 * 和下限一起由 tests/appearance-readability.test.ts 锁定。
 * 只作用于流光毛玻璃；人文羊皮纸用不透明纸面，不受这些下限影响。
 */

/** 遮盖度（%）的基本下限：模糊 ≥10px 时使用。 */
export const ALPHA_FLOOR = 62;
/** 背景暗化（%）下限。 */
export const DIMMER_FLOOR = 20;

/** 模糊半径（px）对应的遮盖度下限（%）。 */
export const alphaFloor = blur => blur < 6 ? 80 : blur < 10 ? 70 : ALPHA_FLOOR;

/** 文字与强调色，必须与 tokens.css 中的同名变量一致（cosmos = 深色玻璃 :root，light = html[data-theme=light-glass]）。 */
export const TEXT = Object.freeze({
  cosmos: Object.freeze({ text1: '#F4F6FB', text2: '#DCE2EC', text3: '#C3CCDA', primaryLight: '#BCD6FE' }),
  light: Object.freeze({ text1: '#0F172A', text2: '#334155', text3: '#3E4A5C', primaryLight: '#1D40AA' }),
});

/** 状态色作正文使用（徽标、错误提示、成功提示），同样按最差情形取值。 */
export const STATUS = Object.freeze({
  cosmos: Object.freeze({ success: '#8DE8C4', danger: '#FDC9C9', info: '#BCD6FE' }),
  light: Object.freeze({ success: '#05503B', danger: '#921B1B', info: '#1D40AA' }),
});

/** 各层的底色（rgb）与固定透明度，对应 tokens.css / base.css / themes.css。 */
export const LAYERS = Object.freeze({
  cosmos: Object.freeze({ dimmer: [6, 7, 9], dimmerScale: 1, fill: [21, 22, 26], fillScale: 1, fillOffset: 0, pill: [54, 57, 64, .28], strong: [18, 20, 24, .84] }),
  light: Object.freeze({ dimmer: [240, 244, 250], dimmerScale: .55, fill: [255, 255, 255], fillScale: .68, fillOffset: .28, pill: [224, 231, 241, .34], strong: [250, 252, 255, .88] }),
});

export const WALLPAPERS = Object.freeze({ white: [255, 255, 255], black: [0, 0, 0], grey: [128, 128, 128] });

const channel = v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
export const hexRgb = hex => { const h = String(hex).replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
export const luminance = c => .2126 * channel(c[0]) + .7152 * channel(c[1]) + .0722 * channel(c[2]);
export const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
export const over = (top, alpha, bottom) => top.map((v, i) => v * alpha + bottom[i] * (1 - alpha));

/**
 * 文字可能落在的三种玻璃表面：卡片填充、卡片里的 pill（标签、分段按钮）、强实底（弹层）。
 * @param {'cosmos'|'light'} mode @param {number[]} wallpaper @param {number} alpha 百分比 @param {number} dimmer 百分比
 */
export function glassSurfaces(mode, wallpaper, alpha, dimmer) {
  const layer = LAYERS[mode];
  const masked = over(layer.dimmer, dimmer / 100 * layer.dimmerScale, wallpaper);
  const fill = over(layer.fill, Math.min(1, alpha / 100 * layer.fillScale + layer.fillOffset), masked);
  return {
    fill,
    pill: over(layer.pill.slice(0, 3), layer.pill[3], fill),
    strong: over(layer.strong.slice(0, 3), layer.strong[3], wallpaper),
  };
}

/** 某个色值在三种表面上的最低对比度。 */
export function worstContrast(mode, color, wallpaper, alpha, dimmer) {
  const rgb = typeof color === 'string' ? hexRgb(color) : color;
  return Math.min(...Object.values(glassSurfaces(mode, wallpaper, alpha, dimmer)).map(bg => contrast(rgb, bg)));
}
