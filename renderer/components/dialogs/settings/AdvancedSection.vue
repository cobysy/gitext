<script setup lang="ts">
/** Settings trading safety or feedback for speed. */

import FormNumber from '@renderer/components/ui/FormNumber.vue';
import FormCheck from '@renderer/components/ui/FormCheck.vue';
import { flag, number } from './fields.js';

const commandLogDepth = number('commandLogDepth');
const redactDiagnostics = flag('redactDiagnostics');
const repoFactsInDialogs = flag('repoFactsInDialogs');
const streamLiveOutput = flag('streamLiveOutput');
const commandOutputAutoClose = flag('commandOutputAutoClose');
const commandOutputAutoCloseSeconds = number('commandOutputAutoCloseSeconds');
const checkoutAlwaysShowDialog = flag('checkoutAlwaysShowDialog');
const checkoutUseDefaultLocalChanges = flag('checkoutUseDefaultLocalChanges');
const autoStashUntracked = flag('autoStashUntracked');
const normaliseBranchNames = flag('normaliseBranchNames');
</script>

<template>
  <div class="form">
    <FormNumber
      v-model="commandLogDepth"
      label="Command log depth"
      :min="50"
      :max="5000"
      :step="50"
      hint="How many git invocations to keep in the command log."
    />
    <FormCheck
      v-model="redactDiagnostics"
      label="Scrub saved diagnostics"
      hint="Removes your home path, remote credentials and message bodies."
    />
    <FormCheck
      v-model="repoFactsInDialogs"
      label="Read ahead/behind counts in dialogs"
      hint="A revision walk per branch: slow on a big repository."
    />
    <FormCheck
      v-model="streamLiveOutput"
      label="Show git output in a console window"
      hint="Every operation, as it runs. `gc` always does."
    />
    <FormCheck
      v-model="commandOutputAutoClose"
      label="Close the console when it succeeds"
      hint="A failed command's console always stays open."
    />
    <FormNumber
      v-model="commandOutputAutoCloseSeconds"
      label="Close it after"
      :min="0"
      :max="60"
      :step="1"
      hint="Seconds to leave a successful console up. The Close button counts down."
    />
    <FormCheck
      v-model="checkoutAlwaysShowDialog"
      label="Always show the checkout dialog"
      hint="On, every checkout is confirmed first."
    />
    <FormCheck
      v-model="checkoutUseDefaultLocalChanges"
      label="Use my Local changes choice without asking"
      hint="Answers the checkout dialog's Local changes for you."
    />
    <FormCheck
      v-model="autoStashUntracked"
      label="Include untracked files"
      hint="`stash push -u`"
    />
    <FormCheck
      v-model="normaliseBranchNames"
      label="Tidy typed branch names"
      hint="A space becomes an underscore, and so on."
    />
  </div>
</template>
