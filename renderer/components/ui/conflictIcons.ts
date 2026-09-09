/**
 * Conflict icons as markup (shared across Vue template and Monaco raw DOM).
 * Visual grammar: filled bar (your side), outlined bar (incoming side); position is order in result.
 */

export type ConflictIconName =
  | 'keepMine'
  | 'keepIncoming'
  | 'keepMineThenIncoming'
  | 'keepIncomingThenMine'
  | 'keepBase'
  | 'autoMerge'
  | 'resolve'
  | 'mergetool'
  | 'markResolved';

/** One bar, filled: "the side you are on". */
function filledBar(y: number): string
{
  return `<rect x="2" y="${y}" width="12" height="4" rx="1" fill="currentColor"/>`;
}

/** One bar, outlined: "the side coming in". */
function outlinedBar(y: number): string
{
  return `<rect x="2.6" y="${y + 0.6}" width="10.8" height="2.8" rx="0.8" fill="none" stroke="currentColor" stroke-width="1.2"/>`;
}

/** One bar, dashed: the common ancestor, which is neither side. */
function dashedBar(y: number): string
{
  return `<rect x="2.6" y="${y + 0.6}" width="10.8" height="2.8" rx="0.8" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2.4 1.8"/>`;
}

const Y_TOP = 2;
const Y_MIDDLE = 6;
const Y_BOTTOM = 10;

const STROKE = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';

const ICONS: Record<ConflictIconName, string> = {
  keepMine: filledBar(Y_MIDDLE),
  keepIncoming: outlinedBar(Y_MIDDLE),
  keepMineThenIncoming: filledBar(Y_TOP) + outlinedBar(Y_BOTTOM),
  keepIncomingThenMine: outlinedBar(Y_TOP) + filledBar(Y_BOTTOM),
  keepBase: dashedBar(Y_MIDDLE),
  // One bar made of both halves: the two sides interleaved into a single line, which is
  // exactly what a word-level merge produces and what no other icon here depicts.
  autoMerge:
    `<rect x="2" y="${Y_MIDDLE}" width="5.6" height="4" rx="1" fill="currentColor"/>` +
    `<rect x="9" y="${Y_MIDDLE + 0.6}" width="4.4" height="2.8" rx="0.8" fill="none" stroke="currentColor" stroke-width="1.2"/>`,
  // A pencil: this is the one that opens something you type in.
  resolve: `<path d="M10.9 2.4 13.6 5.1 5.5 13.2 2.2 13.8 2.8 10.5z" ${STROKE} stroke-width="1.3"/>`,
  // A box with an arrow leaving it: the same "opens elsewhere" idiom the rest of the app
  // uses for anything handed to another application.
  mergetool:
    `<path d="M9.4 2.6h4v4" ${STROKE} stroke-width="1.3"/>` +
    `<path d="M13.4 2.6 7.9 8.1" ${STROKE} stroke-width="1.3"/>` +
    `<path d="M11.2 9.4v3.1a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5.8a1 1 0 0 1 1-1h3.1" ${STROKE} stroke-width="1.3"/>`,
  markResolved: `<path d="M3 8.4 6.3 11.7 13 4.9" ${STROKE} stroke-width="1.7"/>`
};

const VIEW_BOX = '0 0 16 16';
const SVG_NS = 'http://www.w3.org/2000/svg';

/** The icon as a complete `<svg>` string, for a template or an `innerHTML`. */
export function conflictIconSvg(name: ConflictIconName, size = 14): string
{
  return `<svg viewBox="${VIEW_BOX}" width="${size}" height="${size}" aria-hidden="true">${ICONS[name]}</svg>`;
}

/**
 * Icon as SVG element for Monaco view zone (toolbar).
 * Built via innerHTML on namespaced container (markup is literal, no untrusted strings).
 */
export function conflictIconElement(name: ConflictIconName, size = 14): SVGSVGElement
{
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', VIEW_BOX);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[name];
  return svg;
}
