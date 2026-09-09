/**
 * Two Monaco diff editors, stacked, so a file change never shows Monaco's own working.
 * A single editor can't change file without showing it: `setModel` swaps the pair at
 * once, but Monaco computes the difference *asynchronously*, so for ~100ms the pane
 * would draw unaligned, untinted lines carrying the previous file's decorations.
 *
 * So the new pair goes into the editor not on screen, computes there, and the two
 * swap places once it's done. Pulled out of `DiffViewer.vue`: how the pane crossfades
 * is one reason to change, independent of the header/menu it still owns.
 */

import { nextTick, onMounted, onUnmounted, ref, watch, type Ref } from 'vue';
import * as monaco from '@renderer/monaco.js';
import { type PatchFile } from '@renderer/model/patch.js';
import { languageForPath } from '@renderer/monacoLang.js';
import { applyLineNumbers, sidesOf } from './patchToModels.js';

/** The two fields `present` needs off the store's patch; the rest is the caller's business. */
export interface DiffPatchHeader {
  path: string;
  truncated: boolean;
}

export interface DiffEditorPanesOptions {
  /** The elements the two editors mount into: the template's, so it owns its own refs. */
  hostA: Ref<HTMLElement | null>;
  hostB: Ref<HTMLElement | null>;
  sideBySide: () => boolean;
  ignoreWhitespace: () => boolean;
  effectiveTheme: () => 'light' | 'dark';
  applyTheme: (theme: 'light' | 'dark') => void;
  /** The store's current patch header, or null when nothing is selected. */
  patch: () => DiffPatchHeader | null;
  /** The same patch, parsed: read separately because it can legitimately lag `patch`. */
  parsedFile: () => PatchFile | null;
}

/**
 * How long to wait for Monaco's diff before showing the back editor anyway: a floor
 * under a pathological file, since waiting forever on a lost event would freeze the pane.
 */
const DIFF_READY_TIMEOUT = 600;

const SIDE_ORIGINAL = 'original';
const SIDE_MODIFIED = 'modified';
const MONACO_DIFF_ALGORITHM_ADVANCED = 'advanced';

