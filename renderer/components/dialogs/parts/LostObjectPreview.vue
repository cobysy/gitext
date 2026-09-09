<script setup lang="ts">
/**
 * What a lost object actually is, drawn rather than dumped: the fsck dialog's
 * right-hand pane. A commit, a tree and a blob are three views sharing one frame, kept
 * out of the dialog since how an object is drawn has nothing to do with fsck's own flags.
 *
 * - **A commit or tag** is a drawn header over `ChangedFiles` beside `DiffViewer`,
 *   pointed at the commit's range, not `git show`'s plumbing-repeated header and
 *   one-stream patch.
 * - **A tree** is a file list, not `cat-file -p`'s `100644 blob <40 hex>` noise per line.
 * - **A blob** is a file whose name nobody knows, so it gets the text pane: wrapped,
 *   since there's no language or columns to preserve, and a refusal (with size) when
 *   it isn't text at all.
 *
 * **The commit view builds nothing**: `diff.setRange` points the shared file list and
 * diff viewer at a range, as `CompareDialog` and `StashDialog` do, via
 * `rangeForSelection`, the same pure function the revision grid uses.
 */

import { computed, ref, watch } from 'vue';
import { api, toMessage } from '@renderer/api.js';
import type { LostObject } from '@shared/types.js';
import { rangeForSelection } from '@shared/diff.js';
import { isExecutableMode } from '@shared/mode.js';
import {
  buildBlobArgs,
  buildHeaderArgs,
  buildSizeArgs,
  buildTreeArgs,
  explainState,
  kindNoun,
  looksBinary,
  OBJECT_KIND_BLOB,
  OBJECT_KIND_COMMIT,
  OBJECT_KIND_TAG,
  OBJECT_KIND_TREE,
  parseCommitHeader,
  parseTreeEntries,
  STATE_MISSING,
  type CommitHeader,
  type TreeEntry
} from '@renderer/model/lostObject.js';
import { formatBytes, formatCommitDate, shortSha } from '@renderer/format.js';
import { useDiffStore } from '@renderer/stores/diff.js';
import { useSettingsStore } from '@renderer/stores/settings.js';
import { useReadOnlyEditor } from '@renderer/components/diff/useReadOnlyEditor.js';
import RepoFilePanes from '@renderer/components/dialogs/parts/RepoFilePanes.vue';
import CodeText from '@renderer/components/ui/CodeText.vue';

// Monaco is the largest dependency in the project by an order of magnitude, so both
// viewers load off the critical path: exactly as `CompareDialog` and `StashDialog` do it.
const props = defineProps<{
  object: LostObject | null;
  repoPath: string | undefined;
}>();

const diff = useDiffStore();
const settings = useSettingsStore();

const header = ref<CommitHeader | null>(null);
const entries = ref<TreeEntry[]>([]);
const blobText = ref('');
const blobBytes = ref(0);
const loading = ref(false);
const error = ref<string | null>(null);

/**
 * Which read is the current one. A click is one gesture and up to three git reads, on
 * a list long enough to walk with arrow keys, so an earlier answer can land after a
 * later one's. Every await checks the token it started under.
 */
let token = 0;

const isCommit = computed(
  () => props.object?.kind === OBJECT_KIND_COMMIT || props.object?.kind === OBJECT_KIND_TAG
);
const isTree = computed(() => props.object?.kind === OBJECT_KIND_TREE);
const isBlob = computed(() => props.object?.kind === OBJECT_KIND_BLOB);

const binary = computed(() => isBlob.value && looksBinary(blobText.value));

/**
 * True when there is blob text worth showing as plain text: a commit's patch goes to
 * `DiffViewer` now, so the only wall of text left with no structure is a file nobody can name.
 */
function isPlainTextBlob(isBlob: boolean, blobText: string, binary: boolean): boolean
{
  return isBlob && !!blobText && !binary;
}

const paneContent = computed(() =>
{
  if (isPlainTextBlob(isBlob.value, blobText.value, binary.value))
  {
    return { text: blobText.value, language: 'plaintext', wordWrap: true };
  }
  else
  {
    return null;
  }
}
);

/**
 * Whether this kind of object has a text pane at all: only a blob does. Told apart
 * from "has a pane but nothing yet", since a merely-empty pane keeps its space while one that doesn't apply gives it up.
 */
const wantsPane = computed(() => isBlob.value);

const paneHost = ref<HTMLElement | null>(null);

