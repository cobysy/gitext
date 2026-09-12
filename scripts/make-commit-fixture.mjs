#!/usr/bin/env node
/**
 * Build a repository that exercises every corner of the COMMIT SCREEN.
 *
 * Named for what it is: this fixture is shaped around the commit screen's cases, not a
 * general-purpose demo repository. It has no interesting *history*, two commits, because
 * nothing here is about the revision grid. A fixture for that would be a different script
 * with a different shape, and calling this one `demo` implied it covered both.
 *
 * Poking at the commit screen against this project's own repo only ever shows two or
 * three modified TypeScript files, which is the easy case. The interesting states: a
 * file that is staged *and* modified, a rename, a binary, a file with no trailing
 * newline, a whitespace-only change, a path deep enough to test the dense tree, a file
 * marked skip-worktree: all have to be constructed, and constructing them by hand each
 * time is how they end up never being looked at.
 *
 * Every git call is an argv array through `spawnSync`, never a shell string, for the
 * same reason the app does it: paths and messages contain characters a shell would eat.
 *
 * Usage:
 *   npm run fixture:commit -- [--path <dir>] [--conflict] [--big] [--force]
 *
 *   --path <dir>  where to build it (default: ../gitext-commit-fixture beside this repo)
 *   --conflict    leave a merge in progress with conflicts, to exercise the conflicts
 *                 button and the resolve dialog
 *   --big         add 300 generated files, to see the lists and the filter under load
 *   --force       delete an existing directory at that path first
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// ── Arguments ────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, fallback) =>
{
  const at = argv.indexOf(`--${name}`);
  if (at !== -1 && argv[at + 1])
  {
    return argv[at + 1];
  }
  else
  {
    return fallback;
  }
};

const target = resolve(value('path', join(here, '..', '..', 'gitext-commit-fixture')));
const wantConflict = flag('conflict');
const wantBig = flag('big');

// ── git ──────────────────────────────────────────────────────────────────────

/** Identity and settings pinned per call, so the machine's own config cannot change the result. */
const IDENTITY = [
  '-c',
  'user.name=Demo',
  '-c',
  'user.email=demo@example.com',
  '-c',
  'commit.gpgsign=false',
  // Pin the dates: without this the fixture's commits are all "just now" and the grid
  // orders them arbitrarily, which makes the screenshots differ run to run.
  '-c',
  'core.autocrlf=false'
];

let clock = 1700000000;

function git(args, options = {})
{
  const stamp = String(clock++);
  const result = spawnSync('git', [...IDENTITY, ...args], {
    cwd: options.cwd ?? target,
    encoding: 'utf8',
    input: options.input,
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: `${stamp} +0000`,
      GIT_COMMITTER_DATE: `${stamp} +0000`
    }
  });
  if (result.status !== 0 && !options.allowFailure)
  {
    console.error(`git ${args.join(' ')}\n${result.stderr}`);
    process.exit(1);
  }
  return result.stdout ?? '';
}

const write = (path, contents) =>
{
  const full = join(target, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents);
};

const commit = (message) => git(['commit', '-m', message]);

/** Ten numbered lines: enough that an edit at each end produces two separate hunks. */
const numbered = (count = 40) =>
  Array.from({ length: count }, (_, i) => `line ${i + 1}`).join('\n') + '\n';

// ── Build ────────────────────────────────────────────────────────────────────

if (existsSync(target))
{
  if (!flag('force'))
  {
    console.error(`${target} already exists. Pass --force to replace it.`);
    process.exit(1);
  }
  rmSync(target, { recursive: true, force: true });
}

mkdirSync(target, { recursive: true });
git(['init', '-q', '-b', 'main']);

console.log(`Building a demo repository in ${target}`);

// ── The base commit: everything that will later be changed ───────────────────

write('README.md', '# Demo\n\nA repository for poking at the commit screen.\n');
write('two-hunks.txt', numbered());
write('renamed-later.txt', 'this file gets renamed\n');
write('deleted-later.txt', 'this file gets deleted\n');
write('whitespace.txt', 'const a = 1;\nconst b = 2;\n');
write('no-newline.txt', 'this file has no trailing newline');
write('long-lines.js', `const x = ${JSON.stringify('a'.repeat(400))};\nconst y = 2;\n`);
write('partially-staged.txt', numbered(20));
write('skip-me.conf', 'setting = local value\n');
write('assume-me.conf', 'setting = another local value\n');

// Deep enough that the dense tree has something to merge, and wide enough that the
// folder tree is worth switching to.
write('src/deep/nested/further/down/here.ts', 'export const here = true;\n');
write('src/deep/nested/further/down/sibling.ts', 'export const sibling = true;\n');
write('src/components/Widget.vue', '<template><div /></template>\n');
write('src/components/Panel.vue', '<template><section /></template>\n');
write('src/styles/main.css', 'body { margin: 0; }\n');
write('docs/guide.md', '# Guide\n');
write('docs/api.md', '# API\n');

