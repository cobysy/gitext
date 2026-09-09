<script setup lang="ts">
/**
 * Git config section: separate component due to async subprocesses per scope change.
 * Git config is source of truth (not shadowed in config.json).
 */

import { computed, ref, watch } from 'vue';
import type { ConfigWriteScope } from '@shared/types.js';
import FormGroup from '@renderer/components/ui/FormGroup.vue';
import FormRadioGroup, { type RadioOption } from '@renderer/components/ui/FormRadioGroup.vue';
import FormText from '@renderer/components/ui/FormText.vue';
import FormSelect from '@renderer/components/ui/FormSelect.vue';
import { api, toMessage } from '@renderer/api.js';
import { useRepoStore } from '@renderer/stores/repo.js';

// List (not pairs of refs): all use same read/write/clear pattern; only control differs.
const KEYS = ['user.name', 'user.email', 'core.autocrlf', 'merge.tool', 'diff.tool'] as const;

/** Keyed by the closed set above rather than by `string`, so a typo is a compile error. */
type ConfigKey = (typeof KEYS)[number];
type ConfigValues = Partial<Record<ConfigKey, string>>;

const CONFIG_SCOPE_GLOBAL = 'global';
const CONFIG_SCOPE_LOCAL = 'local';
const CONFIG_SCOPE_EFFECTIVE = 'effective';

const AUTOCRLF = [
  { value: '', label: 'Not set' },
  { value: 'input', label: 'Convert to LF on commit (input)' },
  { value: 'false', label: 'Leave line endings alone (false)' },
  { value: 'true', label: 'Convert to CRLF on checkout (true)' }
];

const repo = useRepoStore();

const scope = ref<ConfigWriteScope>(CONFIG_SCOPE_GLOBAL);
/** What the chosen scope's own file holds. Absent means the key is not set there. */
const values = ref<ConfigValues>({});
/** What git resolves for the repository: shown as the placeholder behind an unset field. */
const effective = ref<ConfigValues>({});
/** Edited text, so a half-typed value is not written on every keystroke. */
const draft = ref<Record<ConfigKey, string>>(blankDraft());

function blankDraft(): Record<ConfigKey, string>
{
  return Object.fromEntries(KEYS.map((key) => [key, ''])) as Record<ConfigKey, string>;
}
const error = ref('');

const scopes = computed<RadioOption[]>(() =>
{
  let localHint: string;
  if (repo.repo)
  {
    localHint = 'Overrides the global value for this repository only.';
  }
  else
  {
    localHint = 'No repository is open.';
  }
  return [
    { value: CONFIG_SCOPE_GLOBAL, label: 'Global', hint: 'Every repository on this computer.' },
    {
      value: CONFIG_SCOPE_LOCAL,
      label: 'This repository',
      hint: localHint,
      disabled: !repo.repo
    }
  ];
});

async function load(): Promise<void>
{
  const path = repo.repo?.path ?? null;
  try
  {
    const [scoped, resolved] = await Promise.all([
      api['config:read'](path, scope.value, [...KEYS]),
      api['config:read'](path, CONFIG_SCOPE_EFFECTIVE, [...KEYS])
    ]);
    values.value = scoped;
    effective.value = resolved;
    draft.value = Object.fromEntries(KEYS.map((key) => [key, scoped[key] ?? ''])) as Record<
      ConfigKey,
      string
    >;
    error.value = '';
  }
  catch (err)
  {
    error.value = toMessage(err);
  }
}

/**
 * Writes on `change`, the same moment `saveGitPath` uses on the page around this: Enter,
 * and leaving a field that was edited. A write per keystroke would be a subprocess per
 * keystroke, and would leave `user.name` set to every prefix of a name along the way.
 */
async function save(key: ConfigKey): Promise<void>
{
  const next = draft.value[key].trim();
  if (next === (values.value[key] ?? ''))
  {
    return;
  }
  try
  {
    await api['config:write'](repo.repo?.path ?? null, scope.value, key, next || null);
    error.value = '';
  }
  catch (err)
  {
    error.value = toMessage(err);
  }
  // Re-read either way: a refused write leaves the field showing what git actually has
  // rather than what was typed at it, and a successful one may have changed what the
  // effective value resolves to.
  await load();
}

/** `''` is the "Not set" row, which is an unset key rather than an empty value. */
function placeholderFor(key: ConfigKey): string
{
  if (values.value[key])
  {
    return '';
  }
  if (effective.value[key])
  {
    return `${effective.value[key]} (inherited)`;
  }
  else
  {
    return 'Not set';
  }
}

watch(() => [scope.value, repo.repo?.path] as const, load, { immediate: true });

// A scope nobody can read is a scope nobody should be left on: closing the repository
// while the local file is showing would otherwise leave five empty fields that write
// nowhere.
watch(
  () => repo.repo,
  (open) =>
  {
    if (!open)
    {
      scope.value = CONFIG_SCOPE_GLOBAL;
    }
  }
);

const scopeModel = computed({
  get: () => scope.value as string,
  set: (value: string) =>
  {
    scope.value = value as ConfigWriteScope;
  }
});
</script>

<template>
  <div class="form">
    <FormGroup label="Where these are written">
      <FormRadioGroup v-model="scopeModel" :options="scopes" inline />
    </FormGroup>

    <FormText
      v-model="draft['user.name']"
      label="Name"
      :monospace="false"
      :placeholder="placeholderFor('user.name')"
      @change="save('user.name')"
    />
    <FormText
      v-model="draft['user.email']"
      label="Email"
      :placeholder="placeholderFor('user.email')"
      @change="save('user.email')"
    />
    <FormSelect
      v-model="draft['core.autocrlf']"
      label="Line endings"
      :options="AUTOCRLF"
      hint="`core.autocrlf`"
      @change="save('core.autocrlf')"
    />
    <FormText
      v-model="draft['merge.tool']"
      label="Merge tool"
      :placeholder="placeholderFor('merge.tool')"
      hint="`merge.tool`: the tool Resolve Conflicts hands a file to."
      @change="save('merge.tool')"
    />
    <FormText
      v-model="draft['diff.tool']"
      label="Diff tool"
      :placeholder="placeholderFor('diff.tool')"
      hint="`diff.tool`: used by Open in Diff Tool."
      @change="save('diff.tool')"
    />

    <p v-if="error" class="error">{{ error }}</p>
  </div>
</template>
