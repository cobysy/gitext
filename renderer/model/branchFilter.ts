/**
 * Split branch filter text on whitespace. The caller (buildLogArgs) interprets
 * each token as a wildcard or literal.
 */
export function tokenizeBranchFilter(text: string): string[]
{
  return text.split(/\s+/).filter((token) => token.length > 0);
}
