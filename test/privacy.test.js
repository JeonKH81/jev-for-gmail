const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const privacy = require('../privacy.js');

test('patient name and email are fail-closed and never prepared for transmission', () => {
  const result = privacy.prepareOutbound({
    subject: '환자 김민준 검사 결과',
    snippet: '결과를 확인해 주세요',
    threadText: 'From: 김민준 <patient@example.com>\n등록번호: P-123456\n검사 결과입니다.',
    senderEmails: ['ward@hospital.example']
  });
  assert.deepEqual(result, { excluded: 'patient' });
});

test('ordinary society mail is transmitted with header names and emails removed', () => {
  const result = privacy.prepareOutbound({
    subject: '학회 연례총회 안내 - contact@society.example',
    snippet: '프로그램을 확인하세요',
    threadText: 'From: 홍길동 <contact@society.example>\nTo: 김교수 <me@hospital.example>\n프로그램이 공개되었습니다.',
    senderEmails: ['contact@society.example'],
    selfEmails: ['me@hospital.example']
  });
  assert.ok(result.email);
  assert.equal(result.email.sender_type, 'academic_organization');
  assert.match(result.email.subject, /\[이메일\]/);
  assert.match(result.email.thread_text, /From: \[REDACTED\]/);
  assert.match(result.email.thread_text, /To: \[SELF\]/);
  assert.doesNotMatch(JSON.stringify(result.email), /홍길동|김교수|@/);
});

test('research deadline mail keeps latest useful text within 2,500 characters', () => {
  const oldText = '오래된 연구 논의 '.repeat(400);
  const latest = 'Reply-To: Editor Name <editor@journal.example>\n논문 수정 마감은 다음 주 수요일입니다. 회신해 주세요.';
  const result = privacy.prepareOutbound({
    subject: 'Manuscript revision deadline',
    snippet: '다음 주 수요일 마감',
    threadText: `${oldText}\n${latest}`,
    senderEmails: ['editor@journal.example']
  });
  assert.ok(result.email);
  assert.ok(result.email.subject.length + result.email.thread_text.length <= privacy.MAX_EXTERNAL_TEXT);
  assert.match(result.email.thread_text, /논문 수정 마감은 다음 주 수요일/);
  assert.doesNotMatch(result.email.thread_text, /Editor Name|editor@journal\.example/);
});

test('financial and address mail is fail-closed', () => {
  const result = privacy.prepareOutbound({
    subject: '계좌 및 배송지 확인',
    snippet: '입금 계좌와 주소를 확인하세요',
    threadText: '계좌 123-456-789012, 주소: 서울특별시 중구 세종대로 110'
  });
  assert.deepEqual(result, { excluded: 'personal' });
});

test('masking covers email in both title and body and safety boundary rejects leftovers', () => {
  assert.equal(privacy.maskIds('문의 user@example.com'), '문의 [이메일]');
  assert.throws(
    () => privacy.validateOutboundEmail({ subject: 'safe', preview: 'call 010-1234-5678' }),
    /Invalid sender type/
  );
  assert.throws(
    () => privacy.validateOutboundEmail({ subject: 'safe', sender_type: 'external', preview: 'call 010-1234-5678' }),
    /Privacy safety scan blocked: phone/
  );
  assert.throws(
    () => privacy.validateOutboundEmail({ subject: 'safe', preview: 'safe', from: 'Name <a@example.com>' }),
    /Unexpected email field/
  );
});

test('manifest permissions are unchanged and privacy helper loads before content script', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.deepEqual(manifest.host_permissions, ['https://mail.google.com/*', 'https://api.typesafe.ai/*']);
  assert.deepEqual(manifest.content_scripts[0].js, ['privacy.js', 'content.js']);
});
