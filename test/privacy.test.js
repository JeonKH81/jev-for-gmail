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
  assert.deepEqual(result, { excluded: 'patient', excludedDetail: 'patient_id' });
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

test('ordinary financial and address words are masked instead of locked', () => {
  const result = privacy.prepareOutbound({
    subject: '계좌 및 배송지 확인',
    snippet: '입금 계좌와 주소를 확인하세요',
    threadText: '문의 finance@example.com, 전화 010-1234-5678, 주소: 서울특별시 중구 세종대로 110'
  });
  assert.ok(result.email);
  assert.match(result.email.thread_text, /\[이메일\]/);
  assert.match(result.email.thread_text, /\[전화\]/);
  assert.match(result.email.thread_text, /\[주소\]/);
});

test('patient and finance keywords alone do not lock routine work mail', () => {
  for (const message of ['외래 일정 안내', '연구 participant 모집 공고', '입금 절차 안내']) {
    const result = privacy.prepareOutbound({ subject: message, snippet: '일반 안내 메일입니다.' });
    assert.ok(result.email, message);
  }
});

test('patient procedure schedules and admission rosters are locked before transmission', () => {
  const titleOnly = privacy.prepareOutbound({
    subject: '9월23일 중재 시술 스케줄 보내드립니다 (입원대기 우선순위명단 포함)',
    snippet: '첨부파일을 확인해 주세요'
  });
  assert.deepEqual(titleOnly, { excluded: 'patient', excludedDetail: 'patient_schedule_or_roster' });

  const tableOnly = privacy.prepareOutbound({
    subject: '업무 자료',
    threadText: '등록번호 이름 생년월일 성별 검사명 발행처 지정의 진단명\n12345678 가명 1950-01-01 M CAG 병동 담당의 CAD'
  });
  assert.deepEqual(tableOnly, { excluded: 'patient', excludedDetail: 'patient_schedule_or_roster' });
});

test('high-confidence account number remains fail-closed', () => {
  const result = privacy.prepareOutbound({
    subject: '계좌 확인',
    threadText: '입금 계좌: 123-456-789012'
  });
  assert.deepEqual(result, { excluded: 'personal', excludedDetail: 'account_number' });
});

test('common hospital and society mail signatures do not cause false locks', () => {
  const fixtures = [
    {
      subject: '교수간담회 보고자료 송부드립니다',
      body: '보고자료를 송부드리오니 참고 바랍니다.\nT. 031-787-1107\nE. staff@hospital.example\nA. 13620 경기도 성남시 분당구 구미로 173번길 82'
    },
    {
      subject: '모니터링 시스템 가입 요청드립니다',
      body: '시스템 가입과 수련지도 실적 입력을 요청드립니다.\n받는사람: User One <one@hospital.example>, User Two <two@hospital.example>\nT. 031-787-1227'
    },
    {
      subject: 'PRN 처방 관련 협조 요청드립니다',
      body: '환자 안전을 위하여 기준에 부합하도록 오더 발행 부탁드립니다.\nT. +82-31-787-6929\nE. ward@hospital.example'
    },
    {
      subject: '국제학술대회 Faculty 초청',
      body: '역할 확인 및 수락을 부탁드립니다.\n학회 홈페이지 ID : member01\n비밀번호를 잊으셨나요? 비밀번호 찾기\nTel: 02-582-8208\nE-mail: office@society.example'
    }
  ];
  for (const fixture of fixtures) {
    const result = privacy.prepareOutbound({
      subject: fixture.subject,
      threadText: fixture.body,
      senderEmails: ['staff@example.org']
    });
    assert.ok(result.email, fixture.subject);
    assert.deepEqual(privacy.finalSafetyScan(JSON.stringify(result.email)), [], fixture.subject);
    assert.doesNotMatch(JSON.stringify(result.email), /@|\+82-31-787-6929|031-787-1107/, fixture.subject);
  }
});

test('configured sender lock reports an actionable reason', () => {
  const result = privacy.prepareOutbound({
    subject: '일반 안내',
    snippet: '내용',
    senderEmails: ['staff@hospital.example'],
    patientSenders: ['@hospital.example']
  });
  assert.deepEqual(result, { excluded: 'patient', excludedDetail: 'configured_sender' });
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
  const content = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
  assert.match(content, /CACHE_SCHEMA = 3/);
  assert.match(content, /cacheSchema === CACHE_SCHEMA/);
  assert.match(content, /function extensionAlive\(\)/);
  assert.match(content, /function safeStorageSet\(values\)/);
});
