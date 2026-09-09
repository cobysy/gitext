/**
 * Syntax colour for the staging diff's rows. The rows stay rows: this is
 * `editor.colorize`, the tokenizer on its own, handing back the same `.mtk*` spans as
 * HTML. No editor, no worker, no selection model, so it never takes the per-line click
 * back from `StagingDiff.vue`. Safe to render as HTML: the escaping is Monaco's own, and a diff full of `<script>` comes back inert.
 */

import { ref, watch, type Ref } from 'vue';
import * as monaco from '@renderer/monaco.js';
import { applyMonacoTheme } from '@renderer/monaco.js';
import { LANGUAGE_PLAINTEXT, languageForPath } from '@renderer/monacoLang.js';
import { lineKey } from '@renderer/stores/staging.js';
import { LINE_KIND_ADD, LINE_KIND_DELETE, type PatchFile } from '@renderer/model/patch.js';


/** One side of the patch as it would read on its own, and which row each line came from. */
interface Side {
  text: string[];
  keys: string[];
}

/**
 * Split the patch back into the two files it is a difference between. Colorizing rows
 * as drawn would tokenize a deletion and its replacement as consecutive lines of one
 * file, letting an unterminated string bleed across; each side is a file that once compiled, so each is tokenized as one.
 */
function sidesOf(patch: PatchFile): [Side, Side]
{
  const before: Side = { text: [], keys: [] };
  const after: Side = { text: [], keys: [] };
  patch.hunks.forEach((hunk, hunkIndex) =>
  {
    hunk.lines.forEach((line, lineIndex) =>
    {
      const at = lineKey(hunkIndex, lineIndex);
      if (line.kind !== LINE_KIND_ADD)
      {
        before.text.push(line.text);
        before.keys.push(at);
      }
      if (line.kind !== LINE_KIND_DELETE)
      {
        after.text.push(line.text);
        after.keys.push(at);
      }
    });
  });
  return [before, after];
}

/** `colorize` writes every space as U+00A0 so a run survives in an editor; the rows are already `white-space: pre`, so a real space is what a copied line should have. */
function plainSpaces(html: string): string
{
  return html.replaceAll(' ', ' ');
}

/** Colorize one side and file its lines under the rows they came from. */
async function colourSide(side: Side, language: string): Promise<Map<string, string>>
{
  const into = new Map<string, string>();
  if (side.text.length === 0)
  {
    return into;
  }
  // One line of HTML per line of input, `<br/>` between: Monaco's own shape, not ours.
  const lines = (await monaco.editor.colorize(side.text.join('\n'), language, {})).split('<br/>');
  side.keys.forEach((at, index) =>
  {
    const html = lines[index];
    if (html !== undefined)
    {
      into.set(at, plainSpaces(html));
    }
  });
  return into;
}

const CHAR_AMPERSAND = '&';
const CHAR_LESS_THAN = '<';
const ENTITY_AMPERSAND = '&amp;';
const ENTITY_LESS_THAN = '&lt;';
const ENTITY_GREATER_THAN = '&gt;';

/** The HTML entity for one of `&`, `<`, `>`: the only characters `escapeHtml` ever sees. */
function htmlEntityFor(c: string): string
{
  switch (c)
  {
    case CHAR_AMPERSAND:
      return ENTITY_AMPERSAND;
    case CHAR_LESS_THAN:
      return ENTITY_LESS_THAN;
    default:
      return ENTITY_GREATER_THAN;
  }
}

function escapeHtml(text: string): string
{
  return text.replace(/[&<>]/g, htmlEntityFor);
}

/** The patch and path to colorize, or null when there is nothing colourable to show. */
function colourableTargetOf(
  patch: PatchFile | null | undefined,
  path: string | undefined
): { patch: PatchFile; path: string } | null
{
  if (patch && !patch.isBinary && path)
  {
    return { patch, path };
  }
  else
  {
    return null;
  }
}

/**
 * Colorizes `file` whenever it, `path` (for the language) or `theme` change, and hands
 * back a lookup from a row to its HTML: plain, escaped text before the colours arrive
 * or when there is nothing to colorize.
 */
export function useSyntaxColour(
  file: Ref<PatchFile | null | undefined>,
  path: Ref<string | undefined>,
  theme: Ref<'light' | 'dark'>
): { lineHtml: (hunk: number, line: number, text: string) => string }
{
  /** The colour for each row, keyed as the picked set is. Empty until it arrives. */
  const coloured = ref<Map<string, string>>(new Map());

  /**
   * One row's text as HTML: Monaco's spans once arrived, the plain escaped line before.
   * One call per row rather than a `v-if` and `v-html` of the same lookup, which built two keys and did two map reads per line on every redraw.
   */
  const lineHtml = (hunk: number, line: number, text: string): string =>
    coloured.value.get(lineKey(hunk, line)) ?? escapeHtml(text);

  /** Colorizing is async, so a fast walk down the list could land an old file's colours. */
  let latestColour = 0;

  watch(
    [file, path, theme],
    async ([patch, currentPath, currentTheme]) =>
    {
      const request = ++latestColour;
      // Cleared first: until the new colours arrive the rows draw as plain text, which is right. Holding the last file's spans would colour this file's lines by them.
      coloured.value = new Map();

      const target = colourableTargetOf(patch, currentPath);
      if (!target)
      {
        return;
      }
      const language = languageForPath(target.path);
      if (language === LANGUAGE_PLAINTEXT)
      {
        return;
      }

      // Before colorizing, not after: the spans carry class names, and the theme says what colour those classes are.
      applyMonacoTheme(currentTheme);

      const [before, after] = sidesOf(target.patch);
      const [beforeHtml, afterHtml] = await Promise.all([
        colourSide(before, language),
        colourSide(after, language)
      ]);

      // Written second: a context line is in both sides, and it should end on whichever tokenizer state ran through the lines above it on screen.
      const next = new Map(beforeHtml);
      for (const [at, html] of afterHtml)
      {
        next.set(at, html);
      }
      if (latestColour === request)
      {
        coloured.value = next;
      }
    },
    { immediate: true }
  );

  return { lineHtml };
}
