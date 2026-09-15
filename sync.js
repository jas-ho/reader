import {translator} from './locale.js';
import {flatten, unflatten} from './state.js';

// Optional integration, loaded only by an instance that configures it. The sync
// provider sees wire state, so the legacy codec stays at the reader boundary.
export async function attachSync(config, page, mount, baseURL, language = 'en') {
  const t = translator(language);
  const script = document.createElement('script');
  script.src = new URL(config.script, baseURL).href;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error(t('syncUnavailable'))), 5000);
    script.onload = () => { clearTimeout(timeout); resolve(); };
    script.onerror = () => { clearTimeout(timeout); reject(Error(t('syncUnavailable'))); };
    document.head.append(script);
  });
  if (!(window.jashoSync?.build >= 2) || typeof window.jashoSync.attach !== 'function') throw Error(t('syncUpgrade'));
  window.jashoSync.attach({site: config.site, importFrom: config.importFrom, mount, flatten, unflatten, page, language});
}
