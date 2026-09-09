# Git's output: from bytes to two windows

> How what git prints reaches the screen. The command log's contents, not its panel;
> the console window's contents, not the dialog that opened it. See
> [DIALOGS.md](DIALOGS.md) for who decides a run gets a console at all.

Two windows show what a command said, and they must never disagree about it. **One
splitter turns git's bytes into lines; two transports carry those lines to two windows
with different jobs.** The split happens once, in the only function that spawns git.

```
 MAIN PROCESS
 ┌──────────────────────────────────────────────────────────────────────────┐
 │ spawn(git, argv)                           the one spawn site,           │
 │      │                                     whoever asked                 │
 │      ▼                                                                   │
 │ stdout/stderr chunk                        arbitrary boundaries: one     │
 │      │                                     line in three pieces, or      │
 │      ▼                                     three lines in one            │
 │ pump()                                     split on \n, hold the tail,   │
 │      │                                     terminalLine each line        │
 │      ├──────────────────┐                  · main/git/runner.ts          │
 │      ▼                  ▼                                                │
 │ CappedOutput       onLine(line, isError)                                 │
 │ the record's text  only when watched       · runner/recordOutput.ts      │
 │      │                  │                                                │
 │      ▼                  ▼                                                │
 │ republish,                                 · runner/commandLog.ts        │
 │ max 10 a second    batch, every 50 ms      · main/ipc/outputStream.ts    │
 └──────┼──────────────────┼────────────────────────────────────────────────┘
        │                  │   ← process boundary; structured clone
 event:gitCommand   event:streamLine
        │                  │
 ┌──────┼──────────────────┼────────────────────────────────────────────────┐
 │      ▼                  ▼                                                │
 │ commandLog store   useStreamWatch          a whole record each time,     │
 │ upsert by id       one run, cancellable    vs. the new lines of one run  │
 │      │                  │                                                │
 │      ▼                  ▼                                                │
 │ CommandLogPanel    CommandOutputDialog                                   │
 │      └────────┬─────────┘                                                │
 │               ▼                                                          │
 │          OutputPane                        the one <pre> either draws    │
 │ RENDERER                                   · components/transparency/    │
 └──────────────────────────────────────────────────────────────────────────┘
```

## 1. One splitter

