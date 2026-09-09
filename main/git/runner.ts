/**
 * The only place in the app that spawns a process. Every git invocation funnels
 * through here, which is what makes the command log (§8) complete without any call
 * site opting in. `runner/commandLog.ts` holds the recording, `runner/format.ts` an
 * argv's display string, `runner/readRetry.ts` which read failures are worth retrying,
 * and `runner/gitError.ts` the shared error shape.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  GIT_KIND_READ,
  GIT_KIND_WRITE,
  type GitCommandKind,
  type GitCommandRecord
} from '@shared/types.js';
import { nextRecordId, pushRecord, republish } from './runner/commandLog.js';
import { GitError } from './runner/gitError.js';
import { collapseOverwrites, sanitizePtyChunk, terminalLine } from './runner/ptyOutput.js';
import { CappedOutput } from './runner/recordOutput.js';
import { withReadRetry, withStreamRetry } from './runner/readRetry.js';

export { runnerEvents, setCommandLogDepth, getCommandLog, clearCommandLog } from './runner/commandLog.js';
export { formatCommand } from './runner/format.js';
export { GitError } from './runner/gitError.js';
export { GIT_KIND_READ, GIT_KIND_WRITE };

/** Config injected into every invocation so output is stable and machine-readable. */
const GLOBAL_CONFIG = [
  '-c',
  'core.quotepath=false', // emit UTF-8 paths literally, not \NNN escapes
  '-c',
  'color.ui=false' // never emit ANSI colour codes into our parsers
];

/**
 * Commands that only read: `GIT_OPTIONAL_LOCKS=0` so background refreshes never take
 * `index.lock` against a user-initiated write, and the command log's "hide reads" filter
 * uses the same answer.
 *
 * **A default, not a decision.** `branch`, `stash`, `config`, `reflog` read or write
 * depending on their flags, and no verb list can tell `branch --list` from `branch -d`:
 * `git:run` carries an explicit `kind` from the renderer's declared facets, and the few
 * ambiguous `main/git/*` calls pass `kind` themselves.
 */
const READ_ONLY_VERBS = new Set([
  'blame',
  'branch',
  'cat-file',
  'config',
  'describe',
  'diff',
  'diff-tree',
  'for-each-ref',
  'grep',
  'log',
  'ls-files',
  'ls-remote',
  'ls-tree',
  'merge-base',
  'name-rev',
  'reflog',
  'rev-list',
  'rev-parse',
  'show',
  'show-ref',
  'status',
  'stash',
  'symbolic-ref',
  'var',
  'version'
]);

/**
 * Verbs with no flag of their own to force progress reporting off a terminal (unlike
 * `fetch`/`push`/`pull`/`prune`/`checkout`/`fsck`, which all take `--progress`): `gc`
 * only exposes `-q` to suppress it, never a way to force it. A streaming run of one of
 * these is spawned inside a pty instead, so git believes it's talking to a terminal
 * and prints what it would otherwise stay silent about.
 */
const PTY_FORCED_VERBS = new Set(['gc']);

const SCRIPT_BIN = '/usr/bin/script';

function firstVerb(argv: string[]): string | undefined
{
  return argv.find((a) => !a.startsWith('-'));
}

/** Cached: `existsSync` on every streamed `gc` would be wasteful, and the answer never changes mid-run. */
let ptyAvailableCache: boolean | undefined;

function ptyAvailable(): boolean
{
  if (ptyAvailableCache === undefined)
  {
    ptyAvailableCache = process.platform === 'darwin' && existsSync(SCRIPT_BIN);
  }
  return ptyAvailableCache;
}