export function useDiffEditorPanes(opts: DiffEditorPanesOptions)
{
  const { hostA, hostB } = opts;

  /** An editor and the element it lives in, kept together so the two cannot fall out of step. */
  interface Pane {
    host: Ref<HTMLElement | null>;
    editor: monaco.editor.IStandaloneDiffEditor | null;
  }

  const panes: [Pane, Pane] = [
    { host: hostA, editor: null },
    { host: hostB, editor: null }
  ];

  /** Which of the two is on screen. The other one is where the next file is built. */
  const front = ref(0);

  /** Either pane, without an index assertion at every use. There are only ever the two. */
  const paneAt = (index: number): Pane =>
  {
    if (index === 0)
    {
      return panes[0];
    }
    else
    {
      return panes[1];
    }
  };

  let resizeObserver: ResizeObserver | null = null;

  /** Size one to its container: flex layout settles after mount, and after a model. */
  function layoutPane(pane: Pane): void
  {
    const el = pane.host.value;
    if (el && pane.editor)
    {
      pane.editor.layout({ width: el.clientWidth, height: el.clientHeight });
    }
  }

  /** Both, for the observer: the pair is one box, and the hidden one must be sized too. */
  function relayout(): void
  {
    for (const pane of panes)
    {
      layoutPane(pane);
    }
  }

  /**
   * Put a new pair of models in, and only then let go of the pair that was there.
   * Disposing *after* the swap is safe precisely because the editor has already let go
   * of them; before, Monaco throws "TextModel disposed before DiffEditorWidget model got
   * reset". `setValue` on one long-lived pair is the tempting alternative, and worse:
   * Monaco debounces content-change recomputation to ~300ms instead of ~100ms.
   *
   * Answers with the modified side's URI, which is how `diffReady` tells this pair's
   * "I have computed the diff" from the previous pair's, still in flight.
   */
  function swapModels(
    editor: monaco.editor.IStandaloneDiffEditor,
    stamp: number,
    text: { original: string; modified: string },
    path: string,
    language: string
  ): string
  {
    // The build's serial number in the URI, so a new pair can exist before the old is
    // gone, including on a reload of the same path.
    const uri = (side: string) =>
      monaco.Uri.parse(`gitext://diff/${stamp}/${side}/${encodeURIComponent(path)}`);

    const modifiedUri = uri(SIDE_MODIFIED);
    const previous = editor.getModel();
    editor.setModel({
      original: monaco.editor.createModel(text.original, language, uri(SIDE_ORIGINAL)),
      modified: monaco.editor.createModel(text.modified, language, modifiedUri)
    });
    previous?.original.dispose();
    previous?.modified.dispose();
    return modifiedUri.toString();
  }

  /** Let go of one editor's models for good: teardown, a swap's far side, and "nothing is selected". */
  function clearModels(editor: monaco.editor.IStandaloneDiffEditor | null): void
  {
    if (!editor)
    {
      return;
    }
    const previous = editor.getModel();
    editor.setModel(null);
    previous?.original.dispose();
    previous?.modified.dispose();
  }

  /** Settle when this pair's difference is drawn, or when the wait has gone on too long. */
  function diffReady(editor: monaco.editor.IStandaloneDiffEditor, modifiedUri: string): Promise<void>
  {
    return new Promise((resolve) =>
    {
      let settled = false;
      const finish = (): void =>
      {
        if (settled)
        {
          return;
        }
        settled = true;
        subscription.dispose();
        clearTimeout(timer);
        resolve();
      };
      const subscription = editor.onDidUpdateDiff(() =>
      {
        // The pair that was in there a moment ago can still report; that update is not this
        // one's, and acting on it would show the new file before it had been aligned.
        if (editor.getModel()?.modified.uri.toString() === modifiedUri)
        {
          finish();
        }
      });
      const timer = setTimeout(finish, DIFF_READY_TIMEOUT);
    });
  }

  function createEditors(): void
  {
    for (const pane of panes)
    {
      if (!pane.host.value)
      {
        continue;
      }
      pane.editor = monaco.editor.createDiffEditor(pane.host.value, {
        readOnly: true,
        renderSideBySide: opts.sideBySide(),
        useInlineViewWhenSpaceIsLimited: false,
        originalEditable: false,
        renderLineHighlight: 'none',
        scrollBeyondLastLine: false,
        wordWrap: 'off',
        minimap: { enabled: false },
        renderOverviewRuler: true,
        overviewRulerBorder: false,
        fontSize: 12,
        lineHeight: 18,
        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
        diffAlgorithm: MONACO_DIFF_ALGORITHM_ADVANCED,
        ignoreTrimWhitespace: opts.ignoreWhitespace(),
        padding: { top: 4, bottom: 4 },
        stickyScroll: { enabled: false }
      });
    }
    opts.applyTheme(opts.effectiveTheme());

    // One observer on the pair's container: they are the same size as each other always,
    // and the back one must be sized or it would compute its diff against no width.
    resizeObserver = new ResizeObserver(relayout);
    if (hostA.value?.parentElement)
    {
      resizeObserver.observe(hostA.value.parentElement);
    }
  }

  function destroyEditors(): void
  {
    resizeObserver?.disconnect();
    resizeObserver = null;
    for (const pane of panes)
    {
      clearModels(pane.editor);
      pane.editor?.dispose();
      pane.editor = null;
    }
  }

  /** Both, always: the one behind is about to be the one in front. */
  function updateBoth(options: monaco.editor.IDiffEditorOptions): void
  {
    for (const pane of panes)
    {
      pane.editor?.updateOptions(options);
    }
  }

  /**
   * The patch the front editor is drawing, not the store's latest while a build runs
   * behind it: everything the pane says (name, stats, truncation) reads this, since the
   * body can only ever be the diff drawn.
   */
  const shown = ref<{ path: string; truncated: boolean; parsed: PatchFile | null } | null>(null);

  /**
   * Build the patch in the editor not on screen, and swap once it's drawn. Same guard
   * as the store's reads: an arrow-key walk starts a new build before the last finishes,
   * and only the newest may take the front.
   */
  let buildSeq = 0;

  async function present(patch: DiffPatchHeader): Promise<void>
  {
    const seq = ++buildSeq;
    const at = 1 - front.value;
    const pane = paneAt(at);
    const back = pane.editor;
    if (!back)
    {
      return;
    }

    const parsed = opts.parsedFile();
    const { original, modified } = sidesOf(parsed);

    // Numbers before the models, not after: applied afterwards they leave a frame in which
    // the new file's lines are drawn against the old file's numbering.
    applyLineNumbers(back.getOriginalEditor(), original.numbers);
    applyLineNumbers(back.getModifiedEditor(), modified.numbers);

    const modifiedUri = swapModels(
      back,
      seq,
      { original: original.text, modified: modified.text },
      patch.path,
      languageForPath(patch.path)
    );

    // Before the wait: an editor with no width computes its diff against nothing. This
    // one only: the front editor is already the right size.
    layoutPane(pane);

    await diffReady(back, modifiedUri);
    if (seq !== buildSeq)
    {
      return;
    }

    // Captured before the flip, released after it: the models the leaving editor holds are
    // still on screen until the front has actually changed.
    const leaving = paneAt(front.value).editor;

    // The name, the stats and the binary note change in the same tick as the lines they
    // describe: see `shown`.
    shown.value = { path: patch.path, truncated: patch.truncated, parsed };
    front.value = at;
    await nextTick();

    // Nothing is kept behind: that editor is where the *next* file builds. No relayout
    // after this: the panes are stacked and hidden by opacity.
    clearModels(leaving);
  }

  onMounted(() =>
  {
    createEditors();
    // The patch watcher below is `immediate`, and setup runs before mount: so on a pane
    // that opens with a file already selected, that first run found no editors to build in.
    const patch = opts.patch();
    if (patch)
    {
      void present(patch);
    }
  });
  onUnmounted(destroyEditors);

  watch(() => opts.sideBySide(), (sbs) => updateBoth({ renderSideBySide: sbs }));
  watch(() => opts.ignoreWhitespace(), (v) => updateBoth({ ignoreTrimWhitespace: v }));

  watch(
    () => opts.patch(),
    (patch) =>
    {
      if (!patch)
      {
        buildSeq++;
        shown.value = null;
        for (const pane of panes)
        {
          clearModels(pane.editor);
        }
        return;
      }
      void present(patch);
    },
    { immediate: true }
  );

  /** The editor currently on screen: the one difference navigation should act on. */
  const frontEditor = (): monaco.editor.IStandaloneDiffEditor | null => paneAt(front.value).editor;

  return { front, shown, frontEditor };
}
