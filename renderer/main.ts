import { createApp } from 'vue';
import { installDiagnostics } from '@renderer/diagnostics.js';
import { createPinia } from 'pinia';
import App from './App.vue';
import { api } from './api.js';
import { setDateLocale } from './format.js';
import './styles/global.css';

// Set locale before mount: grid draws dates on first frame. If it fails, Intl's
// default is still usable, and there's no UI yet for a toast.
try
{
  setDateLocale(await api['env:locale']());
}
catch
{
  // Silently fail: no UI to toast into yet.
}

// Before the mount: a component that throws while setting up is exactly the
// failure worth having in the timeline.
installDiagnostics();

createApp(App).use(createPinia()).mount('#app');
