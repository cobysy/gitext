/**
 * Editing a commit message as text: the conventional-commit prefix, and dropping a
 * template or an old message into the box.
 *
 * Pure, no store, no DOM, so what each of these does to a half-written message is a unit
 * test rather than something only reachable by opening the commit screen and typing.
 */

/**
 * The conventional-commit types, in the order the picker offers them and `nextPrefix`
 * cycles through. A fixed table, not a setting: the point of the convention is that everyone spells the types the same way.
 */
export const CONVENTIONAL_PREFIXES: readonly { type: string; describes: string }[] = [
  { type: 'feat', describes: 'A new capability' },
  { type: 'fix', describes: 'A bug fixed' },
  { type: 'refactor', describes: 'A change that neither fixes nor adds' },
  { type: 'perf', describes: 'A change that makes it faster' },
  { type: 'test', describes: 'Tests only' },
  { type: 'docs', describes: 'Documentation only' },
  { type: 'build', describes: 'The build, or a dependency' },
  { type: 'ci', describes: 'The CI configuration' },
  { type: 'chore', describes: 'Everything else' }
];

/**
 * A conventional prefix at the very start of the message, if there is one: `type`, an
 * optional `(scope)`, an optional `!`, then a colon. Anchored, and only over the types
 * above, since a message beginning "fixed: " is prose, not a prefix to rewrite.
 */
const PREFIX_PATTERN = new RegExp(
  `^(${CONVENTIONAL_PREFIXES.map((entry) => entry.type).join('|')})(\\([^)]*\\))?(!)?:[ \\t]*`
);

export interface ParsedPrefix {
  type: string;
  /** The `(scope)` as written, parentheses included, or `''` when there is none. */
  scope: string;
  breaking: boolean;
  /** Everything after the prefix: the message as it would read without one. */
  rest: string;
}

/** Read the message's prefix, or null when it has none. */
export function parsePrefix(message: string): ParsedPrefix | null
{
  const match = PREFIX_PATTERN.exec(message);
  if (!match)
  {
    return null;
  }
  return {
    type: match[1]!,
    scope: match[2] ?? '',
    breaking: match[3] === '!',
    rest: message.slice(match[0].length)
  };
}

/**
 * Put `type` at the front, replacing whatever prefix was there. The scope and `!`
 * survive the swap: retyping `(parser)!` after every correction is exactly the friction that makes people stop using the picker.
 */
export function applyPrefix(message: string, type: string): string
{
  const existing = parsePrefix(message);
  if (existing)
  {
    let breaking = '';
    if (existing.breaking)
    {
      breaking = '!';
    }
    return `${type}${existing.scope}${breaking}: ${existing.rest}`;
  }
  // `trimStart` so an empty message doesn't become a lone space after the colon, and a prefix added to indented text doesn't bury it.
  return `${type}: ${message.trimStart()}`;
}

/** The type after this message's, wrapping round: what a bare hotkey press does. A message with no prefix takes the first, so one press is enough to get started. */
export function nextPrefix(message: string): string
{
  const existing = parsePrefix(message);
  const first = CONVENTIONAL_PREFIXES[0]!.type;
  if (!existing)
  {
    return first;
  }
  const at = CONVENTIONAL_PREFIXES.findIndex((entry) => entry.type === existing.type);
  if (at < 0)
  {
    return first;
  }
  return CONVENTIONAL_PREFIXES[(at + 1) % CONVENTIONAL_PREFIXES.length]!.type;
}

/**
 * Put `text` in the box, keeping anything already typed. Replacing outright is the one
 * thing this must not do: a template chosen after a subject was written would silently
 * discard it, and there's no undo for a text box.
 */
export function withMessageText(message: string, text: string): string
{
  const addition = text.replace(/\s+$/, '');
  if (!addition)
  {
    return message;
  }
  if (!message.trim())
  {
    return addition;
  }
  return `${message.replace(/\s+$/, '')}\n\n${addition}`;
}

/** One line naming a person, as `--author` wants it and `git log` prints it. Built here, not at the call site, so the picker's label and the argv are the same string. */
export function authorLine(name: string, email: string): string
{
  return `${name} <${email}>`;
}
