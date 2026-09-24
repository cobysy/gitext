// @vitest-environment happy-dom
/**
 * How a read-only pane gives its editor a file.
 *
 * The rule under test is one Monaco does not enforce and does not report breaking on the
 * spot: a language worker takes a model on when the model is created, keyed by its URI.
 * A pane that keeps one model and tells it a different language per file hands the
 * TypeScript worker a file it never registered, and the first hover over it throws
 * `Could not find source file` from a web worker, where no caller can catch it. So the
 * contract is a model per file, at a URI of its own, and never `setModelLanguage`.
 *
 * Monaco is mocked rather than run: the real one wants a DOM with layout, and what is
 * being checked is which calls are made, not what they draw.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { enableAutoUnmount, mount } from '@vue/test-utils';

/** Everything the composable calls but this test has nothing to say about. */
function noop(): void
{
}

interface FakeModel {
  uri: string;
  setValue: (text: string) => void;
  dispose: () => void;
}

const created: { uri: string; language: string }[] = [];
const disposed: string[] = [];
const setModelLanguage = vi.fn();
let currentModel: FakeModel | null = null;
/**
 * Models Monaco is still holding, by URI. Kept because `monaco.editor.getModel` answering
 * from it is what lets a reuse-and-re-language pane reach `setModelLanguage` at all: a
 * mock that always answers "no such model" would make that test pass whatever the code did.
 */
const models = new Map<string, FakeModel>();

function fakeModel(uri: string): FakeModel
{
  const model: FakeModel = {
    uri,
    setValue: noop,
    dispose: () =>
    {
      disposed.push(uri);
      models.delete(uri);
    }
  };
  models.set(uri, model);
  return model;
}

vi.mock('@renderer/monaco.js', () => ({
  Uri: { parse: (value: string) => ({ toString: () => value, value }) },
  editor: {
    create: () => ({
      getModel: () => currentModel,
      setModel: (model: FakeModel | null) =>
      {
        currentModel = model;
      },
      createModel: undefined,
      updateOptions: noop,
      setScrollPosition: noop,
      layout: noop,
      dispose: noop,
      onDidScrollChange: noop,
      onDidChangeHiddenAreas: noop,
      onDidContentSizeChange: noop,
      // The collection the pane marks lines through: it holds one from the moment the
      // editor exists, so a mock without this never gets as far as showing a file.
      createDecorationsCollection: () => ({ set: noop })
    }),
    createModel: (_text: string, language: string, uri: { value: string }) =>
    {
      created.push({ uri: uri.value, language });
      return fakeModel(uri.value);
    },
    getModel: (uri: { value: string }) => models.get(uri.value) ?? null,
    setModelLanguage
  },
  applyMonacoTheme: noop,
  monacoThemeName: () => 'vs'
}));

const { useReadOnlyEditor } = await import('@renderer/components/diff/useReadOnlyEditor.js');

type PaneContent = { text: string; language: string } | null;

/** A component that is nothing but the composable and the element it mounts into. */
function paneShowing(content: ReturnType<typeof ref<PaneContent>>)
{
  return defineComponent({
    setup()
    {
      const host = ref<HTMLElement | null>(null);
      useReadOnlyEditor({
        host,
        effectiveTheme: () => 'light',
        content: () => content.value ?? null,
        uriTag: 'blame'
      });
      return () => h('div', { ref: host });
    }
  });
}

/**
 * A pane that shows nothing, then a Markdown file, then a TypeScript one.
 *
 * It starts from nothing because that is how the real panes start: the editor is built on
 * mount and the content arrives from git afterwards, so the composable's first look at
 * the content is always at a pane with no file in it yet.
 */
async function showTwoFiles(): Promise<void>
{
  const content = ref<PaneContent>(null);
  mount(paneShowing(content));
  // One at a time: a watcher batches, so two assignments in a tick are one file arriving.
  content.value = { text: '# notes', language: 'markdown' };
  await nextTick();
  content.value = { text: 'const a = 1;', language: 'typescript' };
  await nextTick();
}

enableAutoUnmount(afterEach);

beforeEach(() =>
{
  created.length = 0;
  disposed.length = 0;
  models.clear();
  currentModel = null;
  setModelLanguage.mockClear();
  // `useReadOnlyEditor` observes its host, and happy-dom has no ResizeObserver.
  vi.stubGlobal(
    'ResizeObserver',
    class
    {
      observe = noop;
      disconnect = noop;
    }
  );
});

describe('a read-only pane showing one file after another', () =>
{
  it('builds a model per file, each at a URI of its own', async () =>
  {
    await showTwoFiles();

    expect(created).toEqual([
      { uri: 'gitext://blame/1', language: 'markdown' },
      { uri: 'gitext://blame/2', language: 'typescript' }
    ]);
  });

  it('never re-languages a model it already handed to a worker', async () =>
  {
    await showTwoFiles();

    expect(setModelLanguage).not.toHaveBeenCalled();
  });

  it('lets go of the model it replaced, so a pane does not accumulate them', async () =>
  {
    await showTwoFiles();

    expect(disposed).toEqual(['gitext://blame/1']);
  });

  it('lets go of the last one when there is nothing to show', async () =>
  {
    const content = ref<PaneContent>(null);
    mount(paneShowing(content));
    content.value = { text: '# notes', language: 'markdown' };
    await nextTick();

    content.value = null;
    await nextTick();

    expect(disposed).toEqual(['gitext://blame/1']);
    expect(currentModel).toBeNull();
  });
});