export interface RunOptions {
  /**
   * Override the read/write classification. `stash` is the motivating case: it is
   * mostly a write verb but `stash list` is a read.
   */
  kind?: GitCommandKind;
  /** Text piped to the process on stdin (used for `apply`, `commit -F -`, etc.). */
  stdin?: string;
  /** Resolve with stdout even on a non-zero exit instead of rejecting. */
  allowFailure?: boolean;
  /**
   * The caller treats a non-zero exit as an answer, not a fault, so the command log should
   * not count it as a failure. Set by `tryGit`, which exists for exactly that.
   */
  optional?: boolean;
  /**
   * Collect stdout as bytes instead of decoding as UTF-8. Internal: set by
   * `runGitBuffer` only, since a blob decoded and re-encoded (an image from `git show`) comes back corrupted.
   */
  onBinary?: (chunk: Buffer) => void;
}

/**
 * How often a running command's output reaches the command log. Slower than the 50ms
 * the output streams use: this republishes the whole record rather than a batch of new
 * lines, and the panel is read rather than followed line by line.
 */
const LIVE_OUTPUT_INTERVAL_MS = 100;

const NO_OP_EDITOR = 'true';
export const ENCODING_UTF8 = 'utf8';

let gitPath = 'git';

export function setGitPath(path: string): void
{
  gitPath = path;
}

export function getGitPath(): string
{
  return gitPath;
}

function classify(argv: string[], override?: GitCommandKind): GitCommandKind
{
  if (override)
  {
    return override;
  }
  const verb = firstVerb(argv);
  if (verb && READ_ONLY_VERBS.has(verb))
  {
    return GIT_KIND_READ;
  }
  else
  {
    return GIT_KIND_WRITE;
  }
}

/**
 * Spawn git and collect a complete record of the invocation. `onLine` (when given)
 * receives interleaved stdout/stderr lines as they arrive, for streaming progress to the UI.
 *
 * `done` resolves with the record *and* the complete stdout, capped vs. uncapped: the
 * full text is accumulated only for a caller with no other way to see it, since a
 * streaming caller has already been given every chunk.
 */
