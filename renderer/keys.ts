/**
 * Accelerator syntax: key events to command strings and back to readable form.
 * Split from registry to keep `commands/registry.ts` DOM-free (unit-testable under Node).
 */

/**
 * Normalize key names: KeyboardEvent.key vs Electron accelerator syntax.
 * Ensures `keys` declarations and `main/menu.ts` bindings use the same format.
 */
const ACCEL_MOD = 'Mod';
const ACCEL_ALT = 'Alt';
const ACCEL_SHIFT = 'Shift';
const ACCEL_CTRL = 'Ctrl';
const ACCEL_UP = 'Up';
const ACCEL_DOWN = 'Down';
const ACCEL_LEFT = 'Left';
const ACCEL_RIGHT = 'Right';

// `KeyboardEvent.key` values: the raw DOM vocabulary, as opposed to the accelerator
// syntax above. Every keyboard handler in the app compares against these same strings.
export const KEY_ARROW_UP = 'ArrowUp';
export const KEY_ARROW_DOWN = 'ArrowDown';
export const KEY_ARROW_LEFT = 'ArrowLeft';
export const KEY_ARROW_RIGHT = 'ArrowRight';
export const KEY_HOME = 'Home';
export const KEY_END = 'End';
export const KEY_ENTER = 'Enter';
export const KEY_ESCAPE = 'Escape';
export const KEY_SPACE = ' ';

/** A handler checks this before treating a bare key as a shortcut, in a text box. */
export const TAG_TEXTAREA = 'TEXTAREA';

const KEY_ALIASES: Record<string, string> = {
  ArrowUp: ACCEL_UP,
  ArrowDown: ACCEL_DOWN,
  ArrowLeft: ACCEL_LEFT,
  ArrowRight: ACCEL_RIGHT,
  ' ': 'Space'
};

function isMac(): boolean
{
  return navigator.platform.toLowerCase().includes('mac');
}

/**
 * Normalize a KeyboardEvent into the accelerator syntax used by `keys`.
 * `Mod` stands for Cmd on macOS and Ctrl elsewhere, matching Electron's CmdOrCtrl.
 */
export function eventToAccelerator(event: KeyboardEvent): string
{
  const parts: string[] = [];
  const mac = isMac();
  let mod;
  if (mac)
  {
    mod = event.metaKey;
  }
  else
  {
    mod = event.ctrlKey;
  }

  if (mod)
  {
    parts.push(ACCEL_MOD);
  }
  if (event.altKey)
  {
    parts.push(ACCEL_ALT);
  }
  if (event.shiftKey)
  {
    parts.push(ACCEL_SHIFT);
  }
  // The non-accelerator modifier still needs representing when both are held.
  let otherModifier: boolean;
  if (mac)
  {
    otherModifier = event.ctrlKey;
  }
  else
  {
    otherModifier = event.metaKey;
  }
  if (otherModifier)
  {
    parts.push(ACCEL_CTRL);
  }

  let key;
  if (event.key.length === 1)
  {
    key = event.key.toUpperCase();
  }
  else
  {
    key = event.key;
  }
  parts.push(KEY_ALIASES[event.key] ?? key);
  return parts.join('+');
}

/**
 * Whether the platform's accelerator modifier is held: Cmd on macOS, Ctrl elsewhere.
 *
 * Takes the two flags rather than an event, because the callers are mouse events as
 * often as keyboard ones: a Mod-click adds to a selection instead of replacing it.
 * Note that on macOS a *Ctrl*-click is a right-click, which is why this cannot simply
 * read `ctrlKey` everywhere.
 */
export function isModPressed(event: { metaKey: boolean; ctrlKey: boolean }): boolean
{
  if (isMac())
  {
    return event.metaKey;
  }
  else
  {
    return event.ctrlKey;
  }
}

/** Render an accelerator for display, using platform-native symbols. */
export function formatAccelerator(accelerator: string): string
{
  if (!isMac())
  {
    return accelerator.replace(ACCEL_MOD, ACCEL_CTRL);
  }
  return accelerator
    .replace(ACCEL_MOD, '⌘')
    .replace(ACCEL_ALT, '⌥')
    .replace(ACCEL_SHIFT, '⇧')
    .replace(ACCEL_CTRL, '⌃')
    .replace(ACCEL_UP, '↑')
    .replace(ACCEL_DOWN, '↓')
    .replace(ACCEL_LEFT, '←')
    .replace(ACCEL_RIGHT, '→')
    .replaceAll('+', '');
}
