/**
 * Searching file *contents*, `git grep`, and the argv that asks for it. Sibling of
 * `shared/diff.ts`, here for the same reason: the renderer previews this argv and
 * `main/git/grep.ts` runs it, so the builder must be importable by both. A search
 * answers as *structured hits*, not text to show, so it needs a typed channel, and a
 * typed channel means main builds the argv, not the caller.
 *
 * Pure, importing only the endpoint type: the flag table below is the whole of the
 * subtlety, so it's an ordinary unit test rather than reachable only by typing into a window.
 */

import { ENDPOINT_KIND_COMMIT, ENDPOINT_KIND_INDEX, type DiffEndpoint } from './diff.js';

/**
 * Which grammar the pattern is written in: git's four, all worth having. Fixed is a
 * literal match, basic is git's own default, extended is what most people mean by
 * "regex", Perl is the only one with lookahead and `\d`.
 */
export type GrepMode = 'fixed' | 'basic' | 'extended' | 'perl';

const MODE_FIXED = 'fixed';
const MODE_BASIC = 'basic';
const MODE_EXTENDED = 'extended';
const MODE_PERL = 'perl';

const FLAG_FIXED = '-F';
const FLAG_BASIC = '-G';
const FLAG_EXTENDED = '-E';
const FLAG_PERL = '-P';


/**
 * The modes, their flags and how to say what they are: one table, read by both the
 * builder and the dialog's `<select>`. `-G` is git's default and still passed
 * explicitly, so the preview names the grammar rather than hiding a decision nobody made.
 */
export const GREP_MODES: readonly {
  mode: GrepMode;
  flag: string;
  label: string;
  detail: string;
}[] = [
  {
    mode: MODE_FIXED,
    flag: FLAG_FIXED,
    label: 'Plain text',
    detail: '`-F`, the pattern means itself; no character is special'
  },
  {
    mode: MODE_BASIC,
    flag: FLAG_BASIC,
    label: 'Basic regular expression',
    detail: "`-G`, git's default: POSIX basic, where + and ? are literal"
  },
  {
    mode: MODE_EXTENDED,
    flag: FLAG_EXTENDED,
    label: 'Extended regular expression',
    detail: '`-E`, POSIX extended.'
  },
  {
    mode: MODE_PERL,
    flag: FLAG_PERL,
    label: 'Perl regular expression',
    detail: '`-P`, PCRE. Needs a git built with it.'
  }
];

const FLAG_FOR = new Map(GREP_MODES.map((entry) => [entry.mode, entry.flag]));

export interface GrepOptions {
  /** What to look for. Never empty: the dialog's button is disabled until it is not. */
  pattern: string;
  mode: GrepMode;
  /** `-i`. Off means git's own behaviour, which is case-sensitive. */
  ignoreCase: boolean;
  /** `-w`: the match must be a whole word, not part of a longer identifier. */
  wholeWord: boolean;
  /**
   * Where to look: a commit, the index, or the working tree. The same three endpoints
   * the diff pivot has, and for once git spells all three natively, so this is a
   * `DiffEndpoint` rather than an optional SHA.
   */
  endpoint: DiffEndpoint;
  /** Pathspecs to limit the search to. Empty means the whole repository. */
  paths?: readonly string[];
}

/** One matching line. */
export interface GrepHit {
  /** Repository-relative, as git printed it. */
  path: string;
  /** 1-based, as `-n` reports it. */
  line: number;
  /** The whole line, not the matched span: git reports no columns. */
  text: string;
}

export interface GrepResult {
  hits: readonly GrepHit[];
  /**
   * Whether the cap was reached and matches were left unread: a search for `e` over a
   * large repository is millions of lines, and a truncated result presented as complete is the one failure a search must not have.
   */
  truncated: boolean;
}

/** How many hits are read before `truncated` is set. */
export const GREP_HIT_LIMIT = 5000;

/**
 * The argv for one search. `-z` puts a NUL after path and line number, since either
 * can contain anything; `-I` skips binary files, which otherwise report "Binary file …
 * matches" with no line to show. `-e` before the pattern isn't optional: without it a
 * pattern starting with `-` reads as options, and `--` is already taken by the pathspecs.
 */
export function buildGrepArgs(options: GrepOptions): string[]
{
  const args = ['grep', '--line-number', '-z', '-I'];

  if (options.ignoreCase)
  {
    args.push('-i');
  }
  if (options.wholeWord)
  {
    args.push('-w');
  }
  args.push(FLAG_FOR.get(options.mode) ?? FLAG_BASIC);

  args.push('-e', options.pattern);

  // The endpoint, in git's own three spellings. A commit is a bare revision argument, the
  // index is `--cached`, and the working tree is the absence of both.
  switch (options.endpoint.kind)
  {
    case ENDPOINT_KIND_COMMIT:
      args.push(options.endpoint.sha);
      break;
    case ENDPOINT_KIND_INDEX:
      args.push('--cached');
      break;
    default:
      break;
  }

  const paths = (options.paths ?? []).map((path) => path.trim()).filter(Boolean);
  if (paths.length > 0)
  {
    args.push('--', ...paths);
  }

  return args;
}

/**
 * The prefix git puts before each path when the search names a revision:
 * `HEAD:main/git/log.ts`. Stripped here, not in the parser, since this is the one place that knows how it was built.
 */
export function grepPathPrefix(endpoint: DiffEndpoint): string
{
  if (endpoint.kind === ENDPOINT_KIND_COMMIT)
  {
    return `${endpoint.sha}:`;
  }
  else
  {
    return '';
  }
}
