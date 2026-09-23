const on = document.getElementById('on');
const msg = document.getElementById('msg');
chrome.storage.local.get('__jev_enabled').then(v => { on.checked = v.__jev_enabled !== false; });
on.addEventListener('change', () => chrome.storage.local.set({ __jev_enabled: on.checked }));
document.getElementById('clear').addEventListener('click', async () => {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(k => k.startsWith('#'));
  await chrome.storage.local.remove(keys);
  msg.textContent = `캐시 ${keys.length}개 삭제. Gmail을 새로고침하면 다시 채점합니다.`;
});

document.getElementById('opts').addEventListener('click', () => chrome.runtime.openOptionsPage());
chrome.storage.local.get('__jev_cfg').then(v => { if (!v.__jev_cfg?.apiKey) msg.textContent = '먼저 설정에서 TypeSafe API 키를 입력하세요.'; });
