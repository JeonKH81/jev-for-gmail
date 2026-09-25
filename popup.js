const on = document.getElementById('on');
const msg = document.getElementById('msg');
const t = (key, substitutions) => chrome.i18n.getMessage(key, substitutions) || key;
document.documentElement.lang = chrome.i18n.getUILanguage().toLowerCase().startsWith('ko') ? 'ko' : 'en';
document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
chrome.storage.local.get('__jev_enabled').then(v => { on.checked = v.__jev_enabled !== false; });
on.addEventListener('change', () => chrome.storage.local.set({ __jev_enabled: on.checked }));
document.getElementById('clear').addEventListener('click', async () => {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(k => k.startsWith('#'));
  await chrome.storage.local.remove(keys);
  msg.textContent = t('cacheCleared', String(keys.length));
});

document.getElementById('opts').addEventListener('click', () => chrome.runtime.openOptionsPage());
chrome.storage.local.get('__jev_cfg').then(v => { if (!v.__jev_cfg?.apiKey) msg.textContent = t('configureApiKeyFirst'); });
