/** The error every git invocation rejects with. */
export class GitError extends Error
{
  readonly argv: string[];
  /** Repo path: needed to identify a stray failure. */
  readonly cwd: string;
  readonly exitCode: number | null;
  readonly stderr: string;

  constructor(argv: string[], cwd: string, exitCode: number | null, stderr: string)
  {
    const detail = stderr.trim() || `git exited with code ${exitCode}`;
    super(detail);
    this.name = 'GitError';
    this.argv = argv;
    this.cwd = cwd;
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}