function execute(
  argv: string[],
  cwd: string,
  options: RunOptions,
  onLine?: (line: string, isError: boolean) => void,
  onChunk?: (chunk: string) => void,
  onPartial?: (line: string) => void
): {
  record: GitCommandRecord;
  done: Promise<{ record: GitCommandRecord; stdout: string }>;
  cancel: () => void;
}
{
  const streaming = onLine !== undefined || onChunk !== undefined || options.onBinary !== undefined;
  const fullArgv = [...GLOBAL_CONFIG, ...argv];
  const kind = classify(argv, options.kind);
  const verb = firstVerb(argv);
  // `options.stdin === undefined` too: `script`'s own stdin has to be `/dev/null` (see
  // below), which only works for a verb that never reads stdin. Every current member of
  // `PTY_FORCED_VERBS` qualifies; this just keeps a future one honest.
  const usingPty =
    streaming &&
    !!verb &&
    PTY_FORCED_VERBS.has(verb) &&
    options.stdin === undefined &&
    ptyAvailable();

  const record: GitCommandRecord = {
    id: nextRecordId(),
    argv,
    fullArgv,
    cwd,
    kind,
    startedAt: Date.now(),
    durationMs: 0,
    exitCode: null,
    stdout: '',
    stderr: '',
    running: true
  };
  if (options.optional === true)
  {
    record.optional = true;
  }

  pushRecord(record);

  // A read never takes `index.lock`, so background polling can't fight a user-initiated write.
  let readOnlyEnv: { GIT_OPTIONAL_LOCKS?: string };
  if (kind === GIT_KIND_READ)
  {
    readOnlyEnv = { GIT_OPTIONAL_LOCKS: '0' };
  }
  else
  {
    readOnlyEnv = {};
  }

  // `record.argv`/`record.fullArgv` above are always the plain git invocation: what's
  // spawned here is an implementation detail of getting output out of git, not part of
  // what ran, so the preview and the command log never mention `script`.
  let spawnPath = gitPath;
  let spawnArgs = fullArgv;
  if (usingPty)
  {
    spawnArgs = ['-q', '/dev/null', gitPath, ...fullArgv];
    spawnPath = SCRIPT_BIN;
  }

  // `script` reads its own stdin's attributes to shape the pty it opens, and a plain
  // pipe reports itself as a socket, which it treats as fatal rather than falling back
  // to defaults (confirmed against the real binary: piped stdin fails with "tcgetattr/
  // ioctl: Operation not supported on socket", `/dev/null` doesn't). `usingPty` already
  // guarantees this verb takes no stdin, so there's nothing lost by not piping it.
  let stdio: 'pipe' | ['ignore', 'pipe', 'pipe'] = 'pipe';
  if (usingPty)
  {
    stdio = ['ignore', 'pipe', 'pipe'];
  }

  const child = spawn(spawnPath, spawnArgs, {
    cwd,
    // Never a shell: argv is passed through verbatim, so no quoting rules apply.
    shell: false,
    stdio,
    env: {
      ...process.env,
      ...readOnlyEnv,
      // Fail fast instead of blocking on an interactive credential prompt.
      GIT_TERMINAL_PROMPT: '0',
      // No git command run from this app may open an editor: there's no terminal
      // attached, so `$EDITOR` would leave the spawn waiting forever. `true` accepts
      // whatever git generated (a merge message the dialog already wrote); the dialogs
      // pass `--no-edit` where they can, this is the backstop for `rebase -i` and the rest.
      GIT_EDITOR: NO_OP_EDITOR,
      GIT_SEQUENCE_EDITOR: NO_OP_EDITOR,
      LC_ALL: 'C.UTF-8'
    }
  });

  const done = new Promise<{ record: GitCommandRecord; stdout: string }>((resolve, reject) =>
  {
    let stdoutRest = '';
    let stderrRest = '';
    let sawFirstStdoutChunk = false;
    let sawFirstStderrChunk = false;
    const keptOut = new CappedOutput();
    const keptErr = new CappedOutput();
    /** Empty for a streaming caller: see `execute`'s comment. */
    let fullStdout = '';

    /**
     * The one place git's bytes become lines. Both readers take what it produces: the
     * record `kept` builds, and the streaming caller's `onLine`. Splitting twice is how
     * a console window and a command log end up disagreeing about what a command said.
     *
     * Returns the unfinished tail, which the next chunk continues or overwrites.
     */
    const pump = (chunk: string, isError: boolean, rest: string, kept: CappedOutput): string =>
    {
      const text = rest + chunk;
      const lines = text.split('\n');
      // The final element is an incomplete line; hold it until more arrives.
      const tail = lines.pop() ?? '';
      for (const line of lines)
      {
        const shown = terminalLine(line);
        kept.addLine(shown);
        onLine?.(shown, isError);
      }
      // The line still being written, reported as it changes rather than held until it
      // ends: `push --progress` spends a whole phase rewriting one line with no newline
      // in it, so waiting for the newline is waiting for the phase to be over.
      const writing = collapseOverwrites(tail);
      kept.setPartial(writing);
      if (tail)
      {
        onPartial?.(writing);
      }
      return tail;
    };

    /** Fold what was kept into the record, just before it is published or rejected on. */
    const settleOutput = (): void =>
    {
      // The binary path writes its own summary into `record.stdout` and keeps no text.
      if (!options.onBinary)
      {
        record.stdout = keptOut.kept;
        record.stdoutBytes = keptOut.cutFrom;
      }
      record.stderr = keptErr.kept;
      record.stderrBytes = keptErr.cutFrom;
    };

    let liveTimer: NodeJS.Timeout | null = null;
    let publishedAt = 0;

    /**
     * Put what git has said so far into the command log, without waiting for it to
     * exit. Otherwise a `fetch` says nothing for as long as it takes and then arrives
     * complete in one go, which is not what watching a command run looks like.
     */
    const publishLive = (): void =>
    {
      if (liveTimer)
      {
        clearTimeout(liveTimer);
        liveTimer = null;
      }
      publishedAt = Date.now();
      settleOutput();
      republish(record);
    };

    /**
     * The first chunk goes out at once, so output appears the moment there is any;
     * after that, at most one publish per interval. A progress meter rewrites its line
     * far faster than anyone can read, and each publish is a record broadcast to every
     * open window.
     */
    const publishSoon = (): void =>
    {
      const since = Date.now() - publishedAt;
      if (since >= LIVE_OUTPUT_INTERVAL_MS)
      {
        publishLive();
        return;
      }
      liveTimer ??= setTimeout(publishLive, LIVE_OUTPUT_INTERVAL_MS - since);
    };

    /** Nothing more will be published live: the run is settling on its own record. */
    const stopLive = (): void =>
    {
      if (liveTimer)
      {
        clearTimeout(liveTimer);
        liveTimer = null;
      }
    };

    // stderr is always text: git writes messages there, never blobs.
    child.stderr?.setEncoding(ENCODING_UTF8);

    if (options.onBinary)
    {
      let bytes = 0;
      child.stdout?.on('data', (chunk: Buffer) =>
      {
        bytes += chunk.length;
        options.onBinary?.(chunk);
        // The log records how much came back, not what: a blob held in the 500-entry ring buffer would sit there for the rest of the session.
        record.stdout = `<${bytes} bytes>`;
      });
    }
    else
    {
      child.stdout?.setEncoding(ENCODING_UTF8);
      child.stdout?.on('data', (raw: string) =>
      {
        // `script` merges git's stdout and stderr onto the one pty it hands back, and
        // echoes the stdin-EOF keystroke once at the start: both cleaned up here so
        // nothing downstream needs to know a pty was ever involved.
        let chunk = raw;
        if (usingPty)
        {
          chunk = sanitizePtyChunk(raw, !sawFirstStdoutChunk);
        }
        sawFirstStdoutChunk = true;
        if (!streaming)
        {
          fullStdout += chunk;
        }
        stdoutRest = pump(chunk, false, stdoutRest, keptOut);
        publishSoon();
        onChunk?.(chunk);
      });
    }

    child.stderr?.on('data', (raw: string) =>
    {
      let chunk = raw;
      if (usingPty)
      {
        chunk = sanitizePtyChunk(raw, !sawFirstStderrChunk);
      }
      sawFirstStderrChunk = true;
      stderrRest = pump(chunk, true, stderrRest, keptErr);
      publishSoon();
    });

    child.on('error', (err) =>
    {
      stopLive();
      record.running = false;
      record.durationMs = Date.now() - record.startedAt;
      record.spawnError = err.message;
      settleOutput();
      republish(record);
      reject(new GitError(argv, cwd, null, err.message));
    });

    child.on('close', (code) =>
    {
      stopLive();
      // The last line, if git ended without a newline after it: through the same rule
      // every other line went through.
      if (onLine)
      {
        if (stdoutRest)
        {
          onLine(terminalLine(stdoutRest), false);
        }
        if (stderrRest)
        {
          onLine(terminalLine(stderrRest), true);
        }
      }
      record.running = false;
      record.exitCode = code;
      record.durationMs = Date.now() - record.startedAt;
      settleOutput();
      republish(record);

      if (code === 0 || options.allowFailure)
      {
        resolve({ record, stdout: fullStdout });
      }
      else
      {
        reject(new GitError(argv, cwd, code, record.stderr));
      }
    });

    if (options.stdin !== undefined)
    {
      child.stdin?.end(options.stdin, ENCODING_UTF8);
    }
    else
    {
      child.stdin?.end();
    }
  });

  return { record, done, cancel: () => child.kill() };
}

