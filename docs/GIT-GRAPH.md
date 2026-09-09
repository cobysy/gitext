# The revision graph: from `git log` to pixels

Three pieces with narrow seams: a **git query** that emits shas and parents, a **pure
layout model** that turns those into rows of lanes, and a **canvas renderer** that draws
them. The layout has never seen git; the renderer has never seen a sha.

```
 MAIN PROCESS
 ┌──────────────────────────────────────────────────────────────────────────┐
 │  git log -z --format=…      spawned by streamGitRaw, argv from           │
 │        │                    buildLogArgs, the same array the command     │
 │        ▼                    log shows                · main/git/log.ts   │
 │  LogParser                  splits on NUL, holds back the partial        │
 │        │                    record at the tail  · main/git/parse/log.ts  │
 │        ▼                                                                 │
 │  batch + flush every 50 ms  git emits ~3 commits per chunk; sending      │
 │        │                    each one over IPC costs more than parsing    │
 │        │                    the entire history                           │
 │        │                             · main/ipc/revisionStream.ts        │
 └────────┼─────────────────────────────────────────────────────────────────┘
          │  event:logBatch   ← process boundary; structured clone
 ┌────────┼─────────────────────────────────────────────────────────────────┐
 │        ▼                                                                 │
 │  stores/revisions/layout.ts appends, then re-lays-out the *whole* list,  │
 │        │                    never just the new rows                      │
 │        ▼                                                                 │
 │  buildGraph                 one forward pass: lines, lanes, colours      │
 │        │                    pure, no git, no DOM · renderer/model/graph/ │
 │        ▼                                                                 │
 │  GraphCanvas.vue            one <canvas>, visible rows only              │
 │                              · renderer/…/revisiongrid/                  │
 │  RENDERER                                                                │
 └──────────────────────────────────────────────────────────────────────────┘
```

- Git streams NUL-separated text; `LogParser` turns that into `CommitRow` objects as
  the bytes arrive, so the first screenful can paint while a 50k history is still being
  walked.
- The main process buffers those for 50ms at a time (IPC has per-message cost and git
  hands back only ~3 commits per chunk), then ships each batch across.
- The store appends and re-runs `buildGraph` over everything it now has: a commit
  arriving mid-stream can start a line that changes rows already drawn, so an
  incremental pass would have to invalidate backwards anyway. Never incremental, and
  cheap enough not to care: 17.7k commits lay out in about 26ms.
- The canvas draws only the rows currently on screen.

## 1. What git is asked for

