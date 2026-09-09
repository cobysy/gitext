// Monaco configured: make workers reachable, tell TypeScript to not analyze (no project context in diffs).
// Every language must be imported; trimming silently breaks JSON highlighting.
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import { THEME_DARK } from '@shared/types.js';

/** Keyed by the labels monaco passes to `getWorker`; anything else is the editor's own. */
const workerByLabel: Record<string, new () => Worker> = {
  json: JsonWorker,
  css: CssWorker,
  scss: CssWorker,
  less: CssWorker,
  html: HtmlWorker,
  handlebars: HtmlWorker,
  razor: HtmlWorker,
  typescript: TsWorker,
  javascript: TsWorker
};

declare global
{
  interface Window {
    MonacoEnvironment?: monaco.Environment;
    monaco?: typeof monaco;
  }
}

// Monaco on `window`, the way its own AMD build has always put it there.
//
// Nothing in the app reads it: every module imports this one. It is here for the
// outside: `e2e/commit-screen.spec.ts` drives the commit message box, and a Monaco
// editor has no DOM to drive. Its textarea is one character wide and holds nothing, and
// the text it renders is only the lines currently on screen. The model is the value, and
// this is how a script gets to it.
self.monaco = monaco;

self.MonacoEnvironment = {
  getWorker: (_workerId, label) => new (workerByLabel[label] ?? EditorWorker)()
};

for (const defaults of [
  monaco.languages.typescript.typescriptDefaults,
  monaco.languages.typescript.javascriptDefaults
])
{
  defaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: true,
    noSuggestionDiagnostics: true
  });
}

/**
 * Put monaco on our theme. Call it before creating an editor, and before colorizing.
 *
 * The theme is global to monaco, not a property of an editor, and it is what defines the
 * `.mtk*` classes everything monaco draws is coloured by: including the HTML
 * `editor.colorize` hands back with no editor involved at all. The commit details pane
 * colorizes a message that way, and without this its spans would come out carrying
 * whichever theme the last editor to be created happened to set: unstyled, or light
 * against a dark pane.
 */
const MONACO_THEME_DARK = 'vs-dark';
const MONACO_THEME_LIGHT = 'vs';

/** The monaco theme name for one of this app's two themes: what `theme:` on editor
 *  creation options wants, and what `applyMonacoTheme` sets on the running instance. */
export function monacoThemeName(theme: 'light' | 'dark'): string
{
  if (theme === THEME_DARK)
  {
    return MONACO_THEME_DARK;
  }
  else
  {
    return MONACO_THEME_LIGHT;
  }
}

export function applyMonacoTheme(theme: 'light' | 'dark'): void
{
  monaco.editor.setTheme(monacoThemeName(theme));
}

export * from 'monaco-editor';
