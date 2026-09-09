/**
 * `git archive` argv. Output path in argv (--output): command log shows
 * full command including destination.
 */

import { PATH_SEPARATOR } from '@shared/diff.js';
import { HEAD_REF } from '@renderer/model/sha.js';

const FORMAT_ZIP = 'zip';
const CMD_ARCHIVE = 'archive';
const FLAG_OUTPUT = '--output';
const DEFAULT_REPO_NAME = 'archive';

export type ArchiveFormat = 'zip' | 'tar' | 'tar.gz';

export interface ArchiveFormatInfo {
  format: ArchiveFormat;
  label: string;
  /** Extension for filename and save dialog filter. */
  extension: string;
}

export const ARCHIVE_FORMATS: readonly ArchiveFormatInfo[] = [
  { format: FORMAT_ZIP, label: 'ZIP', extension: 'zip' },
  { format: 'tar', label: 'TAR', extension: 'tar' },
  { format: 'tar.gz', label: 'TAR.GZ', extension: 'tar.gz' }
];

export interface ArchiveOptions {
  /** Revision to archive: SHA, tag, branch, or tree reference. */
  revision: string;
  format?: ArchiveFormat;
  /** Output file path. Required. */
  output: string;
  /** Root dir inside archive for all files. */
  prefix?: string;
  /** Paths to archive; empty means whole tree. */
  paths?: readonly string[];
}

export function buildArchiveArgs(options: ArchiveOptions): string[]
{
  const { revision, format = FORMAT_ZIP, output, prefix = '', paths = [] } = options;
  if (!revision.trim() || !output.trim())
  {
    return [];
  }

  const kept = paths.map((path) => path.trim()).filter((path) => path.length > 0);
  const trimmedPrefix = prefix.trim().replace(/\/+$/, '');

  const args = [CMD_ARCHIVE, `--format=${format}`];
  // git wants trailing slash; without it glues to every filename.
  if (trimmedPrefix)
  {
    args.push(`--prefix=${trimmedPrefix}/`);
  }
  args.push(revision.trim());
  args.push(FLAG_OUTPUT);
  args.push(output.trim());
  // --, so path looking like revision is still read as path.
  if (kept.length)
  {
    args.push(PATH_SEPARATOR, ...kept);
  }
  return args;
}

/**
 * Suggest filename: repo_revision[_path].ext. Needed: three archives
 * indistinguishable by default.
 */
export function suggestedArchiveName(
  repoName: string,
  revision: string,
  format: ArchiveFormat,
  paths: readonly string[] = []
): string
{
  const info = ARCHIVE_FORMATS.find((entry) => entry.format === format);
  const kept = paths.map((path) => path.trim()).filter((path) => path.length > 0);
  // Single path only: joining multiple makes unusable filename.
  let suffix;
  if (kept.length === 1)
  {
    suffix = `_${kept[0]!.replace(/[./\\]/g, '_')}`;
  }
  else
  {
    suffix = '';
  }
  const stem = `${repoName || DEFAULT_REPO_NAME}_${revision.trim().slice(0, 12) || HEAD_REF}${suffix}`;
  return `${stem}.${info?.extension ?? FORMAT_ZIP}`;
}