`buildLogArgs` ([main/git/log.ts:51](../main/git/log.ts#L51)) produces the argv. Two
flags matter to the graph specifically:

- **`-z` with a `%x00`-joined format.** Every field is NUL-separated, including between
  records, not lines: a commit body routinely contains newlines. A commit object can't
  contain a NUL, so framing by a fixed field count is unambiguous.
- **The ordering flag is always explicit**: `--date-order`, `--topo-order`, or
  `--author-date-order`, never git's default. Order changes which commits are adjacent,
  which changes how long a line stays open, which changes the shape of the graph.

Of the twelve fields in `LOG_FORMAT_FIELDS`
([main/git/parse/log.ts:15](../main/git/parse/log.ts#L15)) the layout reads exactly two:
`%H` (sha) and `%P` (parents, space-separated, empty for a root, 2+ for a merge).
Everything else is for the grid's other columns.

```ts
interface GraphInputCommit { sha: string; parents: string[] }
```

- **Order is a precondition, not a hint.** `buildGraph` requires display order
  (parents after children, as `git log` emits). No sorting, no lookahead.
- `LogParser` ([main/git/parse/log.ts:117](../main/git/parse/log.ts#L117)) is fed raw
  stdout chunks and yields whole commits, holding the partial record at the tail; it
  survives being fed one byte at a time, since it touches no I/O.
- The grid shows up to two **artificial rows** above the history (working directory,
  index): `CommitRow`s with synthesized shas and a real parent, so the layout treats
  them as ordinary commits and HEAD's line runs unbroken into them. Staging a file
  moves a row between the two without re-reading the log; the store watches the
  artificial set separately and relayouts on it
  ([renderer/stores/revisions.ts:105](../renderer/stores/revisions.ts#L105)).

## 2. Layout: `renderer/model/graph/`

Pure: no git, no DOM, no Vue. Lives under `renderer/model/`, not `shared/`, because
only the renderer ever calls it.

Two words, used precisely throughout:

- a **lane** is a column of the gutter;
- a **line** is one child-to-parent connection, drawn from the child's node down to the
  parent's.

### The model in one page

`OpenLines` (`lanes.ts`) holds the lines open at one point in the walk, one per column,
left to right. A line's lane *is* its slot in that array. Two rules, and they pull in
opposite directions, which is the whole design problem:

> **The gutter stays packed, and a line stays where it is.** A commit that carries one
> line onward gives its column straight back to the line it starts, so nobody moves at
> all. Only a commit that ends more lines than it starts, or starts more than it ends,
> changes anyone else's column, and then by one.

That is what keeps the picture calm. A gutter that closes gradually, a column per row,
has some line moving on almost every row, and lines that are never quite vertical read as
ribbons rather than as lanes: it was built that way first, and it looked like weather.

> **A line arriving at its commit from several columns away is drawn as a diagonal.**

A packed gutter means a line can end at a node three columns to its left, and crossing
three columns inside one row is a five-degree line: it reads as horizontal, not as a lane
change. `slant.ts` answers that by moving where the line is **drawn**, over the rows
above the node, a column per row, crossing *over* its neighbours instead of displacing
them. Two lines briefly sharing a column is what a crossing looks like and costs nothing;
shoving a line aside and letting it drift back costs every line beside it.

`buildGraph` (`layout.ts`) is one forward pass. Per row:

1. The lines heading for this commit **end** here: the leftmost one's column is the
   node's, and its colour is the colour the commit carries on with.
2. If nothing arrives, the commit is a branch tip and takes the leftmost column going
   spare.
3. A line starts for each parent, as one block at the node's column.
4. `settle` closes the gutter up behind anything that ended.
5. Emit a `GraphLine` per line touching the row, with the column it is in at the row's
   top edge and at its bottom edge (`-1` on the side where it stops at the node).

Then `slantArrivals` walks the tracks it kept and turns the long arrivals into diagonals.

```ts
interface GraphLine { fromLane: number; toLane: number; color: number; childRow: number }
interface GraphRow  { nodeLane: number; color: number; laneCount: number; lines: GraphLine[] }
```

That is the whole contract with the renderer, and it is deliberately flat: a row says
where every line is at both of its edges, so **the canvas never has to look at a
neighbouring row** to draw one.

### Which parent goes where

- The **first parent** continues the commit's own lane and its colour, so a branch reads
  as one line straight down in one colour until something ends it. It never joins
  another lane: a first-parent line that could be pulled sideways is a mainline that
  walks about as branches come and go.
- **Later parents** are new lines, each taking the next lane to the right of the node.
- With `mergeCommonParentLanes` on (the default), a line that is *starting* here and
  finds a lane already heading for the same commit joins it instead of taking a lane of
  its own: from that point down the two are one history, and saying so keeps the gutter
  narrow. Off, every line gets a lane of its own and they converge at the parent. Two
  first-parent lines heading for one commit converge either way, since neither may be
  pulled sideways.
- A parent outside the loaded set is never reached, so its lane stays open to the end
  and the line runs off the bottom of the list. That is the honest drawing of "the rest
  is not loaded yet".

### Colour

Colour is decided **once, when a line is created, and never revisited**. That is the
whole of why a line cannot change colour part-way down, and a line that changed colour
would read as two branches where there is one.

- The seed is `hashSha` of the commit the line heads for: FNV-1a over the whole sha, so
  a colour survives a re-layout, a scroll and a reload unchanged.
- The seed proposes and the lines already open veto. A new line steps forward from its
  seed until it clears **every colour currently on screen**, so no two lines in the
  gutter at once are the same and the eye can follow one down without counting columns.
- A gutter wider than the palette cannot manage that, and then the veto falls back to
  what actually matters: the line it branched off, so a branch never leaves its parent
  in the parent's own colour.
- A line joining a lane already heading for the same commit takes **that lane's**
  colour, because from the join down it is that line. Its own would leave a stub of a
  second colour hanging under the node, ending in mid-air at the row's edge.
- **Seven colours** (`GRAPH_COLOR_COUNT`), because `tokens.css` defines `--graph-0`
  through `--graph-6`. The count is load-bearing: a colour is a seed modulo it.

### Ancestry highlighting

`markAncestry` (`ancestry.ts`) sweeps the array top to bottom once, marking every row
reachable from the seed by following parents. It is not an input to `buildGraph`: each
line carries `childRow`, the row of the commit it descends from, and the canvas reads
the marks itself. So moving the highlight is a redraw and never a relayout.

An out-of-range seed (detached or unborn HEAD, or one scrolled out of loaded history)
returns a **zero-length** array, not a full-length array of zeros. Length is the entire
signal: zero means "dim nothing", not "everything is a non-relative".

### What it costs

Whole-history layout of a 17,718-commit repository, measured with
`tests/bench/graph.bench.test.ts` (skipped unless `BENCH_REPO` names a repository):
about **26ms**, nearly all of it in `layOutRow` and `OpenLines.settle`. There is one
pass, so there is no pass to switch off and no complexity ceiling to bail out at.

## 3. Drawing

`GraphCanvas.vue` owns the canvas element, props, DPR and the palette read from CSS;
the geometry lives in `renderer/components/revisiongrid/graph/`:

| File | What it does |
|---|---|
| `path.ts` | the four shapes a line can take in a row: down its lane, across to another, out of the node, into the node |
| `graphRenderer.ts` | one row: its lines, then its node |

- **A row is drawn once, whole, inside its own strip.** Every lane change meets the
  row's edge travelling *vertically*, parallel to the lane it is joining, so the row
  above and the row below join it invisibly without either knowing the other exists.
  There is no clipping, no margin around the visible range, and no segment painted three
  times.
- **Every lane change is one diagonal**, drawn as a cubic that leaves along the diagonal
  and lands vertically (or the reverse, into a node). Never a jog.
- Draw order is lines first, then the node. While a highlight is active the dimmed lines
  are drawn before the lit ones, so a lit line is never painted over by a dim one.

### Geometry

```
LANE_WIDTH          16   column pitch          ┐ all in revisiongrid/geometry.ts, because
COLUMN_LEFT_MARGIN   3   blank space before     │ the grid reserves the room the canvas
                         lane 0                 │ draws in, and both must agree on the
MAX_LANES           40   widest gutter, lanes   │ same numbers
NODE_DIMENSION       8   node diameter          ┘
laneX(lane) = COLUMN_LEFT_MARGIN + Math.trunc((lane + 0.5) * LANE_WIDTH)
```

- **Lanes past `MAX_LANES` are dropped, not clamped.** A line with either end beyond the
  cap is skipped, and so is a node. Clamping (`min(lane, MAX_LANES - 1)`) stacks every
  lane from the cap rightward into one column; lines are stroked in order, so the last
  one wins and the branch that genuinely occupied that column gets painted over, which
  reads as a colour bug rather than a capacity one. A missing line is at least honest
  about being missing.
- The gutter is measured from the rows actually on screen (`RevisionGrid.vue`), so a
  high cap costs nothing until a history is wide enough to use it.
- The canvas redraws on a `watch` over rows, range, row height, line width, the ancestry
  marks, head and selection. It's `aria-hidden` and `pointer-events: none`, decoration
  over the real, focusable, `role="listbox"` rows.

### Colours live in CSS

The palette resolves through `--graph-0` … `--graph-6` off the document element,
defined once in `renderer/styles/tokens.css` for both themes, so the canvas has no
colour literals except an `#888` fallback. `--graph-dim` is the colour for
non-relatives when a highlight seed is active.

### One setting

`GraphConfig` (`renderer/model/graph/config.ts`) is a snapshot taken once and passed in,
never read live from the settings store, which is what keeps `buildGraph` a pure
function of `(commits, config)`. It holds one field,
`mergeCommonParentLanes`, described above. Everything else about the graph is a
rendering preference (`graphLineWidth`, `graphDimNonRelatives`) and never reaches the
layout.

## Where to look when the graph is wrong

| Symptom | Where it lives |
|---|---|
| Two lines on screen at once are the same colour | the veto in `newColor`, `renderer/model/graph/layout.ts` |
| A line changes colour part-way down | a colour is being decided anywhere but at line creation |
| An arrival reads as horizontal rather than diagonal | `slantArrivals` found no plain vertical rows above the node to slant through: `renderer/model/graph/slant.ts` |
| Lanes wobble left and right down the gutter | something is moving a lane where `settle` should have left it alone |
| The mainline drifts rightward | a first-parent line joining another lane; see "Which parent goes where" |
| A line vanishes at the bottom of the list | expected: a parent outside the commit limit |
| A line is missing on a very wide history | expected past `MAX_LANES`: dropped, not clamped |
| A curve's joins don't line up between rows | a stroke in `path.ts` not reaching the row edge vertically |
| Nothing is drawn at all | the `graphVisible` toggle, or the virtualizer's `start`/`end` |

## Tests

- `tests/renderer/graph.layout.test.ts`: the shapes, as ASCII pictures, plus the two
  rules above: a quiet row moves nobody, and a long arrival is drawn as a diagonal
  without moving the lines it crosses.
- `tests/renderer/graph.color.test.ts`: the seed, the veto, what a line inherits, and
  that no line ever changes colour part-way down.
- `tests/renderer/graph.ancestry.test.ts`: the relative-marking sweep.
- `tests/renderer/graph.integration.test.ts`: the same layout against real
  `git log --graph` output in a temp repo, including that it never uses more lanes than
  git does.
- `tests/bench/graph.bench.test.ts`: not a test. Times `buildGraph` over a real history
  and prints a self-time profile. Skipped unless `BENCH_REPO` names a repository:
  `BENCH_REPO=<path> npx vitest run tests/bench/graph.bench.test.ts`.

None of these can see the canvas. A rendering change needs the `run-app` skill and a
look at the screenshot.
