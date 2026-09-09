<script setup lang="ts">
/**
 * Change a commit's message only. CommitSummary fixed (not picker): prefilled from this commit.
 * Checks: ancestor of HEAD, not a merge, resolves (early failure, not git refusing mid-rebase).
 */

import { computed, ref, watch } from 'vue';
import { api, toMessage } from '@renderer/api.js';
import { buildRewordSteps } from '@renderer/model/args/reword.js';
import { useDialog } from '@renderer/composables/useDialog.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import CommandPreview from '@renderer/components/transparency/CommandPreview.vue';
import DangerNote from '@renderer/components/ui/DangerNote.vue';
import DialogFrame from '@renderer/components/ui/DialogFrame.vue';
import FormTextArea from '@renderer/components/ui/FormTextArea.vue';
import CommitSummary from './parts/CommitSummary.vue';
import { HISTORY_MOVE } from '@shared/invalidation.js';
import { HEAD_REF } from '@renderer/model/sha.js';

const props = defineProps<{ sha: string }>();
const emit = defineEmits<{ close: [] }>();


const { busy, error, runSteps } = useDialog();
const repo = useRepoStore();

const message = ref('');
/** The commit's subject as it is *now*: what the `amend! ` marker has to name. */
const subject = ref('');
const isHead = ref(false);
/** Why this commit cannot be reworded, or null. Empty until the reads have answered. */
const blocker = ref<string | null>(null);
const loaded = ref(false);

/**
 * Everything the form needs about the operand, in one pass.
 *
 * Read here rather than carried in the payload for the usual reason: a dialog is a window
 * of its own, and a subject or a message copied into the payload would be whatever was
 * true when the menu was opened. The message in particular is the thing being edited:
 * opening on a stale copy would silently discard whatever changed it in between.
 */
watch(
  () => props.sha,
  async (sha) =>
  {
    loaded.value = false;
    blocker.value = null;
    const path = repo.repo?.path;
    if (!sha || !path)
    {
      blocker.value = 'No commit was named.';
      loaded.value = true;
      return;
    }

    try
    {
      const [commit, head, parents, ancestor, body] = await Promise.all([
        api['repo:revision'](path, sha),
        api['repo:revision'](path, HEAD_REF),
        api['repo:parents'](path, sha),
        api['repo:isAncestor'](path, sha, HEAD_REF),
        api['repo:commitMessage'](path, sha)
      ]);
      // The operand can change while git is answering.
      if (props.sha !== sha)
      {
        return;
      }

      if (!commit)
      {
        blocker.value = 'That commit no longer exists in this repository.';
      }
      else if (parents.length > 1)
      {
        blocker.value =
          'A merge commit. Rewording one means rebasing across it.';
      }
      else if (!ancestor)
      {
        blocker.value =
          'Not on the current branch. Check out a branch that contains it first.';
      }

      subject.value = commit?.subject ?? '';
      isHead.value = commit !== null && head !== null && commit.sha === head.sha;
      message.value = body;
    }
    catch (e)
    {
      blocker.value = toMessage(e);
    }
    finally
    {
      loaded.value = true;
    }
  },
  { immediate: true }
);

const steps = computed(() =>
{
  if (blocker.value)
  {
    return [];
  }
  else
  {
    return buildRewordSteps({
      sha: props.sha,
      subject: subject.value,
      message: message.value,
      isHead: isHead.value
    });
  }
}
);

/** True once the box says something other than what the commit already says. */
const changed = computed(() => steps.value.length > 0);
</script>

<template>
  <DialogFrame title="Reword Commit" @close="emit('close')">
    <div class="form">
      <CommitSummary :rev="props.sha" />

      <DangerNote v-if="blocker">{{ blocker }}</DangerNote>

      <template v-else>
        <FormTextArea
          v-model="message"
          label="Message"
          :rows="8"
          :disabled="!loaded"
          placeholder="The commit message"
          hint="The whole message; the first line is the subject."
        />

        <!-- The sentence the two-command case turns on. Only for a commit below HEAD:
             amending HEAD rewrites nothing else, and a warning shown every time is one
             nobody reads on the occasion it matters. -->
        <DangerNote v-if="loaded && !isHead" tone="warning">
          Every commit after it gets a new SHA. A pushed branch needs a force push.
        </DangerNote>
      </template>

      <CommandPreview :steps="steps" placeholder="Change the message to see the commands" />
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <template #actions>
      <button @click="emit('close')">Cancel</button>
      <button class="primary" :disabled="!changed || busy" @click="runSteps(steps, HISTORY_MOVE)">
        {{ busy ? 'Rewording…' : 'Reword' }}
      </button>
    </template>
  </DialogFrame>
</template>
