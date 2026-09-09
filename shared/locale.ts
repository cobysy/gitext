/**
 * OS locale to Intl-compatible. Handles region override (e.g., en_US@rg=dkzzzz).
 * POSIX shapes to BCP-47. Returns '' for unusable locale.
 */

/** CLDR region override: @rg=dkzzzz or -u-rg-dkzzzz. */
const REGION_OVERRIDE = /\brg[=-]([a-z]{2})zzzz\b/i;

export function toDisplayLocale(systemLocale: string): string
{
  const trimmed = systemLocale.trim();
  if (!trimmed)
  {
    return '';
  }

  // Codeset is POSIX, means nothing here.
  const withoutCodeset = trimmed.split('.')[0] ?? '';
  const base = (withoutCodeset.split('@')[0] ?? '').replace(/_/g, '-');

  const override = REGION_OVERRIDE.exec(withoutCodeset);
  let region;
  if (override)
  {
    region = override[1]!.toUpperCase();
  }
  else
  {
    region = null;
  }

  let localeBase: string;
  if (region)
  {
    localeBase = withRegion(base, region);
  }
  else
  {
    localeBase = base;
  }
  return canonical(localeBase);
}

/**
 * Replace region, keep language and script. Drop variants/extensions:
 * Intl won't read -u-rg-.
 */
function withRegion(tag: string, region: string): string
{
  const [language = '', ...rest] = tag.split('-');
  const script = rest.find((part) => /^[a-z]{4}$/i.test(part));
  return [language, script, region].filter(Boolean).join('-');
}

/** Empty string for unusable locale (fallback, not error). */
function canonical(tag: string): string
{
  try
  {
    return Intl.getCanonicalLocales(tag)[0] ?? '';
  }
  catch
  {
    return '';
  }
}
