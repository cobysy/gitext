<script setup lang="ts">
/**
 * Commit details pane: mostly renders grid data. Only git note fetches extra (per-commit).
 */

import { computed } from 'vue';
import {
  REF_KIND_REMOTE,
  REF_KIND_TAG,
  type CommitRef
} from '@shared/types.js';
import RefChip from '@renderer/components/ui/RefChip.vue';
import {
  artificialKind,
  countChanges,
  describeChanges,
  filesFor,
  ROW_KIND_INDEX,
  ROW_KIND_WORKING_TREE
} from '@shared/artificial.js';
import { formatAbsoluteDate, formatAuthorName, formatRelativeDate, shortSha } from '@renderer/format.js';
import { refsAtHead } from '@renderer/model/refsAtHead.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useRevisionsStore } from '@renderer/stores/revisions.js';
import { useSelectionStore } from '@renderer/stores/selection.js';
import { useSettingsStore } from '@renderer/stores/settings.js';
import { copyText as copy } from '@renderer/clipboard.js';
import { useCommitDetailsFetch } from './useCommitDetailsFetch.js';
import { useColorizedBody } from './useColorizedBody.js';

const repo = useRepoStore();
const revisions = useRevisionsStore();
const selection = useSelectionStore();
const settings = useSettingsStore();

const COPY_LABEL_MESSAGE = 'message';

const commit = computed(() =>
{
  if (selection.primary)
  {
    return revisions.commitOf(selection.primary);
  }
  else
  {
    return undefined;
  }
});

/**
 * Its chips, with HEAD's marker re-decided against the branch checked out now: a checkout
 * does not reload the rows these came from. See `refsAtHead`.
 */
const refs = computed(() => refsAtHead(commit.value?.refs ?? [], repo.repo?.branch ?? null));

/** The working-tree or index row, when that is what is selected. */
const artificial = computed(() =>
{
  if (selection.primary)
  {
    return artificialKind(selection.primary);
  }
  else
  {
    return null;
  }
});

/** Its file counts, standing in for the metadata a real commit would have. */
const artificialSummary = computed(() =>
{
  const kind = artificial.value;
  const files = repo.status?.files;
  if (!kind || !files)
  {
    return '';
  }
  return describeChanges(countChanges(filesFor(kind, files))) || 'No changes';
});

/** The note: the one thing that costs an extra git call. */
const { details, error: detailsError } = useCommitDetailsFetch({
  sha: () => selection.primary,
  repoPath: () => repo.repo?.path
});

/** Parents and children, split into what the grid can jump to and what it cannot. */
const parents = computed(() => (commit.value?.parents ?? []).map(describeRef));
const children = computed(() =>
{
  let shas: readonly string[];
  if (selection.primary)
  {
    shas = revisions.childrenOf(selection.primary);
  }
  else
  {
    shas = [];
  }
  return shas.map(describeRef);
});

function describeRef(sha: string): { sha: string; label: string; loaded: boolean }
{
  const kind = artificialKind(sha);
  // A sentinel shortened to `2222222` looks like a corrupt SHA. Name it instead.
  let label: string;
  switch (kind)
  {
    case ROW_KIND_INDEX:
      label = 'Commit index';
      break;
    case ROW_KIND_WORKING_TREE:
      label = 'Working directory';
      break;
    default:
      label = shortSha(sha);
      break;
  }
  return {
    sha,
    label,
    loaded: revisions.rowOf(sha) !== undefined
  };
}

/** What a ref chip is, for its tooltip and its "Copied …" toast. */
function refNoun(kind: CommitRef['kind']): string
{
  switch (kind)
  {
    case REF_KIND_TAG:
      return 'tag';
    case REF_KIND_REMOTE:
      return 'remote branch';
    default:
      return 'branch';
  }
}

/**
 * Subject and body as one string, the way `copy.message` builds it: the pane draws the
 * two apart (the metadata sits between them), but what gets pasted into a ticket is the
 * message whole.
 */
const fullMessage = computed(() =>
{
  const c = commit.value;
  if (!c)
  {
    return '';
  }
  if (c.body)
  {
    return `${c.subject}\n\n${c.body}`;
  }
  else
  {
    return c.subject;
  }
});

/**
 * Copy the whole message. Clicking either half does it, because the subject and the
 * body are one message to the eye even though the metadata sits between them.
 *
 * Unless the click ended a drag: selecting a line of a commit message and copying it is
 * a real thing to want, and overwriting the clipboard the moment the mouse comes up
 * would take the selection away before it could be used.
 */
function copyMessage(): void
{
  const dragged = window.getSelection();
  if (dragged && !dragged.isCollapsed)
  {
    return;
  }
  void copy(fullMessage.value, COPY_LABEL_MESSAGE);
}