`pump` ([main/git/runner.ts:280](../main/git/runner.ts#L280)) is the only place chunks
become lines. It runs for **every** command, streamed or not, and both readers take what
it produces.

```ts
const shown = terminalLine(line);
kept.addLine(shown);        // the command log's record
onLine?.(shown, isError);   // the console window, when one is watching
```

- **The tail is carried, never guessed.** The last element of a split is an unfinished
  line; it is held and prefixed to the next chunk. Two chunks of one `gc`, and what
  comes out:

```
 chunk 1   "Enumerating objects: 2400, done.\nCounting objects:  4"
 chunk 2   "7% (1128/2400)\rCounting objects: 100% (2400/2400), done.\n"

            └───────── a whole line ─────────┘└─── held back ────┘
                                              prefixed to chunk 2, so the
                                              percentage is never cut in half

 out       "Enumerating objects: 2400, done."
           "Counting objects: 100% (2400/2400), done."
                                              the 47% tick was overwritten in
                                              the terminal, so it is never a line
```

  Both windows get those two lines and nothing else. A splitter that dropped the tail
  would lose the phase; one that flushed it would print half a percentage.
- **`terminalLine`** ([runner/ptyOutput.ts:57](../main/git/runner/ptyOutput.ts#L57)) is
  the whole of what "as a terminal would show it" means here:

  | in the line | what it means | result |
  |---|---|---|
  | a bare `\r` | the cursor went back to column 0, what follows overwrote what was there | keep what follows the last one |
  | a trailing `\r` before the `\n` | a CRLF line ending | drop it, then collapse as above |

  Both rules are load-bearing. Without the first, one `fetch` reads as every percentage
  it passed through run together on one line. Without the second, a diff of a file with
  CRLF endings reads as blank lines.
- **The record does no parsing.** `CappedOutput`
  ([runner/recordOutput.ts:17](../main/git/runner/recordOutput.ts#L17)) is `addLine`,
  `setPartial`, and a bound. A second splitter is a second copy of the `\r` rule, and
  two copies is how two windows come to disagree about one command.

**The line being written counts as output.** A progress meter spends a whole phase
rewriting one line with no `\n` in it, so anything that waits for the newline shows
nothing for the length of that phase. The unfinished tail goes to `onPartial` and to
`setPartial`, and is replaced, not appended to, each time it changes.

## 2. Two transports, and why they stay two

|  | `event:gitCommand` | `event:streamLine` |
|---|---|---|
| carries | one whole `GitCommandRecord` | the new lines of one run |
| covers | **every** git subprocess, including the reads main starts itself | only runs the renderer asked to stream |
| keyed by | a record id main mints at spawn | a request id the **renderer** minted first |
| retains | a ring of 500 records, output capped per record | the last 8 runs, for a window that opened late |
| can | be read after the fact | be cancelled, and report progress |
| drawn by | `CommandLogPanel` | `CommandOutputDialog` |

Neither can be built on the other. The log has no request id to cancel and no
subscriber waiting on a specific run; the stream has no history and never sees the
background polling. They share the only thing they were both deriving: the lines.

- A run is streamed when `gitConsole.ts` says so: anything reaching a remote always, per
  `NETWORK_VERBS` ([renderer/gitConsole.ts:57](../renderer/gitConsole.ts#L57)),
  everything else by the `streamLiveOutput` setting.
- `useStreamWatch` asks `stream:state` on mount
  ([useStreamWatch.ts:103](../renderer/composables/useStreamWatch.ts#L103)): the window
  is opened by the window that started the run, so a quick command can be over before
  this one exists.

## 3. A record is republished as it prints

`pushRecord` publishes at spawn. `republish`
([runner/commandLog.ts:67](../main/git/runner/commandLog.ts#L67)) publishes again on
every exit **and while the command runs**, so the panel fills in as git talks instead of
arriving complete in one flash.

- **First chunk at once, then at most one per `LIVE_OUTPUT_INTERVAL_MS`** (100ms,
  [runner.ts:124](../main/git/runner.ts#L124)). Leading edge so output appears the
  moment there is any; throttled after, because each publish is a whole record broadcast
  to every open window and a progress meter moves faster than anyone reads.
- **Two throttles, deliberately not one number.** 100ms here republishes a record; 50ms
  in `outputStream.ts` batches new lines for one watched run. Different payloads,
  different consumers.
- **A subscriber that wants the finished command checks `running`.** The diagnostics log
  does exactly that; anything new must too, or it records the same command several times.

## 4. What the renderer draws

- **`OutputPane`** is the one `<pre>` of git output. The console window fills itself
  with it; the command log panel dresses it denser through its own `.out` class. Both
  live in `renderer/components/transparency/`, which is where to look before writing
  anything that shows what git said.
- **`useFollowTail`** is the stay-at-the-bottom rule, taking the element rather than
  owning it. The pane uses its 2px default (a fractional device pixel ratio leaves
  `scrollTop` short of the bottom it just reached); the panel's list passes 24, since its
  rows are taller than that.
- **stderr is red only once the command failed.** git writes a whole `fetch`'s progress
  there, so which stream a line came from says nothing about whether it went wrong.
- A record still running with nothing printed says `Waiting for output…`, which is a
  different fact from a finished command that printed nothing.

## Rules for changing any of this

- **Never split git's bytes into lines anywhere else.** Take `onLine`'s lines, or the
  record's text.
- **Never build a display string beside the argv.** `record.argv` is what ran; the
  spawned argv can differ (a pty run goes through `script`) and the log shows neither
  that nor `GLOBAL_CONFIG`.
- **Never draw a new pane of output.** Extend `OutputPane`, or dress it from the parent.
- A new consumer of `event:gitCommand` handles the same record arriving many times.
