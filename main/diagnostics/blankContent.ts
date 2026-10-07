/**
 * Git output with the file contents taken out and the structure left in.
 *
 * A session log is carried off the machine it was written on, often from a work repository
 * to somewhere else entirely, so it must not carry source code. What it may carry is
 * everything about the *shape*: file names, refs, commit subjects, statuses, hunk ranges,
 * and which kind of line sat where. That is what the app's parsers read, so it is what a
 * repository rebuilt to reproduce a fault has to match.
 *
 * Pure: argv and text in, text out. Each verb that prints file contents names the rule
 * that blanks it in `RULES`; a verb not listed prints nothing but structure.
 */

/** A rule taking one command's output to its blanked form. */
type Blanker = (text: string) => string;

/** The mark a run of blanked lines is written with: its prefix, then how many there were. */
const RUN_MARK = '×';

/**
 * A run of content lines sharing one prefix, written as that prefix and a count.
 * `CRLF` is kept, since a line ending is shape rather than content and a parser can trip
 * on it.
 */
function runLine(prefix: string, count: number, crlf: boolean): string
{
  let line = `${prefix}${RUN_MARK}${count}`;
  if (crlf)
  {
    line += ' CRLF';
  }
  return line;
}

/**
 * Collapse every line `isContent` picks out into runs, by the prefix `prefixOf` gives it,
 * leaving every other line as it was.
 */
function collapseRuns(
  text: string,
  isContent: (line: string) => boolean,
  prefixOf: (line: string) => string
): string
{
  const out: string[] = [];
  let prefix: string | null = null;
  let count = 0;
  let crlf = false;
  const flush = (): void =>
  {
    if (prefix !== null)
    {
      out.push(runLine(prefix, count, crlf));
    }
    prefix = null;
    count = 0;
    crlf = false;
  };
  for (const line of text.split('\n'))
  {
    if (!isContent(line))
    {
      flush();
      out.push(line);
      continue;
    }
    const own = prefixOf(line);
    if (own !== prefix)
    {
      flush();
      prefix = own;
    }
    count++;
    crlf = crlf || line.endsWith('\r');
  }
  flush();
  return out.join('\n');
}

/**
 * A unified diff: headers and hunk ranges kept, each run of `+`, `-` or context lines
 * counted.
 *
 * Read by position, not by look: a line is content because it sits inside a hunk, never
 * because it resembles a header. A removed `-- comment` is `--- comment` in the patch,
 * which looks exactly like a file header and is a line of code. A hunk runs from its `@@`
 * to the first line that carries no `+`, `-` or space prefix: the next `diff`, the next
 * commit's header in `log -p`, or the end. A combined diff's `@@@` and its two-column
 * prefixes fall under the same rule.
 */
export function blankPatch(text: string): string
{
  let inHunk = false;
  const isContent = (line: string): boolean =>
  {
    if (line.startsWith('@@'))
    {
      inHunk = true;
      return false;
    }
    if (inHunk && line.length > 0 && '+- '.includes(line[0] ?? ''))
    {
      return true;
    }
    // `\ No newline at end of file` belongs to the hunk and is shape, not content.
    if (inHunk && line.startsWith('\\'))
    {
      return false;
    }
    inHunk = false;
    return false;
  };
  return collapseRuns(text, isContent, (line) => line[0] ?? '');
}

/** `blame --porcelain`: every header kept, the tab-led line of the file counted. */
function blankBlame(text: string): string
{
  return collapseRuns(text, (line) => line.startsWith('\t'), () => '\t');
}

/** `grep -z --line-number`: the path and line number kept, the matched text dropped. */
function blankGrep(text: string): string
{
  return text
    .split('\n')
    .map((line) =>
    {
      const fields = line.split('\x00');
      if (fields.length < 3)
      {
        return line;
      }
      return `${fields.slice(0, 2).join('\x00')}\x00<${(fields[2] ?? '').length} chars>`;
    })
    .join('\n');
}

/** A whole file: nothing but its size survives. */
function blankWhole(text: string): string
{
  return `<file contents: ${text.split('\n').length} lines, ${text.length} chars>`;
}

/** Whether `argv` names a blob by `<rev>:<path>`, which makes its output a file. */
function namesBlob(argv: readonly string[]): boolean
{
  return argv.some((arg) => !arg.startsWith('-') && arg.includes(':'));
}

function firstVerb(argv: readonly string[]): string | undefined
{
  return argv.find((arg) => !arg.startsWith('-'));
}

/** `show <rev>:<path>` prints a file; any other `show` prints a commit and its patch. */
function showRule(argv: readonly string[]): Blanker
{
  if (namesBlob(argv))
  {
    return blankWhole;
  }
  return blankPatch;
}

/** Which verbs print file contents, and how each one's output is blanked. */
const RULES = new Map<string, (argv: readonly string[]) => Blanker>(Object.entries({
  diff: () => blankPatch,
  'diff-tree': () => blankPatch,
  'diff-index': () => blankPatch,
  'diff-files': () => blankPatch,
  'format-patch': () => blankPatch,
  log: () => blankPatch,
  stash: () => blankPatch,
  show: showRule,
  'cat-file': () => blankWhole,
  blame: () => blankBlame,
  grep: () => blankGrep
}));

/** `text`, as `argv` printed it, with file contents taken out. */
export function blankOutput(argv: readonly string[], text: string): string
{
  const rule = RULES.get(firstVerb(argv) ?? '');
  if (!rule)
  {
    return text;
  }
  return rule(argv)(text);
}

/**
 * What was piped to `argv` on stdin, with file contents taken out. A patch to `apply`
 * is blanked like any patch; anything else (a commit message) carries no file contents.
 */
export function blankStdin(argv: readonly string[], text: string): string
{
  if (firstVerb(argv) === 'apply')
  {
    return blankPatch(text);
  }
  return text;
}