/** Follow a parent or child link. The grid scrolls it into view on its own. */
function goTo(sha: string, loaded: boolean): void
{
  if (loaded)
  {
    selection.select(sha);
  }
}

/** How `copy.author` writes a person, so both routes put the same string on the clipboard. */
function person(name: string, email: string): string
{
  return `${name} <${email}>`;
}

/** A different person, not a different date: the dates each have a row of their own. */
const committerDiffers = computed(() =>
{
  const c = commit.value;
  if (!c)
  {
    return false;
  }
  return c.committerName !== c.authorName || c.committerEmail !== c.authorEmail;
});

/** The message body, highlighted as markdown. */
const { html: bodyHtml } = useColorizedBody({
  body: () => commit.value?.body,
  theme: () => settings.effectiveTheme
});

</script>

<template>
  <section class="details">
    <header class="bar">
      <span class="title">Commit</span>
      <span v-if="selection.count > 1" class="multi">
        {{ selection.count }} commits selected
      </span>
      <button
        class="close"
        title="Hide the details pane"
        @click="settings.patch({ showCommitDetails: false })"
      >✕</button>
    </header>

    <p v-if="!commit" class="placeholder">Select a commit to see its details.</p>

    <div v-else class="body">
      <!--
        Plain elements rather than buttons: a `<pre>` cannot live inside a button, and
        the two halves of the message have to behave alike. `copyMessage` stands aside
        for a drag, so the text stays selectable.
      -->
      <div class="subject copyable" title="Copy the full message" @click="copyMessage()">
        {{ commit.subject }}
      </div>

      <div v-if="refs.length" class="refs">
        <RefChip
          v-for="ref in refs"
          :key="ref.name"
          :kind="ref.kind"
          :name="ref.name"
          :current="ref.isCurrent"
          clickable
          :title="`Copy ${refNoun(ref.kind)} name`"
          @click="copy(ref.name, `${refNoun(ref.kind)} name`)"
        />
      </div>

      <dl class="meta">
        <!--
          An artificial row has no object behind it: no SHA to copy, no author, no
          note. What it does have is a file count and the commit it sits on top
          of, so those are what the pane shows.
        -->
        <template v-if="artificial">
          <dt>Changes</dt>
          <dd>{{ artificialSummary }}</dd>
        </template>

        <template v-else>
          <dt>SHA</dt>
          <dd>
            <button class="sha" :title="commit.sha" @click="copy(commit.sha, 'SHA')">
              {{ commit.sha }}
            </button>
          </dd>

          <dt>Author</dt>
          <dd>
            <button
              class="person copyable"
              title="Copy the author"
              @click="copy(person(commit.authorName, commit.authorEmail), 'author')"
            >
              <span
                class="who"
                :title="settings.settings.authorInitials ? commit.authorName : undefined"
              >{{ formatAuthorName(commit.authorName, commit.authorEmail, settings.settings.authorInitials) }}</span>
              <span class="email">&lt;{{ commit.authorEmail }}&gt;</span>
            </button>
          </dd>

          <dt>Author date</dt>
          <dd>
            <span :title="formatRelativeDate(commit.authorDate)">
              {{ formatAbsoluteDate(commit.authorDate) }}
            </span>
          </dd>

          <!--
            Only when it is someone else. The dates have rows of their own below, so this
            row is about the person, and on the great majority of commits that is the
            author again.
          -->
          <template v-if="committerDiffers">
            <dt>Committer</dt>
            <dd>
              <button
                class="person copyable"
                title="Copy the committer"
                @click="copy(person(commit.committerName, commit.committerEmail), 'committer')"
              >
                <span
                  class="who"
                  :title="settings.settings.authorInitials ? commit.committerName : undefined"
                >{{ formatAuthorName(commit.committerName, commit.committerEmail, settings.settings.authorInitials) }}</span>
                <span class="email">&lt;{{ commit.committerEmail }}&gt;</span>
              </button>
            </dd>
          </template>

          <!--
            Always, even when it matches the author date. Which of the two a date is gets
            asked precisely when they have drifted apart: after a rebase or a cherry-pick
           , and a row that appears only sometimes is one you have to think about.
          -->
          <dt>Commit date</dt>
          <dd>
            <span :title="formatRelativeDate(commit.committerDate)">
              {{ formatAbsoluteDate(commit.committerDate) }}
            </span>
          </dd>
        </template>

        <template v-if="parents.length">
          <dt>{{ parents.length > 1 ? 'Parents' : 'Parent' }}</dt>
          <dd class="links">
            <button
              v-for="parent in parents"
              :key="parent.sha"
              class="link"
              :class="{ dead: !parent.loaded }"
              :disabled="!parent.loaded"
              :title="parent.loaded ? parent.sha : `${parent.sha}, not in the loaded history`"
              @click="goTo(parent.sha, parent.loaded)"
            >
              {{ parent.label }}
            </button>
          </dd>
        </template>

        <template v-if="children.length">
          <dt>{{ children.length > 1 ? 'Children' : 'Child' }}</dt>
          <dd class="links">
            <button
              v-for="child in children"
              :key="child.sha"
              class="link"
              :title="child.sha"
              @click="goTo(child.sha, child.loaded)"
            >
              {{ child.label }}
            </button>
          </dd>
        </template>

        <template v-if="detailsError">
          <dt>Note</dt>
          <dd class="error">{{ detailsError }}</dd>
        </template>
      </dl>

      <!--
        Below the metadata, not above it. A merge commit's body runs to dozens of
        lines, and with the message first the SHA and parents were pushed off the
        bottom of a pane this short: the grid row already shows the subject, so the
        metadata is what the pane is actually for.
      -->
      <!-- eslint-disable-next-line vue/no-v-html -- Monaco's own escaping; see `bodyHtml`. -->
      <pre
        v-if="commit.body"
        class="commit-body body-block copyable"
        title="Copy the full message"
        @click="copyMessage()"
        v-html="bodyHtml"
      ></pre>

      <div v-if="details?.note" class="note">
        <div class="note-label">Git note</div>
        <pre class="commit-body">{{ details.note }}</pre>
      </div>
    </div>
  </section>
