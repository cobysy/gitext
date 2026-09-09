/**
 * Map file paths to Monaco language identifiers for syntax highlighting.
 * Falls back to plaintext for unrecognized files.
 */

const EXT_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  vue: 'html',
  svelte: 'html',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  svg: 'xml',
  xsd: 'xml',
  plist: 'xml',
  css: 'css',
  scss: 'scss',
  sass: 'scss',
  less: 'less',
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  cfg: 'ini',
  env: 'ini',
  md: 'markdown',
  mdx: 'markdown',
  rst: 'restructuredtext',
  py: 'python',
  pyw: 'python',
  rb: 'ruby',
  rbw: 'ruby',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  scala: 'scala',
  cs: 'csharp',
  fs: 'fsharp',
  fsx: 'fsharp',
  cpp: 'cpp',
  cxx: 'cpp',
  cc: 'cpp',
  'c++': 'cpp',
  c: 'c',
  h: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  go: 'go',
  rs: 'rust',
  swift: 'swift',
  php: 'php',
  php4: 'php',
  php5: 'php',
  r: 'r',
  lua: 'lua',
  pl: 'perl',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',
  ps1: 'powershell',
  psm1: 'powershell',
  bat: 'bat',
  cmd: 'bat',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  proto: 'protobuf',
  dart: 'dart',
  ex: 'elixir',
  exs: 'elixir',
  erl: 'erlang',
  hrl: 'erlang',
  hs: 'haskell',
  lhs: 'haskell',
  clj: 'clojure',
  cljs: 'clojure',
  tf: 'hcl',
  hcl: 'hcl',
  groovy: 'groovy',
  gradle: 'groovy',
  makefile: 'makefile',
  dockerfile: 'dockerfile',
  nginx: 'plaintext',
  conf: 'plaintext',
};

const LANGUAGE_MAKEFILE = 'makefile';
const LANGUAGE_DOCKERFILE = 'dockerfile';
const LANGUAGE_INI = 'ini';
const LANGUAGE_GO = 'go';
const LANGUAGE_CMAKE = 'cmake';
export const LANGUAGE_PLAINTEXT = 'plaintext';

const FILENAME_MAKEFILE = 'makefile';
const FILENAME_GNUMAKEFILE = 'gnumakefile';
const FILENAME_DOCKERFILE = 'dockerfile';
const FILENAME_GITIGNORE = '.gitignore';
const FILENAME_GITATTRIBUTES = '.gitattributes';
const FILENAME_GITMODULES = '.gitmodules';
const FILENAME_CARGO_TOML = 'cargo.toml';
const FILENAME_PYPROJECT_TOML = 'pyproject.toml';
const FILENAME_GO_MOD = 'go.mod';
const FILENAME_GO_SUM = 'go.sum';
const FILENAME_CMAKELISTS = 'cmakelists.txt';

function extensionOf(lower: string): string
{
  if (lower.includes('.'))
  {
    return lower.split('.').pop() ?? '';
  }
  else
  {
    return '';
  }
}

export function languageForPath(filePath: string): string
{
  const name = filePath.split('/').pop() ?? filePath;
  const lower = name.toLowerCase();

  switch (lower)
  {
    case FILENAME_MAKEFILE:
    case FILENAME_GNUMAKEFILE:
      return LANGUAGE_MAKEFILE;
    case FILENAME_DOCKERFILE:
      return LANGUAGE_DOCKERFILE;
    case FILENAME_GITIGNORE:
    case FILENAME_GITATTRIBUTES:
    case FILENAME_GITMODULES:
    case FILENAME_CARGO_TOML:
    case FILENAME_PYPROJECT_TOML:
      return LANGUAGE_INI;
    case FILENAME_GO_MOD:
    case FILENAME_GO_SUM:
      return LANGUAGE_GO;
    case FILENAME_CMAKELISTS:
      return LANGUAGE_CMAKE;
    default:
      break;
  }

  const ext = extensionOf(lower);
  return EXT_MAP[ext] ?? LANGUAGE_PLAINTEXT;
}
