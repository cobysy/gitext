/**
 * Command log ring buffer: every execution is recorded for the transparency panel
 * and broadcast. Split from runner.ts because this is bookkeeping, not spawning.
 */

import { EventEmitter } from 'node:events';
import type { GitCommandRecord } from '@shared/types.js';

interface CommandLogState {
  nextId: number;
  ringDepth: number;
  ring: GitCommandRecord[];
}

const state: CommandLogState = {
  nextId: 1,
  ringDepth: 500,
  ring: []
};

const RECORD_EVENT = 'record';

export const runnerEvents = new EventEmitter<{ record: [GitCommandRecord] }>();

export function nextRecordId(): number
{
  return state.nextId++;
}

export function setCommandLogDepth(depth: number): void
{
  state.ringDepth = Math.max(1, depth);
  trimRing();
}

export function getCommandLog(): GitCommandRecord[]
{
  return [...state.ring];
}

export function clearCommandLog(): void
{
  state.ring = [];
}

function trimRing(): void
{
  if (state.ring.length > state.ringDepth)
  {
    state.ring.splice(0, state.ring.length - state.ringDepth);
  }
}

/** Add a started record to the log and publish it. */
export function pushRecord(record: GitCommandRecord): void
{
  state.ring.push(record);
  trimRing();
  runnerEvents.emit(RECORD_EVENT, { ...record });
}

/**
 * Re-publish a record after it's been mutated: while it runs, each time more of its
 * output arrives, and once more when it exits. A subscriber that only wants the
 * finished command checks `running`, as the diagnostics log does.
 */
export function republish(record: GitCommandRecord): void
{
  runnerEvents.emit(RECORD_EVENT, { ...record });
}
