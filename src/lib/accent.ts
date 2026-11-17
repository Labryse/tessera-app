import { t } from './i18n';
// Picks a page accent from a game's cover art, then tames it: saturation is
// capped and lightness pinned per theme, so even a neon cover gives a soft hue.

const cache = new Map<string, [number, number, number]>();

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

/** dominant "interesting" hue of an image: [hue, saturation, lightness] */
export function sampleHue(src: string): Promise<[number, number, number]> {
  const hit = cache.get(src);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.crossOrigin = 'anonymous'; // Steam's CDN allows it; needed to read pixels
    img.src = src;
    img.onload = () => {
      try { read(); } catch { resolve([210, 0.1, 0.5]); }
    };
    const read = () => {
      const c = document.createElement('canvas');
      const w = 48, h = 72;
      c.width = w; c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      // 24 hue buckets weighted by saturation × mid-lightness
      const buckets = new Array(24).fill(0).map(() => ({ w: 0, s: 0, l: 0 }));
      for (let i = 0; i < data.length; i += 4) {
        const [hh, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
        if (s < 0.12 || l < 0.1 || l > 0.92) continue;
        const weight = s * (1 - Math.abs(l - 0.5) * 1.6);
        const b = buckets[Math.floor(hh / 15) % 24];
        b.w += weight; b.s += s * weight; b.l += l * weight;
      }
      let best = 0;
      buckets.forEach((b, i) => { if (b.w > buckets[best].w) best = i; });
      const b = buckets[best];
      const out: [number, number, number] = b.w > 0 ? [best * 15 + 7.5, b.s / b.w, b.l / b.w] : [210, 0.1, 0.5];
      cache.set(src, out);
      resolve(out);
    };
    img.onerror = () => resolve([210, 0.1, 0.5]);
  });
}

/** soft accent for the current theme */
export function tame([h, s]: [number, number, number], dark: boolean) {
  const sat = Math.min(s, 0.42) * 100;
  return {
    accent: t('hsl({0} {1}% {2}%)', h.toFixed(0), sat.toFixed(0), dark ? 74 : 36),
    accentInk: dark ? t('hsl({0} {1}% 12%)', h.toFixed(0), Math.min(sat, 30).toFixed(0)) : '#ffffff',
    wash: t('hsl({0} {1}% {2}%)', h.toFixed(0), Math.min(sat, 26).toFixed(0), dark ? 16 : 92),
  };
}
