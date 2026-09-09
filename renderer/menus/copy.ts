/**
 * What can be copied off the selected commit.
 *
 * One declaration, two surfaces. Edit is where a clipboard action is looked for, and is
 * the only route with no commit under the pointer; the revision grid is where the operand
 * actually is, and copying a SHA off the row you just right-clicked is a daily gesture.
 * Rendered twice rather than written twice, so the two can never offer different rows.
 *
 * Both forms of each identifier, because they are read by different things: the short SHA
 * and the subject go in a review comment, the full ones into a terminal.
 */

import { item, type MenuNode } from './resolve.js';

export const copyMenu: MenuNode[] = [
  item('copy.sha'),
  item('copy.shortSha'),
  item('copy.subject'),
  item('copy.message'),
  item('copy.author'),
  item('copy.refs')
];