</template>

<style scoped>
.details {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg);
}

.bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: 26px;
  padding: 0 var(--space-2);
  border-bottom: 1px solid var(--border-subtle);
  font-size: var(--text-xs);
  color: var(--fg-subtle);
}

.title {
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.multi {
  color: var(--fg-muted);
}

.close {
  margin-left: auto;
  background: none;
  border: none;
  color: var(--fg-subtle);
  cursor: default;
  font-size: var(--text-xs);
  padding: 0 var(--space-1);
}

.close:hover {
  color: var(--fg);
}


.body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.subject {
  font-size: var(--text-md);
  font-weight: 600;
}

/*
  Text that copies when clicked. No border or chip: these are paragraphs and names, and
  outlining them would turn the pane into a wall of controls. The hover tint is the
  affordance, and it is drawn outside the text so nothing shifts when it appears.
*/
.copyable {
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  padding: 1px 4px;
  margin: -2px -5px;
  cursor: default;
}

.copyable:hover {
  background: var(--bg-subtle);
  border-color: var(--border);
  color: var(--fg);
}

.person.copyable:hover .email {
  color: var(--fg);
}

/* A button, but it must read as the line of text it replaced. */
.person {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2);
  font: inherit;
  text-align: left;
  background: none;
  color: inherit;
  min-width: 0;
}

/* Commit messages are pre-wrapped text: their line breaks are the author's. */
.commit-body {
  margin: 0;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--fg-muted);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.refs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

/* The chip itself is `RefChip.vue`: `clickable` is what makes it the button that
   copies the name, for the same reason the SHA is one. */

/*
  Baseline, not top: the label is 11px uppercase and the value 12px, and a boxed value
  carries a border and padding on top of that. Only a shared baseline lines all three
  up without a per-row nudge.
*/
.meta {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  align-items: baseline;
  gap: var(--space-1) var(--space-3);
  margin: 0;
  font-size: var(--text-sm);
}

dt {
  color: var(--fg-subtle);
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

dd {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2);
  min-width: 0;
}

.email {
  color: var(--fg-subtle);
  font-size: var(--text-xs);
  font-family: var(--font-mono);
  overflow-wrap: anywhere;
}

.sha,
.link {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  max-width: 100%;
  background: var(--bg-subtle);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  color: var(--fg);
  padding: 1px 5px;
  cursor: default;
}

.sha:hover,
.link:not(:disabled):hover {
  border-color: var(--border);
  color: var(--fg); /* also lifts .link.dead back to --fg on hover */
}

.link.dead {
  color: var(--fg-subtle);
}

/*
  The chip's border and padding sit outside the value column, the way `.copyable`
  draws its hover box, so a boxed SHA starts on the same column as a plain date.
*/
.sha,
.links > .link:first-child {
  margin-left: -6px;
}

.links {
  gap: var(--space-1);
}

.body-block {
  padding-top: var(--space-3);
  border-top: 1px solid var(--border-subtle);
}

.note-label {
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--fg-subtle);
}

.error {
  color: var(--danger);
  font-size: var(--text-xs);
}
</style>
