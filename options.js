const $ = id => document.getElementById(id);
const split = s => s.split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(Boolean);

chrome.storage.local.get('__jev_cfg').then(({ __jev_cfg: c = {} }) => {
  $('apiKey').value = c.apiKey || '';
  $('recipient').value = c.recipient || '';
  $('recipientEmails').value = (c.recipientEmails || []).join(', ');
  $('patientSenders').value = (c.patientSenders || []).join('\n');
});

$('save').addEventListener('click', async () => {
  const cfg = {
    apiKey: $('apiKey').value.trim(),
    recipient: $('recipient').value.trim(),
    recipientEmails: split($('recipientEmails').value),
    patientSenders: split($('patientSenders').value)
  };
  if (!cfg.apiKey) { $('status').textContent = 'API 키를 입력하세요.'; return; }
  await chrome.storage.local.set({ __jev_cfg: cfg });
  $('status').textContent = '저장했습니다. Gmail을 새로고침하면 적용됩니다.';
});

$('test').addEventListener('click', async () => {
  $('status').textContent = '테스트 중...';
  const r = await chrome.runtime.sendMessage({ type: 'jev-test' });
  $('status').textContent = r?.ok
    ? `연결 성공 (${r.model}). 테스트 문장 "할 일" 확률 ${r.answers.needs_action.noul.toFixed(2)}`
    : '실패: ' + (r?.error || '응답 없음') + ' (먼저 저장했는지 확인하세요)';
});
