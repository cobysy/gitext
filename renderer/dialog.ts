import { createApp } from 'vue';
import { installDiagnostics } from '@renderer/diagnostics.js';
import { createPinia } from 'pinia';
import { THEME_DARK, THEME_LIGHT } from '@shared/types.js';
import DialogHost from './components/DialogHost.vue';
import { api } from './api.js';
import { setDateLocale } from './format.js';
import './styles/global.css';

const QUERY_PARAM_THEME = 'theme';

// Set theme before anything is drawn (query string, not IPC, to avoid white flash).
const theme = new URLSearchParams(window.location.search).get(QUERY_PARAM_THEME);
if (theme === THEME_DARK || theme === THEME_LIGHT)
{
  document.documentElement.dataset.theme = theme;
}

// Window is the dialog surface, use overlay background (not app bg).
document.body.classList.add('dialog-window');

// Dialog is its own renderer process: own Pinia, locale, theme. Nothing inherited or reaching back.
try
{
  setDateLocale(await api['env:locale']());
}
catch
{
  // Nothing to report to: there is no UI yet to put a toast in.
}

// macOS keeps window traffic lights; elsewhere header draws own close button.
if (navigator.userAgent.includes('Macintosh'))
{
  document.body.classList.add('mac');
}

// Before the mount: a component that throws while setting up is exactly the
// failure worth having in the timeline.
installDiagnostics();

createApp(DialogHost).use(createPinia()).mount('#dialog');
