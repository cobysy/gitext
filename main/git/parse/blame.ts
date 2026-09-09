import type { BlameCommitInfo, BlameFile, BlameLine } from '@shared/types.js';

// Blame metadata field keys
const BLAME_AUTHOR = 'author';
const BLAME_AUTHOR_MAIL = 'author-mail';
const BLAME_AUTHOR_TIME = 'author-time';
const BLAME_AUTHOR_TZ = 'author-tz';
const BLAME_COMMITTER = 'committer';
const BLAME_COMMITTER_MAIL = 'committer-mail';
const BLAME_COMMITTER_TIME = 'committer-time';
const BLAME_COMMITTER_TZ = 'committer-tz';
const BLAME_SUMMARY = 'summary';
const BLAME_FILENAME = 'filename';
const BLAME_PREVIOUS = 'previous';
const BLAME_BOUNDARY = 'boundary';

const BLAME_LINE_PREFIX = '\t';

/**
 * Parse git blame --porcelain (newline-delimited, not NUL; cache metadata by SHA).
 */
export function parseBlame(text: string, path: string): BlameFile
{
  const lines: BlameLine[] = [];
  const commits = new Map<string, BlameCommitInfo>();

  const HEADER = /^([0-9a-f]{40}) (\d+) (\d+)(?: \d+)?$/;

  let pendingSha = '';
  let pendingOrigLine = 0;
  let pendingFinalLine = 0;
  /** Set only while a not-yet-cached commit's metadata lines are being read. */
  let pending: Partial<BlameCommitInfo> | null = null;

  for (const line of text.split('\n'))
  {
    const header = HEADER.exec(line);
    if (header)
    {
      pendingSha = header[1]!;
      pendingOrigLine = Number(header[2]);
      pendingFinalLine = Number(header[3]);
      if (commits.has(pendingSha))
      {
        pending = null;
      }
      else
      {
        pending = { sha: pendingSha };
      }
      continue;
    }

    if (line.startsWith(BLAME_LINE_PREFIX))
    {
      // Content line: last line of each metadata chunk.
      if (pending)
      {
        commits.set(pendingSha, {
          author: '',
          authorMail: '',
          authorTime: 0,
          authorTz: '',
          committer: '',
          committerMail: '',
          committerTime: 0,
          committerTz: '',
          summary: '',
          filename: path,
          ...pending,
          sha: pendingSha
        });
        pending = null;
      }
      lines.push({
        sha: pendingSha,
        origLine: pendingOrigLine,
        finalLine: pendingFinalLine,
        text: line.slice(1)
      });
      continue;
    }

    // Skip metadata lines for already-cached commits.
    if (!pending)
    {
      continue;
    }

    const space = line.indexOf(' ');
    let key;
    if (space === -1)
    {
      key = line;
    }
    else
    {
      key = line.slice(0, space);
    }
    let value;
    if (space === -1)
    {
      value = '';
    }
    else
    {
      value = line.slice(space + 1);
    }

    switch (key)
    {
      case BLAME_AUTHOR:
        pending.author = value;
        break;
      case BLAME_AUTHOR_MAIL:
        pending.authorMail = value.replace(/^<|>$/g, '');
        break;
      case BLAME_AUTHOR_TIME:
        pending.authorTime = Number(value) || 0;
        break;
      case BLAME_AUTHOR_TZ:
        pending.authorTz = value;
        break;
      case BLAME_COMMITTER:
        pending.committer = value;
        break;
      case BLAME_COMMITTER_MAIL:
        pending.committerMail = value.replace(/^<|>$/g, '');
        break;
      case BLAME_COMMITTER_TIME:
        pending.committerTime = Number(value) || 0;
        break;
      case BLAME_COMMITTER_TZ:
        pending.committerTz = value;
        break;
      case BLAME_SUMMARY:
        pending.summary = value;
        break;
      case BLAME_FILENAME:
        pending.filename = value;
        break;
      case BLAME_PREVIOUS: {
        const [previousSha, ...rest] = value.split(' ');
        pending.previousSha = previousSha;
        pending.previousPath = rest.join(' ');
        break;
      }
      case BLAME_BOUNDARY:
        pending.boundary = true;
        break;
      default:
        // Forward-compatible: unknown keys are ignored.
        break;
    }
  }

  return { path, lines, commits: Object.fromEntries(commits) };
}
