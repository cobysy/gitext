/**
 * Which dialog this window is (from query string). One reader for the URL convention.
 * Null in the repo window (not a dialog).
 */

import { isDialogName, type DialogName } from '@shared/dialogs.js';

export const QUERY_PARAM_NAME = 'name';

export function currentDialogName(): DialogName | null
{
  const raw = new URLSearchParams(window.location.search).get(QUERY_PARAM_NAME) ?? '';
  if (isDialogName(raw))
  {
    return raw;
  }
  else
  {
    return null;
  }
}