useReadOnlyEditor({
  host: paneHost,
  effectiveTheme: () => settings.effectiveTheme,
  content: () => paneContent.value,
  uriTag: 'fsck-preview'
});

function reset(): void
{
  header.value = null;
  entries.value = [];
  blobText.value = '';
  blobBytes.value = 0;
  error.value = null;
}

async function load(): Promise<void>
{
  const object = props.object;
  const path = props.repoPath;
  const mine = ++token;

  reset();
  if (!object || !path)
  {
    return;
  }

  loading.value = true;
  try
  {
    switch (object.kind)
    {
      case OBJECT_KIND_COMMIT:
      case OBJECT_KIND_TAG:
      {
        const shown = await api['git:run'](path, buildHeaderArgs(object.sha), []);
        if (mine !== token)
        {
          return;
        }
        header.value = parseCommitHeader(shown);

        // The parent must be known before the range can be built, so this waits on the
        // header read. A lost commit's parent is routinely lost too; `rangeForSelection`
        // answers `from: null` when there's none, making a lost *root* commit readable here.
        diff.setRange(
          rangeForSelection([object.sha], () => header.value?.parents[0] ?? null)
        );
        break;
      }
      case OBJECT_KIND_TREE:
      {
        const listed = await api['git:run'](path, buildTreeArgs(object.sha), []);
        if (mine !== token)
        {
          return;
        }
        entries.value = parseTreeEntries(listed);
        break;
      }
      default:
      {
        const size = await api['git:run'](path, buildSizeArgs(object.sha), []);
        if (mine !== token)
        {
          return;
        }
        blobBytes.value = Number(size.trim()) || 0;

        const contents = await api['git:run'](path, buildBlobArgs(object.sha), []);
        if (mine !== token)
        {
          return;
        }
        blobText.value = contents;
        break;
      }
    }
  }
  catch (err)
  {
    if (mine !== token)
    {
      return;
    }
    // A `missing` object is exactly this case: fsck named it because it's *not* there, so git's own "unable to read" is the honest answer.
    error.value = toMessage(err);
  }
  finally
  {
    if (mine === token)
    {
      loading.value = false;
    }
  }
}

watch(() => [props.object?.sha, props.repoPath] as const, () => void load(), { immediate: true });

const when = computed(() =>
{
  const date = header.value?.date;
  if (date)
  {
    return formatCommitDate(date, settings.settings.dateFormat);
  }
  else
  {
    return null;
  }
});

const blobLines = computed(() =>
{
  if (blobText.value)
  {
    return blobText.value.split('\n').length;
  }
  else
  {
    return 0;
  }
});

/** How the file list says what a row is, without spending a column on the word. */
function entryGlyph(entry: TreeEntry): string
{
  if (entry.kind === OBJECT_KIND_TREE)
  {
    return '📁';
  }
  if (entry.kind === OBJECT_KIND_COMMIT)
  {
    return '🔗';
  }
  if (isExecutableMode(entry.mode))
  {
    return '⚙️';
  }
  else
  {
    return '📄';
  }
}
</script>

