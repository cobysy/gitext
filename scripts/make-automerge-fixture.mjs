#!/usr/bin/env node
/**
 * Build a repository whose merge conflicts exercise the WORD-LEVEL AUTO-MERGE.
 *
 * Shaped around where the offer *stops*: a file where every block settles, one where only
 * some do, one where none do, and one with no common ancestor at all, so all four answers
 * sit side by side in a single resolve session. `tour:conflicts` checks the same feature;
 * this one is for looking at it.
 *
 * Every git call is an argv array through `spawnSync`, never a shell string, for the same
 * reason the app does it: paths and messages contain characters a shell would eat.
 *
 * Usage:
 *   npm run fixture:automerge -- [--path <dir>] [--no-merge] [--force]
 *
 *   --path <dir>  where to build it (default: ../gitext-automerge-fixture beside this repo)
 *   --no-merge    leave the branches diverged but unmerged, so the merge is started from
 *                 the app and the resolver has to raise itself
 *   --force       delete an existing directory at that path first
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
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

const target = resolve(value('path', join(here, '..', '..', 'gitext-automerge-fixture')));
const stopBeforeMerging = flag('no-merge');

/** The branch carrying the incoming side, kept after the merge so it can be redone. */
const OTHER = 'their-edits';

// ── git ──────────────────────────────────────────────────────────────────────

/** Identity pinned per call, so the machine's own config cannot change the result. */
const IDENTITY = [
  '-c',
  'user.name=Demo',
  '-c',
  'user.email=demo@example.com',
  '-c',
  'commit.gpgsign=false',
  '-c',
  'core.autocrlf=false',
  // The default marker style, which is the one the auto-merge has to work without: it
  // writes no common ancestor into the file, so the base region is anchored from the blob.
  '-c',
  'merge.conflictStyle=merge'
];

let clock = 1700000000;

function git(args, options = {})
{
  const stamp = String(clock++);
  const result = spawnSync('git', [...IDENTITY, ...args], {
    cwd: target,
    encoding: 'utf8',
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

const commit = (message) => git(['commit', '-q', '-m', message]);

// ── The conflicts ────────────────────────────────────────────────────────────

/**
 * One entry per conflicted file: the common ancestor, what each side made of it, and what
 * the file is here to show. A table rather than a sequence of writes, because what is being
 * demonstrated is the *set*. `base: null` is the add/add case, inherited from neither side.
 */
const FILES = {
  'recipe.txt': {
    note: 'one block, settled, the two sides changed different words of one line',
    base: [
      'Pancakes',
      'Serves four.',
      '',
      '2 cups flour',
      '1 tsp salt',
      '2 eggs',
      '300 ml milk',
      '',
      'Whisk, rest, fry.'
    ],
    ours: { 4: '2 tsp salt' },
    theirs: { 4: '1 tsp sea salt' }
  },

  'notes.md': {
    note: 'two blocks, both settled, the strip offers to merge them all at once',
    base: [
      '# Release notes',
      '',
      '## Highlights',
      '',
      'The app now starts in under two seconds.',
      'Dark mode follows the system setting.',
      '',
      '## Known issues',
      '',
      'Large repositories can be slow to open.',
      'Tags are not shown in the graph.'
    ],
    ours: {
      4: 'The app now starts in under one second.',
      9: 'Large repositories can be slow to open on a cold cache.'
    },
    theirs: {
      4: 'The app now reliably starts in under two seconds.',
      9: 'Very large repositories can be slow to open.'
    }
  },

  'greet.js': {
    note: 'code, the merged line keeps its indentation, because whitespace is a token too',
    base: [
      'export function greet(name)',
      '{',
      "  return 'Hello, ' + name;",
      '}'
    ],
    ours: { 2: "  return 'Hello, ' + name + '!';" },
    theirs: { 2: "  return 'Hi, ' + name;" }
  },

  'README.md': {
    note: 'two blocks, one settled and one not, the strip says so rather than doing both',
    // The two edits sit at opposite ends on purpose: git folds conflicts a few lines apart
    // into one block, and a block holding both a disjoint edit and a colliding one can only
    // be declined as a whole.
    base: [
      '# Ledger',
      '',
      'A small tool for tracking expenses.',
      '',
      '## Install',
      '',
      'Download the binary and put it on your PATH.',
      '',
      '## Licence',
      '',
      'MIT.'
    ],
    ours: { 2: 'A small tool for tracking shared expenses.', 10: 'Apache 2.0.' },
    theirs: { 2: 'A small command-line tool for tracking expenses.', 10: 'BSD 3-Clause.' }
  },

  'changelog.txt': {
    note: 'both sides rewrote the same words, no offer at all, and that is the point',
    base: ['Unreleased', '==========', '', 'Nothing yet.'],
    ours: { 3: 'A faster startup.' },
    theirs: { 3: 'Dark mode.' }
  },

  'greeting.txt': {
    note: 'added on both sides, nothing to merge over, and "Keep the common ancestor" is off',
    base: null,
    ours: ['Hello from main.'],
    theirs: ['Hello from the other branch.']
  }
};

/** A side's whole file: the base with its edits applied, or the side's own lines outright. */
function sideText(file, side)
{
  const edits = file[side];
  if (!file.base)
  {
    return edits.join('\n') + '\n';
  }
  const lines = [...file.base];
  for (const [at, text] of Object.entries(edits))
  {
    lines[Number(at)] = text;
  }
  return lines.join('\n') + '\n';
}

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

console.log(`Building an auto-merge fixture in ${target}`);

// The common ancestor. A file that only exists on one side has no base to write.
for (const [path, file] of Object.entries(FILES))
{
  if (file.base)
  {
    write(path, file.base.join('\n') + '\n');
  }
}
git(['add', '-A']);
commit('The version both sides started from');

// The incoming side, on a branch that survives the merge so the whole thing can be redone.
git(['checkout', '-q', '-b', OTHER]);
for (const [path, file] of Object.entries(FILES))
{
  write(path, sideText(file, 'theirs'));
}
git(['add', '-A']);
commit('Their edits');

git(['checkout', '-q', 'main']);
for (const [path, file] of Object.entries(FILES))
{
  write(path, sideText(file, 'ours'));
}
git(['add', '-A']);
commit('My edits');

if (!stopBeforeMerging)
{
  // Expected to fail: that failure *is* the conflicted merge this is here to produce.
  git(['merge', OTHER], { allowFailure: true });
}

// ── Say what was made ────────────────────────────────────────────────────────

const widest = Math.max(...Object.keys(FILES).map((path) => path.length));
const inventory = Object.entries(FILES)
  .map(([path, file]) => `  ${path.padEnd(widest)}  ${file.note}`)
  .join('\n');

let opening;
if (stopBeforeMerging)
{
  opening = `Nothing is merged yet: run Merge into Current Branch… on \`${OTHER}\` and the
resolver raises itself.`;
}
else
{
  opening = 'The merge is in progress, so the app opens on the conflict banner.';
}

console.log(`
Built ${Object.keys(FILES).length} conflicted files in ${target}

${opening}
Resolve here on a row opens the three-way editor; the strip above the merged pane is the
offer, repeated in each settleable block's own toolbar.

${inventory}

Redo it with git merge --abort. Rebasing onto \`${OTHER}\` instead swaps every label,
because mid-rebase the replayed commit is yours.
`);
