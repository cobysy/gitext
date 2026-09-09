/**
 * Reword a commit by changing its message only.
 *
 * HEAD: `git commit --amend --only -m <message>` (leaves index staged).
 * Other: `amend! <subject>` commit, then `git rebase -i --autosquash` to apply.
 * (`amend!` is git's convention; two `-m` flags join with blank line.)
 */

import type { ArgvStep } from './checkout.js';

const CMD_COMMIT = 'commit';
const CMD_REBASE = 'rebase';
const FLAG_AMEND = '--amend';
const FLAG_ONLY = '--only';
const FLAG_MESSAGE = '-m';
const FLAG_ALLOW_EMPTY = '--allow-empty';
const FLAG_INTERACTIVE = '-i';
const FLAG_AUTOSQUASH = '--autosquash';
const FLAG_AUTOSTASH = '--autostash';

export interface RewordOptions {
  sha: string;
  /** Current subject: matched by amend! marker. */
  subject: string;
  message: string;
  /** Whether sha is HEAD: caller's answer, as SHA abbreviations vary. */
  isHead: boolean;
}

/** Commands to reword a commit, in order. */
export function buildRewordSteps(options: RewordOptions): ArgvStep[]
{
  const { sha, subject, isHead } = options;
  const message = options.message.trim();
  if (!message || !sha)
  {
    return [];
  }

  if (isHead)
  {
    return [
      {
        label: 'Rewording the commit failed',
        argv: [CMD_COMMIT, FLAG_AMEND, FLAG_ONLY, FLAG_MESSAGE, message]
      }
    ];
  }

  return [
    {
      label: 'Writing the new message failed',
      argv: [
        CMD_COMMIT,
        FLAG_ONLY,
        FLAG_ALLOW_EMPTY,
        FLAG_MESSAGE,
        `amend! ${subject}`,
        FLAG_MESSAGE,
        message
      ]
    },
    {
      label: 'Applying the message failed, the amend! commit is still on the branch',
      argv: [CMD_REBASE, FLAG_INTERACTIVE, FLAG_AUTOSQUASH, FLAG_AUTOSTASH, `${sha}^`]
    }
  ];
}
