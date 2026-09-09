/**
 * Not a test: a bench harness for `buildGraph`, so a change to the layout can be weighed
 * rather than guessed at.
 *
 * Times the layout over a real history and prints a self-time profile of it. Skipped
 * unless `BENCH_REPO` names a repository, because it wants a history big enough for the
 * numbers to mean something and there is no such fixture to build cheaply:
 *
 *     BENCH_REPO=<path> npx vitest run tests/bench/graph.bench.test.ts
 *
 * The profile comes from `node:inspector` rather than `--cpu-prof`, so it covers the
 * one call being measured instead of the whole run, vitest's own startup included.
 */

import { describe, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { Session } from 'node:inspector';
import { buildGraph, type GraphConfig } from '@renderer/model/graph/index.js';

const REPO = process.env.BENCH_REPO ?? '';

/** How much of git's output to take: a large history is tens of megabytes. */
const MAX_LOG_BYTES = 1 << 28;

/** Sampling interval, in microseconds. Fine enough to separate the passes. */
const SAMPLE_US = 100;

/** Self time below this is noise, not a finding. */
const MIN_REPORTED_MS = 1;

const CONFIG: GraphConfig = { mergeCommonParentLanes: true };

/** The layout reads two fields of a commit, so the bench reads two out of `git log`. */
function loadCommits(): { sha: string; parents: string[] }[]
{
  const out = execFileSync(
    'git',
    [
      '-C',
      REPO,
      'log',
      '-z',
      '--format=%H%x00%P',
      '--date-order',
      '--branches',
      '--tags',
      '--remotes'
    ],
    { maxBuffer: MAX_LOG_BYTES }
  ).toString();

  const fields = out.split('\0');
  const commits: { sha: string; parents: string[] }[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2)
  {
    const sha = fields[i]!;
    if (!sha)
    {
      continue;
    }
    const parents = fields[i + 1]!.trim();
    if (parents)
    {
      commits.push({ sha, parents: parents.split(' ') });
    }
    else
    {
      commits.push({ sha, parents: [] });
    }
  }
  return commits;
}

/** Median of five, after one warm run: the first pass pays for compilation. */
function median(commits: readonly { sha: string; parents: string[] }[], config: GraphConfig): number
{
  buildGraph(commits, config);
  const runs: number[] = [];
  for (let i = 0; i < 5; i++)
  {
    const started = process.hrtime.bigint();
    buildGraph(commits, config);
    runs.push(Number(process.hrtime.bigint() - started) / 1e6);
  }
  runs.sort((a, b) => a - b);
  return runs[2]!;
}

interface ProfileCallFrame {
  functionName: string;
  url: string;
  lineNumber: number;
}

interface ProfileNode {
  id: number;
  callFrame: ProfileCallFrame;
}

interface CpuProfile {
  nodes: ProfileNode[];
  samples: number[];
  timeDeltas: number[];
}

/** Self time per function, biggest first: which pass the layout is actually spending in. */
function selfTimes(profile: CpuProfile): { ms: number; name: string; where: string }[]
{
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const self = new Map<number, number>();
  profile.samples.forEach((id, index) =>
    self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[index] ?? 0))
  );

  const rows: { ms: number; name: string; where: string }[] = [];
  for (const [id, us] of self)
  {
    const frame = byId.get(id)?.callFrame;
    if (!frame)
    {
      continue;
    }
    const ms = us / 1000;
    if (ms < MIN_REPORTED_MS || frame.functionName.startsWith('(idle'))
    {
      continue;
    }
    const file = frame.url.split('/').pop() ?? '';
    rows.push({
      ms,
      name: frame.functionName || '(anonymous)',
      where: `${file}:${frame.lineNumber + 1}`
    });
  }
  return rows.sort((a, b) => b.ms - a.ms);
}

async function profileOneBuild(
  commits: readonly { sha: string; parents: string[] }[]
): Promise<CpuProfile>
{
  const session = new Session();
  session.connect();
  const send = (method: string, params?: object): Promise<unknown> =>
    new Promise((resolve, reject) =>
    {
      session.post(method as never, params as never, (error, result) =>
      {
        if (error)
        {
          reject(error);
        }
        else
        {
          resolve(result);
        }
      });
    });

  await send('Profiler.enable');
  await send('Profiler.setSamplingInterval', { interval: SAMPLE_US });
  await send('Profiler.start');
  buildGraph(commits, CONFIG);
  const stopped = (await send('Profiler.stop')) as { profile: CpuProfile };
  session.disconnect();
  return stopped.profile;
}

describe.skipIf(!REPO)('buildGraph bench', () =>
{
  it('times the layout and profiles one build', async () =>
  {
    const commits = loadCommits();
    console.log(`commits: ${commits.length}`);

    const variants: [string, GraphConfig][] = [
      ['defaults', CONFIG],
      ['no mergeCommonParentLanes', { mergeCommonParentLanes: false }]
    ];
    for (const [label, config] of variants)
    {
      console.log(`  ${label.padEnd(38)} median ${median(commits, config).toFixed(1)}ms`);
    }

    console.log('--- self time, defaults ---');
    for (const row of selfTimes(await profileOneBuild(commits)).slice(0, 20))
    {
      console.log(`  ${row.ms.toFixed(1).padStart(7)}ms  ${row.name}  ${row.where}`);
    }
  }, 300_000);
});