/** Run git and resolve with stdout. Rejects with `GitError` on a non-zero exit. */
export async function runGit(
  cwd: string,
  argv: string[],
  options: RunOptions = {}
): Promise<string>
{
  const kind = classify(argv, options.kind);
  return withReadRetry(kind, async () =>
  {
    const { done } = execute(argv, cwd, options);
    // The complete stdout, not the record's capped copy: this is a parser's input.
    return (await done).stdout;
  });
}

/**
 * Run git and resolve with its stdout as bytes: for blobs (`git show <rev>:<path>` of
 * an image or font), where decoding as UTF-8 and re-encoding, as every other read does, would corrupt them.
 */
export async function runGitBuffer(
  cwd: string,
  argv: string[],
  options: RunOptions = {}
): Promise<Buffer>
{
  const kind = options.kind ?? GIT_KIND_READ;
  return withReadRetry(kind, async () =>
  {
    const chunks: Buffer[] = [];
    const { done } = execute(argv, cwd, {
      kind: GIT_KIND_READ,
      ...options,
      onBinary: (chunk) => chunks.push(chunk)
    });
    await done;
    return Buffer.concat(chunks);
  });
}

/**
 * Run git and resolve with `null` instead of throwing: for work where a failure means
 * "not applicable", not "something is broken" (an ahead/behind with no upstream, an
 * absent config section). Mostly optional reads, but a `tryGit` write (deactivating a
 * remote's config sections) runs with `GIT_OPTIONAL_LOCKS=0` too, since it can't say `kind: 'write'`.
 */