<template>
  <div class="lost-object">
    <p v-if="!props.object" class="placeholder">
      Pick an object on the left to see what it is.
    </p>

    <template v-else>
      <p class="state" :class="{ warn: props.object.state === STATE_MISSING }">
        <CodeText :text="explainState(props.object)" />
      </p>

      <p v-if="error" class="error">{{ error }}</p>

      <!-- A commit: what it says, then the files it changed and the diff for one of them. -->
      <template v-else-if="isCommit">
        <div v-if="header" class="commit">
          <p class="subject">{{ header.subject || '(no message)' }}</p>
          <dl class="meta">
            <dt>Author</dt>
            <dd class="truncate">{{ header.author }} &lt;{{ header.email }}&gt;</dd>
            <template v-if="when">
              <dt>Date</dt>
              <dd class="truncate">{{ when }}</dd>
            </template>
            <dt>{{ props.object.kind === OBJECT_KIND_TAG ? 'Tag' : 'Commit' }}</dt>
            <dd><code class="selectable">{{ props.object.sha }}</code></dd>
            <template v-if="header.parents.length">
              <dt>{{ header.parents.length === 1 ? 'Parent' : 'Parents' }}</dt>
              <dd>
                <code v-for="sha in header.parents" :key="sha" class="selectable parent">
                  {{ shortSha(sha) }}
                </code>
              </dd>
            </template>
          </dl>
          <p v-if="header.body" class="message">{{ header.body }}</p>
        </div>

        <RepoFilePanes />
      </template>

      <!-- A tree: the file list it is. -->
      <template v-else-if="isTree">
        <!-- Counts wait for the read that produces them: this line says "0 entries" for
             as long as git takes to answer, wrong rather than merely stale. -->
        <p class="count">
          {{ loading ? 'Reading…' : `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}` }}
        </p>
        <ul v-if="entries.length" class="entries">
          <li v-for="entry in entries" :key="entry.sha + entry.name">
            <span class="glyph">{{ entryGlyph(entry) }}</span>
            <span class="name truncate">{{ entry.name }}</span>
            <code class="entry-sha">{{ shortSha(entry.sha) }}</code>
          </li>
        </ul>
        <p v-else-if="!loading" class="placeholder">This directory is empty.</p>
      </template>

      <!-- A blob: a file with no name, so its size and its contents are all there is. -->
      <p v-else-if="isBlob" class="count">
        <template v-if="loading">Reading…</template>
        <template v-else>
          {{ formatBytes(blobBytes) }}
          <template v-if="!binary && blobLines">
            · {{ blobLines }} {{ blobLines === 1 ? 'line' : 'lines' }}
          </template>
          · a {{ kindNoun('blob') }} whose name is not recorded anywhere
        </template>
      </p>

      <!-- No "this commit changed nothing" line: `ChangedFiles` says that itself, so a copy here is one to keep in step for no gain. -->
      <p v-if="isBlob && binary" class="placeholder">
        This is not text, so there is nothing readable to show. Save to
        <code>.git/lost-found</code> to get the file itself.
      </p>
    </template>

    <!-- One pane, mounted always: an element that doesn't exist at `onMounted` never
         gets an editor, so it lives outside every branch rather than once per branch. -->
    <div ref="paneHost" class="pane" :class="{ blank: !paneContent, gone: !wantsPane }" />
  </div>
</template>

<style scoped>
.lost-object {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-height: 0;
  flex: 1;
}

.state,
.count {
  flex: none;
  font-size: var(--text-sm);
  color: var(--fg-muted);
}

/* The commit's own words: a block sized to what it holds. The *message* is capped and
 * scrolls, not the card, so subject and metadata stay on screen whatever the message does. */
.commit {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-subtle);
}

.subject {
  flex: none;
  font-weight: 600;
  font-size: var(--text-md);
  color: var(--fg);
}

/*
 * The message as written: a commit body is laid out by hand, and reflowing it would
 * lose the columns and blank lines that layout is made of. `.message`, not `.body`:
 * `DialogFrame` already owns `.body` for its scrolling region.
 *
 * Capped and scrolled here, not left to absorb the card's overflow as a shrinking flex
 * item, which measured 0px tall: the message is the only item that *can* shrink. Six
 * lines: enough to recognise the commit, little enough that the patch still clears its 120px floor.
 */
.message {
  flex: none;
  max-height: 6lh;
  overflow-y: auto;
  white-space: pre-wrap;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--fg-muted);
}

.meta {
  flex: none;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px var(--space-3);
  font-size: var(--text-sm);
  min-width: 0;
}

.meta dt {
  color: var(--fg-subtle);
}

.meta dd {
  min-width: 0;
  color: var(--fg-muted);
}

.meta code {
  font-family: var(--font-mono);
}

.parent + .parent {
  margin-left: var(--space-2);
}

.entries {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-subtle);
  /* There is no `ul` reset in `global.css`, so the marker column is still the default 40px
     of indent in front of every name. */
  list-style: none;
  padding: var(--space-1) 0;
}

.entries li {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 3px var(--space-2);
  min-width: 0;
}

.glyph {
  flex: none;
  font-size: var(--text-sm);
}

.name {
  flex: 1;
  min-width: 0;
}

.entry-sha {
  flex: none;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--fg-subtle);
}

/* Stays mounted always, hidden by opacity rather than removed by `v-if`:
 * `useReadOnlyEditor` creates its editor in `onMounted`, and an element that doesn't exist then never gets one. */
.pane {
  flex: 1;
  min-height: 120px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

/* Has a pane, nothing in it yet: keep the space, so the window does not jump as it loads. */
.pane.blank {
  opacity: 0;
  pointer-events: none;
}

/* No pane for this kind at all: a tree is a list, and the list should have the room. */
.pane.gone {
  display: none;
}
</style>
