<script setup lang="ts">
/** How the revision graph is drawn beside the grid. */

import FormCheck from '@renderer/components/ui/FormCheck.vue';
import FormRadioGroup from '@renderer/components/ui/FormRadioGroup.vue';
import FormRow from '@renderer/components/ui/FormRow.vue';
import FormSelect from '@renderer/components/ui/FormSelect.vue';
import { GRAPH_DIM_ALL, GRAPH_DIM_LANES, GRAPH_DIM_NONE } from '@shared/types.js';
import { choice, flag } from './fields.js';

const graphDimNonRelatives = choice('graphDimNonRelatives');
const graphMergeCommonParentLanes = flag('graphMergeCommonParentLanes');
const graphLineWidth = choice('graphLineWidth');

// Radio group (rungs), not checkboxes: greyed text with lit lanes looks broken.
const DIMMING = [
  { value: GRAPH_DIM_NONE, label: 'Nothing' },
  { value: GRAPH_DIM_LANES, label: 'Lanes' },
  { value: GRAPH_DIM_ALL, label: 'Lanes and text' }
];

const LINE_WIDTHS = [
  { value: 'light', label: 'Light' },
  { value: 'normal', label: 'Normal' },
  { value: 'heavy', label: 'Heavy' }
];
</script>

<template>
  <div class="form">
    <FormRow label="Dim non-relatives">
      <FormRadioGroup v-model="graphDimNonRelatives" :options="DIMMING" inline />
    </FormRow>
    <FormCheck
      v-model="graphMergeCommonParentLanes"
      label="Merge lanes having a common parent"
      hint="A merge's incoming line joins a column already heading for the same commit"
    />
    <FormSelect v-model="graphLineWidth" label="Line weight" :options="LINE_WIDTHS" />
  </div>
</template>
