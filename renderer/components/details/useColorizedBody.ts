/**
 * Commit message body, highlighted as markdown. Uses Monaco's colorizer, not an editor:
 * no selection model conflict, and the body wraps in a flowing column. Safe: Monaco escapes it.
 */

import { ref, watch } from 'vue';
import * as monaco from '@renderer/monaco.js';
import { applyMonacoTheme } from '@renderer/monaco.js';

const LANGUAGE_MARKDOWN = 'markdown';

export interface ColorizedBodyOptions {
  body: () => string | undefined;
  theme: () => 'light' | 'dark';
}

/**
 * Replace Monaco's non-breaking spaces with regular spaces:
 * wrapping text is broken by non-breaking spaces, which don't matter in a `<pre>`.
 */
function breakable(html: string): string
{
  return html.replaceAll('\u00a0', ' ');
}

export function useColorizedBody(opts: ColorizedBodyOptions)
{
  const html = ref('');

  // Guard against stale async results (colorize is async and settings can change).
  let latestColorize = 0;

  watch(
    [opts.body, opts.theme],
    async ([body, theme]) =>
    {
      const request = ++latestColorize;
      if (!body)
      {
        html.value = '';
        return;
      }
      // Set theme before colorizing: spans carry class names, theme provides colors.
      applyMonacoTheme(theme);
      const colorized = await monaco.editor.colorize(body, LANGUAGE_MARKDOWN, {});
      if (latestColorize === request)
      {
        html.value = breakable(colorized);
      }
    },
    { immediate: true }
  );

  return { html };
}
