/**
 * Measure text width using canvas (no layout reflow like DOM).
 * Read style from real cell so numbers reflect actual grid font.
 */

export interface TextStyle {
  /** The canvas `font` shorthand: style, weight, size, family. */
  font: string;
  letterSpacing: string;
  uppercase: boolean;
}

/**
 * Canvas context for whole renderer. Null in headless/software environments;
 * callers use 0 minimum.
 */
let context: CanvasRenderingContext2D | null | undefined;

function canvasContext(): CanvasRenderingContext2D | null
{
  if (context === undefined)
  {
    context = document.createElement('canvas').getContext('2d');
  }
  return context;
}

export function styleOf(el: Element): TextStyle
{
  const computed = getComputedStyle(el);
  let letterSpacing: string;
  if (computed.letterSpacing === 'normal')
  {
    letterSpacing = '0px';
  }
  else
  {
    letterSpacing = computed.letterSpacing;
  }
  return {
    // Computed.font shorthand comes empty unless page set it as shorthand.
    font: `${computed.fontStyle} ${computed.fontWeight} ${computed.fontSize} ${computed.fontFamily}`,
    letterSpacing,
    uppercase: computed.textTransform === 'uppercase'
  };
}

const caches = new Map<string, Map<string, number>>();

/**
 * Limit cache per style to 4096 entries: names repeat, but dates are nearly
 * all distinct, so no ceiling means memory bloat in large histories.
 */
const CACHE_LIMIT = 4096;

export function textWidth(text: string, style: TextStyle): number
{
  const ctx = canvasContext();
  if (!ctx)
  {
    return 0;
  }

  const key = `${style.font}|${style.letterSpacing}|${style.uppercase}`;
  let cache = caches.get(key);
  if (!cache)
  {
    cache = new Map();
    caches.set(key, cache);
  }

  const hit = cache.get(text);
  if (hit !== undefined)
  {
    return hit;
  }

  ctx.font = style.font;
  ctx.letterSpacing = style.letterSpacing;
  let measured: string;
  if (style.uppercase)
  {
    measured = text.toUpperCase();
  }
  else
  {
    measured = text;
  }
  const width = ctx.measureText(measured).width;

  if (cache.size >= CACHE_LIMIT)
  {
    cache.clear();
  }
  cache.set(text, width);
  return width;
}
