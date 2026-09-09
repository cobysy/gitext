/**
 * One counter for every `stream:start` request id in this window, shared by every
 * composable that streams git output (`useGitStream`, `useDialog`'s live-output path).
 * Two independent counters could both mint the same id for two runs in flight at once,
 * and a second `stream:start` for an id already in flight cancels the first in
 * `main/ipc/outputStream.ts`.
 */

let next = 1;

export function nextStreamRequestId(): number
{
  return next++;
}
