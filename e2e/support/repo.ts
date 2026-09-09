import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * A commit's object name.
 *
 * Branded because a step holds several strings at once, a SHA it saved before the
 * operation, a branch name, a subject line, and passing the wrong one to `subject()`
 * would read as the operation having done nothing rather than as the mistake it is.
 * Branch names and messages stay plain: a name says what those are.
 */
export type Sha = string & { readonly __brand: 'Sha' };
export function toSha(value: string): Sha
{
  return value as Sha;
}

/** Which multi-step operation git is part-way through. */
export type Operation = 'rebase' | 'am' | 'cherry-pick' | 'revert' | 'merge' | 'none';

/** The identity every commit these specs make is written with. */
export const IDENT = [
  '-c',
  'user.name=Tour',
  '-c',
  'user.email=tour@example.com',
  '-c',
  'commit.gpgsign=false'
];

/**
 * The repository under test, read with the `git` CLI.
 *
 * **Everything asserted comes through here rather than through the UI.** The point of
 * driving the app is to catch a dialog that closes as though it worked and did nothing,
 * which only a reading that never touches the screen can see.
 *
 * Never a shell string: the same rule the app itself follows.
 */
export class Repo
{
  constructor(public readonly dir: string)
  {}

  /** Ask git, in this repository. Returns stdout and stderr together, trimmed. */
  git(args: string[], cwd: string = this.dir): string
  {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    return ((result.stdout ?? '') + (result.stderr ?? '')).trimEnd();
  }

  /** Ask git and fail loudly, for the setup a step does rather than what it asserts. */
  mustGit(args: string[], cwd: string = this.dir): string
  {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (result.status !== 0)
    {
      throw new Error(`git ${args.join(' ')} failed:\n${result.stderr ?? ''}`);
    }
    return (result.stdout ?? '').trimEnd();
  }

  head(): Sha
  {
    return toSha(this.git(['rev-parse', 'HEAD']));
  }

  branch(): string
  {
    return this.git(['rev-parse', '--abbrev-ref', 'HEAD']);
  }

  branches(): string[]
  {
    return this.git(['for-each-ref', '--format=%(refname:short)', 'refs/heads']).split('\n');
  }

  status(): string
  {
    return this.git(['status', '--porcelain']);
  }

  /** One path's line in `git status --porcelain`, or `''` when git says nothing about it. */
  statusOf(file: string): string
  {
    return this.status()
      .split('\n')
      .find((line) => line.endsWith(file)) ?? '';
  }

  /** What the index holds for a path: the only honest answer to "did that stage?". */
  indexBlob(file: string): string
  {
    return this.git(['show', `:${file}`]);
  }

  /** The paths carrying a flag other than the ordinary one: skip-worktree and friends. */
  indexFlags(): string[]
  {
    return this.git(['ls-files', '-v'])
      .split('\n')
      .filter((line) => line !== '' && !line.startsWith('H '));
  }

  subject(rev = 'HEAD'): string
  {
    return this.git(['log', '-1', '--format=%s', rev]);
  }

  /** The whole message, subject and body: for asserting what is *not* in one. */
  message(rev = 'HEAD'): string
  {
    return this.git(['log', '-1', '--format=%B', rev]);
  }

  parents(rev = 'HEAD'): Sha[]
  {
    return this.git(['log', '-1', '--format=%P', rev])
      .split(' ')
      .filter(Boolean)
      .map(toSha);
  }

  stashCount(): number
  {
    return this.git(['stash', 'list']).split('\n').filter(Boolean).length;
  }

  /** Paths git reports as unmerged: the conflict spec's main assertion. */
  conflicts(): string[]
  {
    return this.git(['diff', '--name-only', '--diff-filter=U']).split('\n').filter(Boolean);
  }

  /** Which multi-step operation git is part-way through, by its marker files. */
  operation(): Operation
  {
    const has = (...parts: string[]): boolean =>
      fs.existsSync(path.join(this.dir, '.git', ...parts));
    if (has('rebase-merge'))
    {
      return 'rebase';
    }
    if (has('rebase-apply'))
    {
      if (has('rebase-apply', 'applying'))
      {
        return 'am';
      }
      return 'rebase';
    }
    if (has('CHERRY_PICK_HEAD'))
    {
      return 'cherry-pick';
    }
    if (has('REVERT_HEAD'))
    {
      return 'revert';
    }
    if (has('MERGE_HEAD'))
    {
      return 'merge';
    }
    return 'none';
  }

  /** One file's contents, or '' when it is not there. */
  fileText(rel: string): string
  {
    try
    {
      return fs.readFileSync(path.join(this.dir, rel), 'utf8');
    }
    catch
    {
      return '';
    }
  }

  /** Write one file, relative to the repository. */
  write(rel: string, text: string): void
  {
    fs.writeFileSync(path.join(this.dir, rel), text);
  }

  append(rel: string, text: string): void
  {
    fs.appendFileSync(path.join(this.dir, rel), text);
  }

  exists(rel: string): boolean
  {
    return fs.existsSync(path.join(this.dir, rel));
  }

  /** Commit whatever is in the tree, as the suite's identity. */
  commitAll(message: string): void
  {
    this.git(['add', '-A']);
    this.git([...IDENT, 'commit', '-q', '-m', message]);
  }

  /**
   * Snapshot every uncommitted file, and hand back the function that puts them all back.
   *
   * For the steps that *spend* the fixture's dirty working tree rather than borrowing it.
   * Byte for byte, so nothing downstream can tell the step ran.
   */
  keepWorkingTree(): () => void
  {
    const files = this.status()
      .split('\n')
      .filter(Boolean)
      .map((line) => line.slice(3).trim())
      .filter((rel) => this.exists(rel))
      .map((rel) => ({ rel, body: fs.readFileSync(path.join(this.dir, rel)) }));

    return () =>
    {
      for (const file of files)
      {
        fs.writeFileSync(path.join(this.dir, file.rel), file.body);
      }
    };
  }
}