// A binary file, so the diff pane has to say it cannot show one.
write('assets/logo.png', Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'));

write('.gitignore', 'build/\n*.log\n');

if (wantBig)
{
  for (let i = 0; i < 300; i++)
  {
    write(`generated/module-${String(i).padStart(3, '0')}.ts`, `export const n = ${i};\n`);
  }
}

git(['add', '-A']);
commit('Initial commit');

// A second commit, so there is a history to amend against and `HEAD~1` exists.
write('docs/guide.md', '# Guide\n\nSome words.\n');
git(['add', '-A']);
commit('Add some words to the guide');

// ── A merge left mid-conflict, on request ────────────────────────────────────
//
// Before the mess rather than after it, and deliberately so: `git merge` refuses to
// start when the index holds staged changes, and `git stash pop` refuses to run at all
// while a merge is unresolved. Building the conflict first and then making the mess on
// top is the only order where both survive.

if (wantConflict)
{
  git(['checkout', '-q', '-b', 'other']);
  write('conflicted.txt', 'the other branch wrote this\n');
  git(['add', '-A']);
  commit('Other branch writes conflicted.txt');

  git(['checkout', '-q', 'main']);
  write('conflicted.txt', 'main wrote something else entirely\n');
  git(['add', '-A']);
  commit('Main writes conflicted.txt');

  // Expected to fail: that failure *is* the conflict this is here to produce.
  git(['merge', 'other'], { allowFailure: true });
}

// ── Now make a mess, one state at a time ─────────────────────────────────────

// 1. Two well-separated hunks: the case hunk staging exists for.
{
  const lines = numbered().split('\n');
  lines[0] = 'line 1: CHANGED AT THE TOP';
  lines[39] = 'line 40: CHANGED AT THE BOTTOM';
  write('two-hunks.txt', lines.join('\n'));
}

// 2. A file that is staged and then modified again: `MM` in git status, and the one
//    file that legitimately appears in BOTH lists at once.
{
  const lines = numbered(20).split('\n');
  lines[2] = 'line 3: staged change';
  write('partially-staged.txt', lines.join('\n'));
  git(['add', '--', 'partially-staged.txt']);
  lines[10] = 'line 11: unstaged change on top';
  write('partially-staged.txt', lines.join('\n'));
}

// 3. A staged rename. git only reports it as a rename once it is staged.
git(['mv', '--', 'renamed-later.txt', 'renamed-now.txt']);

// 4. A deletion, unstaged.
rmSync(join(target, 'deleted-later.txt'));

// 5. A whitespace-only change: the diff pane has to say "no differences once
//    whitespace is ignored" rather than "identical".
write('whitespace.txt', 'const a   =   1;\nconst b = 2;\n');

// 6. A change to the last line of a file with no trailing newline, so the
//    `\ No newline at end of file` marker appears on both sides.
write('no-newline.txt', 'this file STILL has no trailing newline');

// 7. A long line, so the diff pane has to scroll sideways.
write('long-lines.js', `const x = ${JSON.stringify('b'.repeat(400))};\nconst y = 2;\n`);

// 8. A binary change.
write('assets/logo.png', Buffer.from('89504e470d0a1a0a0000000d49484452ff', 'hex'));

// 9. Changes deep in the tree, so the folder and dense-tree views have something to
//    fold, and several extensions so "group by extension" is worth using.
write('src/deep/nested/further/down/here.ts', 'export const here = false;\n');
write('src/components/Widget.vue', '<template><div class="changed" /></template>\n');
write('src/styles/main.css', 'body { margin: 0; padding: 0; }\n');
write('docs/api.md', '# API\n\nDocumented.\n');

// 10. Untracked files, including one in a new folder.
write('untracked.txt', 'nobody is tracking me\n');
write('src/components/NewThing.vue', '<template><p>new</p></template>\n');

// 11. An ignored file and a build directory, for "show ignored files".
write('build/output.o', 'binary-ish\n');
write('debug.log', 'noise\n');

// 12. A staged addition, so the staged list has something that is not a modification.
write('staged-new.txt', 'this one is already staged\n');
git(['add', '--', 'staged-new.txt']);

// 13. The two index flags. These are the states that are invisible without the
//     "show skip-worktree / assume-unchanged" toggles, which is the point of them.
appendFileSync(join(target, 'skip-me.conf'), 'edited, but git is told not to care\n');
appendFileSync(join(target, 'assume-me.conf'), 'edited, but git is not looking\n');
git(['update-index', '--skip-worktree', '--', 'skip-me.conf']);
git(['update-index', '--assume-unchanged', '--', 'assume-me.conf']);

// ── Say what was made ────────────────────────────────────────────────────────

console.log('\n' + git(['status', '--short']).trimEnd());
let conflictLine;
if (wantConflict)
{
  conflictLine = '\n  conflicted.txt         a merge left mid-conflict';
}
else
{
  conflictLine = '';
}
let bigNote;
if (wantBig)
{
  bigNote = '\n\nBuilt with --big: 300 extra files under generated/.';
}
else
{
  bigNote = '';
}
console.log(`
Built. Open it with:

  npm run dev            then File ▸ Open Repository… and pick
  ${target}

What is in there to look at:

  two-hunks.txt          two separate hunks: stage one, leave the other
  partially-staged.txt   staged AND modified: the one file in both lists at once
  renamed-now.txt        a staged rename, reported as one move rather than two files
  deleted-later.txt      a deletion
  whitespace.txt         whitespace-only, so the diff can be empty while the file is not
  no-newline.txt         the "\\ No newline at end of file" marker on both sides
  long-lines.js          a 400-character line, so the diff scrolls sideways
  assets/logo.png        binary: the pane has to say so rather than show bytes
  src/deep/nested/...    deep enough to exercise the folder tree and dense merging
  untracked.txt          untracked, plus a new file inside an existing folder
  build/, debug.log      ignored: turn on "Show Ignored Files" to see them
  skip-me.conf           skip-worktree: invisible until you turn its toggle on
  assume-me.conf         assume-unchanged: likewise${conflictLine}

Try: the ⋯ button on each list for the four shapes, right-click a row for what can be
done to it, and Undo / Options beside the Commit button.${bigNote}
`);
