/**
 * Recent commit messages and authors for the commit screen pickers.
 * One module because one `git log` carries both, avoiding duplicate subprocesses.
 */

import { ref } from 'vue';
import { api } from '@renderer/api.js';
import { READS } from '@shared/invalidation.js';
import { authorLine } from '@renderer/model/commitMessage.js';

/** How far back the pickers look. Enough to find a colleague or last week's wording. */
const RECENT_COMMITS = 30;

/**
 * Field and record separators: commit messages contain newlines, so escape sequences in the format
 * but actual bytes in the output. NUL in an argv would cause spawn to reject it.
 */
const FIELD_FORMAT = '%x1f';
const RECORD_FORMAT = '%x00';
const FIELD = '\x1f';
const RECORD = '\x00';

export interface CommitAuthor {
  name: string;
  email: string;
  /** `Name <email>`, as `--author` wants it and as the picker's row reads. */
  line: string;
}

export function createHistoryState()
{
  const recentMessages = ref<string[]>([]);
  const recentAuthors = ref<CommitAuthor[]>([]);

  function reset(): void
  {
    recentMessages.value = [];
    recentAuthors.value = [];
  }

  /**
   * Read both, swallowing errors to empty: a new repo has no history, which is ordinary.
   */
  async function load(repoPath: string | undefined): Promise<void>
  {
    if (!repoPath)
    {
      reset();
      return;
    }

    try
    {
      const out = await api['git:run'](
        repoPath,
        [
          'log',
          `-${RECENT_COMMITS}`,
          `--format=%an${FIELD_FORMAT}%ae${FIELD_FORMAT}%B${RECORD_FORMAT}`
        ],
        READS
      );
      const records = out.split(RECORD).filter((record) => record.trim());

      const messages: string[] = [];
      const authors = new Map<string, CommitAuthor>();
      for (const record of records)
      {
        const [name = '', email = '', body = ''] = record.split(FIELD);
        const message = body.trim();
        if (message && !messages.includes(message))
        {
          messages.push(message);
        }
        // Key by email so one person with different name spellings still appears once.
        const key = email.trim().toLowerCase();
        if (key && !authors.has(key))
        {
          authors.set(key, {
            name: name.trim(),
            email: email.trim(),
            line: authorLine(name.trim(), email.trim())
          });
        }
      }
      recentMessages.value = messages;
      recentAuthors.value = [...authors.values()];
    }
    catch
    {
      recentMessages.value = [];
      recentAuthors.value = [];
    }
  }

  return { recentMessages, recentAuthors, load, reset };
}

export type HistoryState = ReturnType<typeof createHistoryState>;
