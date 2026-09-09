<script setup lang="ts">
/**
 * Command preview strip: show argv (one command) or steps (multi-command operations).
 */

import { computed, ref } from 'vue';
import { copyText } from '@renderer/clipboard.js';

const props = defineProps<{
  /** The argv to display: exactly what will be handed to git. */
  argv?: string[];
  /** The argvs `runSteps` will walk, for an operation that is several commands. */
  steps?: { argv: string[] }[];
  /** Shown instead of a command when the form is incomplete. */
  placeholder?: string;
}>();

const copied = ref(false);

/**
 * POSIX-quote an argument for display and for pasting into a shell.
 *
 * `~` is safe everywhere except as the first character, where a shell would expand it to
 * a home directory: so `HEAD~1` is shown as typed and `~/repo` is still quoted. It is
 * worth the extra clause because revision expressions are the arguments people read most
 * often here, and `'HEAD~1'` is noise around the one part of the command that carries the
 * meaning. `^` stays quoted: it is a pipe operator in cmd.exe.
 */
function quote(arg: string): string
{
  if (arg.length > 0 && /^[A-Za-z0-9_@%+=:,./-][A-Za-z0-9_@%+=:,./~-]*$/.test(arg))
  {
    return arg;
  }
  return `'${arg.replaceAll("'", `'\\''`)}'`;
}

/** Both props normalize to the same thing: the list of commands about to run. */
const commands = computed(() =>
{
  let fromArgv: { argv: string[] }[];
  if (props.argv)
  {
    fromArgv = [{ argv: props.argv }];
  }
  else
  {
    fromArgv = [];
  }
  return (props.steps ?? fromArgv)
    .filter((step) => step.argv.length > 0)
    .map((step) => `git ${step.argv.map(quote).join(' ')}`);
});

/** What the copy button puts on the clipboard: the whole plan, one command per line. */
const command = computed(() => commands.value.join('\n'));

async function copy(): Promise<void>
{
  if (!command.value)
  {
    return;
  }
  // The button's own tick is the confirmation, so no toast on success. A failure still
  // toasts: a copy that quietly did nothing is only discovered at the paste.
  if (!(await copyText(command.value, null)))
  {
    return;
  }
  copied.value = true;
  setTimeout(() => (copied.value = false), 1200);
}
</script>

<template>
  <div class="preview" :class="{ empty: !command }">
    <!-- The prompt only appears when there is a command behind it. This strip is the
         app's promise that what you read is what will run, so a `$` in front of an
         instruction ("Stage something and write a message") breaks the one rule the
         component exists to keep. -->
    <span v-if="commands.length" class="prompt" aria-hidden="true">$</span>
    <div v-if="commands.length" class="cmd">
      <code v-for="(line, index) in commands" :key="index" class="line selectable">{{
        line
      }}</code>
    </div>
    <span v-else class="cmd muted">{{ placeholder ?? 'Nothing to run yet' }}</span>
    <!-- A glyph, not the word: this strip is a command line, and a button labelled "Copy"
         in the middle of one reads as part of the command. Two sheets for the idle state,
         a tick for the moment after: the label survives as the tooltip and the accessible
         name, which is where a screen reader looks for it anyway. -->
    <button
      v-if="command"
      class="copy"
      :class="{ done: copied }"
      :title="copied ? 'Copied' : 'Copy as shell command'"
      :aria-label="copied ? 'Copied' : 'Copy as shell command'"
      @click="copy"
    >
      <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none"
           stroke="currentColor" stroke-width="1.3" stroke-linecap="round"
           stroke-linejoin="round">
        <path v-if="copied" d="M3 8.4 6.4 12 13 4.6" />
        <g v-else>
          <rect x="5.6" y="5.6" width="8" height="8" rx="1.2" />
          <path d="M10.4 3.4V3.6a1.2 1.2 0 0 0-1.2-1.2H3.6a1.2 1.2 0 0 0-1.2 1.2v5.6a1.2 1.2 0 0 0 1.2 1.2h.2" />
        </g>
      </svg>
    </button>
  </div>
</template>

<style scoped>
.preview {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: var(--bg-subtle);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  min-height: 32px;
}

.prompt {
  color: var(--fg-subtle);
  flex: none;
}

.cmd {
  flex: 1;
  /* Long commands wrap rather than forcing the dialog wider. */
  word-break: break-all;
  line-height: 1.5;
  /*
   * And a long *argument* scrolls rather than forcing the dialog taller.
   *
   * Found by opening the reword dialog on a commit with a real body: the message is one
   * argv entry, so the strip grew to forty lines, dwarfed the form it belongs under and
   * pushed the buttons off the window. Latent everywhere else for the same reason: a tag
   * annotation and a stash message are arguments somebody types paragraphs into.
   *
   * Seven lines, which every multi-step plan in the app fits inside, so nothing that
   * exists today starts scrolling. Nothing is hidden: the text is all here, still
   * selectable, and the copy button still takes the whole command.
   */
  max-height: 10.5em;
  overflow-y: auto;
}

/* A step per line: a plan reads as the sequence it is, not as one run-on command. */
.line {
  display: block;
}

/* Not a command, so not the command face: prose, in the app's own text font. Italic
   monospace behind a `$` reads as something git would accept. */
.muted {
  color: var(--fg-subtle);
  font-family: var(--font-ui);
  font-style: normal;
}

/* Square, because it holds a square glyph, and quiet, because it is chrome beside the
   thing the strip exists to show. */
.copy {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-1);
  background: none;
  border-color: transparent;
  color: var(--fg-subtle);
}

.copy:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--fg);
}

/* The tick is confirmation, so it says so in the colour the app uses for that. */
.copy.done {
  color: var(--success);
}
</style>
