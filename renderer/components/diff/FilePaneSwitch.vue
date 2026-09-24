<script setup lang="ts">
/**
 * The switch in a file pane's header: the diff, the file whole, or who wrote each line.
 * Every pane that answers the question draws the same control in the same place, so the
 * three of them share this rather than each writing out the switch and its glyphs.
 *
 * The glyphs come from a table keyed by command id: a fourth answer is a row here and a
 * row in `filePaneViewMenu`, never a branch in three templates.
 */

import { computed } from 'vue';
import { runCommand } from '@renderer/commands/registry.js';
import { useCommandContext } from '@renderer/composables/useCommands.js';
import { filePaneViewMenu } from '@renderer/menus/fileList.js';
import { resolveMenu, resolvedCommands } from '@renderer/menus/resolve.js';
import SegmentedSwitch from '@renderer/components/ui/SegmentedSwitch.vue';
import Glyph from '@renderer/components/ui/Glyph.vue';
import type { GlyphName } from '@renderer/components/ui/glyphs.js';

const GLYPH_FOR_VIEW: Record<string, GlyphName> = {
  'files.viewDiff': 'diffFile',
  'files.viewContents': 'textFile',
  'files.viewBlame': 'blameFile'
};

const commandContext = useCommandContext();

const items = computed(() =>
  resolvedCommands(resolveMenu(filePaneViewMenu, commandContext.value))
);

function glyphFor(id: string): GlyphName
{
  return GLYPH_FOR_VIEW[id] ?? 'textFile';
}

function onRun(id: string): void
{
  void runCommand(id, commandContext.value);
}
</script>

<template>
  <SegmentedSwitch :items="items" @run="onRun">
    <template #icon="{ id }">
      <Glyph :name="glyphFor(id)" />
    </template>
  </SegmentedSwitch>
</template>
