/**
 * Settings pages table-driven: adding a page is an entry here, not a branch in the
 * renderer. Label is both sidebar row and heading, so they can't disagree.
 */

import type { Component } from 'vue';
import AppearanceSection from './AppearanceSection.vue';
import GitSection from './GitSection.vue';
import GitConfigSection from './GitConfigSection.vue';
import RevisionsSection from './RevisionsSection.vue';
import RefsSection from './RefsSection.vue';
import GraphSection from './GraphSection.vue';
import AdvancedSection from './AdvancedSection.vue';
import FilesSection from './FilesSection.vue';
import ConfirmationsSection from './ConfirmationsSection.vue';
import DiffSection from './DiffSection.vue';

export interface SettingsPage {
  id: string;
  label: string;
  component: Component;
}

export const SETTINGS_PAGES: SettingsPage[] = [
  { id: 'appearance', label: 'Appearance', component: AppearanceSection },
  { id: 'git', label: 'Git', component: GitSection },
  // Own page: app prefs vs git config. Scope selector between them would be confusing.
  { id: 'gitConfig', label: 'Git Config', component: GitConfigSection },
  { id: 'revisions', label: 'Revisions', component: RevisionsSection },
  { id: 'refs', label: 'Refs', component: RefsSection },
  { id: 'graph', label: 'Graph', component: GraphSection },
  { id: 'files', label: 'Files', component: FilesSection },
  { id: 'diff', label: 'Diff', component: DiffSection },
  { id: 'confirmations', label: 'Confirmations', component: ConfirmationsSection },
  { id: 'advanced', label: 'Advanced', component: AdvancedSection }
];
