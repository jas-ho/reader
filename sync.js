import {flatten, unflatten} from './state.js';

// Optional integration, loaded only by an instance that configures it. The sync
// provider sees wire state, so the legacy codec stays at the reader boundary.
export async function attachSync(config, page, mount, baseURL) {
  const script = document.createElement('script');
  script.src = new URL(config.script, baseURL).href;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Sync is unavailable. Notes still save in this browser.')), 5000);
    script.onload = () => { clearTimeout(timeout); resolve(); };
    script.onerror = () => { clearTimeout(timeout); reject(Error('Sync is unavailable. Notes still save in this browser.')); };
    document.head.append(script);
  });
  if (!(window.jashoSync?.build >= 2) || typeof window.jashoSync.attach !== 'function') throw Error('Sync client build 2 or later is required. Notes still save in this browser.');
  window.jashoSync.attach({site: config.site, importFrom: config.importFrom, mount, flatten, unflatten, page});
}
