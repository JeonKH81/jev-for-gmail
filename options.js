const $ = id => document.getElementById(id);
const split = s => s.split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
const t = (key, substitutions) => chrome.i18n.getMessage(key, substitutions) || key;

document.documentElement.lang = chrome.i18n.getUILanguage().toLowerCase().startsWith('ko') ? 'ko' : 'en';
document.title = t('optionsTitle');
document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });

chrome.storage.local.get('__jev_cfg').then(({ __jev_cfg: c = {} }) => {
  $('apiKey').value = c.apiKey || '';
  $('recipientRole').value = c.recipientRole || 'healthcare_research';
  $('recipientEmails').value = (c.recipientEmails || []).join(', ');
  $('patientSenders').value = (c.patientSenders || []).join('\n');
});

$('save').addEventListener('click', async () => {
  const cfg = {
    apiKey: $('apiKey').value.trim(),
    recipientRole: $('recipientRole').value,
    recipientEmails: split($('recipientEmails').value),
    patientSenders: split($('patientSenders').value)
  };
  if (!cfg.apiKey) { $('status').textContent = t('apiKeyRequired'); return; }
  await chrome.storage.local.set({ __jev_cfg: cfg });
  $('status').textContent = t('settingsSaved');
});

$('test').addEventListener('click', async () => {
  $('status').textContent = t('testingConnection');
  const r = await chrome.runtime.sendMessage({ type: 'jev-test' });
  $('status').textContent = r?.ok
    ? t('connectionSuccess', [r.model, r.answers.needs_action.noul.toFixed(2)])
    : t('connectionFailed', r?.error || t('noResponse'));
});
