/**
 * The toolbar Monaco holds open above each conflict block still in the file: the row of
 * choices, and the line under it saying who changed each side.
 *
 * Raw DOM rather than a Vue component, because `changeViewZones` takes a node and there
 * is nothing to mount one into. Its own module because none of it is Vue at all: given
 * a block, the words for the two sides, and what to do when a button is pressed, it
 * builds an element. What the buttons *mean* stays in `renderer/model/conflictMarkers.ts`,
 * and when to rebuild them stays with the editor that owns the zones.
 *
 * Icons rather than a phrase each: a toolbar drawn inside the file being edited cannot
 * afford six phrases, and `title`/`aria-label` carry the words for anything not reading
 * pixels.
 */

import { formatRelativeDate } from '@renderer/format.js';
import {
  CONFLICT_CHOICE_BASE,
  CONFLICT_CHOICE_OURS,
  CONFLICT_CHOICE_OURS_THEN_THEIRS,
  CONFLICT_CHOICE_THEIRS,
  CONFLICT_CHOICE_THEIRS_THEN_OURS,
  type ConflictBlock,
  type ConflictChoice
} from '@renderer/model/conflictMarkers.js';
import {
  conflictIconElement,
  type ConflictIconName
} from '@renderer/components/ui/conflictIcons.js';
import type { BlameCommitInfo } from '@shared/types.js';

const CLASS_BAR = 'gitext-conflict-toolbar';
const CLASS_ROW = 'gitext-conflict-toolbar__row';
const CLASS_LABEL = 'gitext-conflict-toolbar__label';
const CLASS_ATTRIBUTION = 'gitext-conflict-toolbar__attribution';

/** Between the two attributions: wide enough to read as two facts, not one sentence. */
const ATTRIBUTION_SEPARATOR = '   ·   ';

export interface BlockToolbarOptions {
  block: ConflictBlock;
  /** Which block this is, and how many there are: "Conflict 2 of 5". */
  index: number;
  total: number;
  /** What to call each side. Never "ours"/"theirs": those swap meaning mid-rebase. */
  oursLabel: string;
  theirsLabel: string;
  /** The role words the attribution line and the "keep both" tooltips are phrased with. */
  oursRole: string;
  theirsRole: string;
  /** Who last touched each side of this block, when blame has answered. */
  oursCommit: BlameCommitInfo | null;
  theirsCommit: BlameCommitInfo | null;
  /** The word-level merge, where one exists. Absent means the two sides really collide. */
  merged: readonly string[] | undefined;
  /** False when there is no common ancestor to go back to, which greys that one button. */
  hasBase: boolean;
  onChoose: (block: ConflictBlock, choice: ConflictChoice) => void;
  onMerged: (block: ConflictBlock, mergedLines: readonly string[]) => void;
}

/** "Mine: Jane, 2 days ago, "…"", or nothing at all when blame has not answered. */
export function attributionText(role: string, commit: BlameCommitInfo | null): string
{
  if (!commit)
  {
    return '';
  }
  return `${role}: ${commit.author}, ${formatRelativeDate(commit.authorTime)}, "${commit.summary}"`;
}

function iconButton(icon: ConflictIconName, label: string, act: () => void): HTMLButtonElement
{
  const button = document.createElement('button');
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.append(conflictIconElement(icon));
  button.addEventListener('click', act);
  return button;
}

export function buildBlockToolbar(options: BlockToolbarOptions): HTMLElement
{
  const bar = document.createElement('div');
  bar.className = CLASS_BAR;

  const row = document.createElement('div');
  row.className = CLASS_ROW;
  bar.append(row);

  const label = document.createElement('span');
  label.className = CLASS_LABEL;
  label.textContent = `Conflict ${options.index + 1} of ${options.total}`;
  row.append(label);

  const addChoice = (
    icon: ConflictIconName,
    text: string,
    choice: ConflictChoice,
    disabled: boolean
  ): void =>
  {
    const button = iconButton(icon, text, () => options.onChoose(options.block, choice));
    button.disabled = disabled;
    row.append(button);
  };

  // Offered only where a word-level merge exists, and leads when it's there: almost
  // always the answer. The tooltip shows the result, so nothing is accepted unseen.
  const merged = options.merged;
  if (merged)
  {
    row.append(
      iconButton(
        'autoMerge',
        `Merge both automatically: the two sides changed different words:\n${merged.join('\n')}`,
        () => options.onMerged(options.block, merged)
      )
    );
  }

  addChoice('keepMine', `Keep ${options.oursLabel}`, CONFLICT_CHOICE_OURS, false);
  addChoice('keepIncoming', `Keep ${options.theirsLabel}`, CONFLICT_CHOICE_THEIRS, false);
  // Both orders as two buttons: which reads right depends on what the sides changed;
  // no default wins more often.
  addChoice(
    'keepMineThenIncoming',
    `Keep both: ${options.oursRole} first`,
    CONFLICT_CHOICE_OURS_THEN_THEIRS,
    false
  );
  addChoice(
    'keepIncomingThenMine',
    `Keep both: ${options.theirsRole} first`,
    CONFLICT_CHOICE_THEIRS_THEN_OURS,
    false
  );
  addChoice('keepBase', 'Keep the common ancestor', CONFLICT_CHOICE_BASE, !options.hasBase);

  // Who's actually responsible for each side of this block, not just which side.
  const oursText = attributionText(options.oursRole, options.oursCommit);
  const theirsText = attributionText(options.theirsRole, options.theirsCommit);
  if (oursText || theirsText)
  {
    const attribution = document.createElement('div');
    attribution.className = `${CLASS_ROW} ${CLASS_ATTRIBUTION}`;
    attribution.textContent = [oursText, theirsText].filter(Boolean).join(ATTRIBUTION_SEPARATOR);
    bar.append(attribution);
  }

  return bar;
}
