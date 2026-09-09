<script setup lang="ts">
/**
 * The command log panel (§8).
 *
 * Lists every git subprocess the app has run: foreground actions and background
 * polling alike: with its exact argv, exit code, duration, and output.
 */

import { ref, useTemplateRef, watch } from 'vue';
import { copyText } from '@renderer/clipboard.js';
import { MAX_RECORD_OUTPUT, type GitCommandRecord } from '@shared/types.js';
import { useFollowTail } from '@renderer/composables/useFollowTail.js';
import { useCommandLogStore } from '@renderer/stores/commandLog.js';
import OutputPane from './OutputPane.vue';

const store = useCommandLogStore();
const expanded = ref(new Set<number>());
const listEl = useTemplateRef<HTMLElement>('listEl');
// A row is taller than the pane's two pixels: near enough to the last one counts as at it.
const { onScroll, stick } = useFollowTail(listEl, 24);

function quote(arg: string): string
{
  if (arg.length > 0 && /^[A-Za-z0-9_@%+=:,./-]+$/.test(arg))
  {
    return arg;
  }
  return `'${arg.replaceAll("'", `'\\''`)}'`;
}

function asShell(record: GitCommandRecord): string
{
  return `git ${record.argv.map(quote).join(' ')}`;
}

function toggle(id: number): void
{
  if (expanded.value.has(id))
  {
    expanded.value.delete(id);
  }
  else
  {
    expanded.value.add(id);
  }
  // Set mutation is not deeply reactive; reassign to trigger the update.
  expanded.value = new Set(expanded.value);
  // Opening the newest row puts its output below the fold; the tail is where it is.
  void stick();
}

/**
 * What is said in place of output a record did not keep.
 *
 * A log stream over a large history is megabytes of NUL-separated text; the record holds
 * the first `MAX_RECORD_OUTPUT` of it and says how much there was. Saying so matters more
 * here than anywhere else in the app: this panel's promise is that what it shows is what
 * ran, and silently showing the first part of the output would break it.
 */
function truncatedNote(total: number): string
{
  return `Showing the first ${MAX_RECORD_OUTPUT.toLocaleString()} of ${total.toLocaleString()} characters.`;
}

function statusOf(record: GitCommandRecord): 'running' | 'ok' | 'fail'
{
  if (record.running)
  {
    return 'running';
  }
  if (record.exitCode === 0)
  {
    return 'ok';
  }
  else
  {
    return 'fail';
  }
}

async function copy(record: GitCommandRecord): Promise<void>
{
  await copyText(asShell(record), 'the command');
}

/**
 * What stands in for output a command has not produced. A command still running has
 * said nothing *yet*, which is a different fact from one that ran and printed nothing.
 */
function emptyNote(record: GitCommandRecord): string
{
  if (record.running)
  {
    return 'Waiting for output…';
  }
  return 'No output.';
}

/**
 * Keep the newest entry in view unless the user has scrolled up to read something: on a
 * new command, and on each republish of the last one, whose output grows as it runs.
 * An array of getters, never one getter returning an array: the second compares by
 * identity, and a record is a fresh object each time it is published.
 */
watch([() => store.filtered.length, () => store.filtered.at(-1)], stick);
</script>

<template>
  <section class="panel">
    <header class="bar">
      <span class="title">Git command log</span>
      <span class="count">{{ store.filtered.length }} of {{ store.records.length }}</span>
      <span v-if="store.failureCount" class="failures">{{ store.failureCount }} failed</span>

      <label class="toggle">
        <input v-model="store.failedOnly" type="checkbox" />
        Failed only
      </label>
      <label class="toggle">
        <input v-model="store.hideReads" type="checkbox" />
        Hide background reads
      </label>

      <div class="spacer" />
      <button @click="store.clear()">Clear</button>
      <button title="Close panel" @click="store.toggle()">✕</button>
    </header>

    <div ref="listEl" class="list" @scroll="onScroll">
      <p v-if="!store.filtered.length" class="empty">
        No commands yet. Every git process appears here.
      </p>

      <article
        v-for="record in store.filtered"
        :key="record.id"
        class="row"
        :class="statusOf(record)"
      >
        <div class="head" @click="toggle(record.id)">
          <span class="dot" :class="statusOf(record)" />
          <code class="cmd selectable">{{ asShell(record) }}</code>
          <span class="meta">
            <span v-if="record.running">running…</span>
            <template v-else>
              <span v-if="record.exitCode !== 0" class="code">exit {{ record.exitCode }}</span>
              <span>{{ record.durationMs }} ms</span>
            </template>
          </span>
          <button class="copy" title="Copy as shell command" @click.stop="copy(record)">
            Copy
          </button>
        </div>

        <div v-if="expanded.has(record.id)" class="detail">
          <dl>
            <dt>Directory</dt>
            <dd class="selectable">{{ record.cwd }}</dd>
            <dt>Full argv</dt>
            <dd class="selectable">git {{ record.fullArgv.map(quote).join(' ') }}</dd>
          </dl>
          <OutputPane v-if="record.stdout" :text="record.stdout" follow class="out" />
          <p v-if="record.stdoutBytes" class="out-note">{{ truncatedNote(record.stdoutBytes) }}</p>
          <OutputPane
            v-if="record.stderr"
            :text="record.stderr"
            :failed="statusOf(record) === 'fail'"
            follow
            class="out"
          />
          <p v-if="record.stderrBytes" class="out-note">{{ truncatedNote(record.stderrBytes) }}</p>
          <p v-if="record.spawnError" class="out-note failed">{{ record.spawnError }}</p>
          <p v-if="!record.stdout && !record.stderr" class="out-note">
            {{ emptyNote(record) }}
          </p>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped src="@renderer/styles/paneBar.css"></style>
<style scoped src="@renderer/styles/factList.css"></style>
<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg);
  border-top: 1px solid var(--border);
  min-height: 0;
}

.bar {
  gap: var(--space-3);
  padding: var(--space-1) var(--space-3);
}

.title {
  font-weight: 600;
  font-size: var(--text-sm);
}

.count,
.failures {
  font-size: var(--text-xs);
  color: var(--fg-muted);
}

.failures {
  color: var(--danger);
}

.toggle {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-xs);
  color: var(--fg-muted);
}

.list {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.empty {
  padding: var(--space-4);
  color: var(--fg-subtle);
  font-size: var(--text-sm);
  text-align: center;
}

.row {
  border-bottom: 1px solid var(--border-subtle);
}

.head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-3);
}

.head:hover {
  background: var(--bg-hover);
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: none;
  background: var(--fg-subtle);
}

.dot.ok {
  background: var(--success);
}

.dot.fail {
  background: var(--danger);
}

.dot.running {
  background: var(--warning);
}

.cmd {
  flex: 1;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row.fail .cmd {
  color: var(--danger);
}

.meta {
  display: flex;
  gap: var(--space-2);
  font-size: var(--text-xs);
  color: var(--fg-muted);
  flex: none;
}

.code {
  color: var(--danger);
}

.copy {
  font-size: var(--text-xs);
  padding: 1px var(--space-2);
  flex: none;
}

.detail {
  padding: var(--space-2) var(--space-3) var(--space-3) var(--space-5);
  background: var(--bg-subtle);
  font-size: var(--text-sm);
}

/* A little air under it: this one sits above the command's output, not on its own. */
dl {
  margin-bottom: var(--space-2);
}

/* Smaller than the About window's: this list repeats once per logged command. */
dt {
  font-size: var(--text-xs);
}

/* The shared output pane, dressed for this panel: denser than the console window's,
   and lighter than `.detail`'s own ground so it reads as a box rather than as more of
   the row. */
.out {
  margin: 0 0 var(--space-2);
  background: var(--bg);
  border-color: var(--border-subtle);
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  max-height: 240px;
}

/* A line *about* the output rather than the output itself: how much was cut, why the
   command never started, or that it printed nothing. */
.out-note {
  margin: 0 0 var(--space-2);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--fg-subtle);
  font-style: italic;
}

.out-note.failed {
  color: var(--danger);
  font-style: normal;
}
</style>