export async function tryGit(
  cwd: string,
  argv: string[],
  options: RunOptions = {}
): Promise<string | null>
{
  try
  {
    // `optional`, so the log records the run in full but the status bar does not paint a
    // red failure badge for a config key that is simply unset.
    return await runGit(cwd, argv, { ...options, optional: true });
  }
  catch
  {
    return null;
  }
}

/**
 * `execute`'s handle, narrowed to the record. A streaming caller has already been
 * handed every chunk, so `stdout` is empty by design; dropping it here keeps that from reading as data gone missing.
 */
function recordOnly(handle: {
  done: Promise<{ record: GitCommandRecord; stdout: string }>;
  cancel: () => void;
}): { done: Promise<GitCommandRecord>; cancel: () => void }
{
  return { done: handle.done.then(({ record }) => record), cancel: handle.cancel };
}

/** Run git, streaming output lines as they arrive. Returns a handle with `cancel`. */
export function streamGit(
  cwd: string,
  argv: string[],
  onLine: (line: string, isError: boolean) => void,
  options: RunOptions = {},
  /**
   * The line git is still writing, each time it changes: a progress meter rewrites one
   * line for a whole phase, and a caller showing progress wants it as it moves rather
   * than once it is over. It arrives again through `onLine` when it finally ends.
   */
  onPartial?: (line: string) => void
): { done: Promise<GitCommandRecord>; cancel: () => void }
{
  const kind = classify(argv, options.kind);
  return withStreamRetry(kind, (onEmit) =>
    recordOnly(
      execute(
        argv,
        cwd,
        options,
        (line, isError) =>
        {
          onEmit();
          onLine(line, isError);
        },
        undefined,
        onPartial
      )
    )
  );
}

/**
 * Run git, delivering raw stdout chunks unsplit: for NUL-delimited output, where
 * `streamGit`'s line splitting would cut records in the wrong place. The caller owns reassembly: see `LogParser`.
 */
export function streamGitRaw(
  cwd: string,
  argv: string[],
  onChunk: (chunk: string) => void,
  options: RunOptions = {}
): { done: Promise<GitCommandRecord>; cancel: () => void }
{
  const kind = classify(argv, options.kind);
  return withStreamRetry(kind, (onEmit) =>
    recordOnly(
      execute(argv, cwd, options, undefined, (chunk) =>
      {
        onEmit();
        onChunk(chunk);
      })
    )
  );
}
