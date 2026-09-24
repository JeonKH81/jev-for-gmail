// Local privacy boundary shared by the Gmail content script and service worker.
// This file deliberately uses only deterministic rules; it never calls an NER service.
((root, factory) => {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.JevPrivacy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const MAX_EXTERNAL_TEXT = 2500;
  const EMAIL_RE = /\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+\b/gi;
  const PHONE_RE = /(?<!\d)(?:\+?82[- .]?)?0?(?:1\d|2|[3-6]\d)[- .)]?\d{3,4}[- .]?\d{4}(?!\d)/g;
  const RRN_RE = /\b\d{6}[- ]?[1-4]\d{6}\b/g;
  const CARD_RE = /\b(?:\d{4}[- ]?){3}\d{4}\b/g;
  const ACCOUNT_RE = /(계좌|은행|입금|예금주|통장|account)[^\n]{0,40}\d[\d-]{8,}\d/gi;
  const PASSPORT_RE = /(여권\s*번호|passport\s*(?:no|number))\s*[:：.]?\s*[A-Z]{1,2}\d{7,8}/gi;
  const PATIENT_ID_RE = /(?:환자\s*(?:번호|ID)|patient\s*id|MRN|등록번호)\s*[:：#-]?\s*[A-Z0-9-]{5,}/gi;
  const DATE_OF_BIRTH_RE = /\b(?:19[0-9]{2}|20[0-9])[-./]\d{1,2}[-./]\d{1,2}\b/g;
  const LONG_NUMBER_RE = /\b\d{7,}\b/g;
  const ADDRESS_RE = /(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충청|충북|충남|전라|전북|전남|경상|경북|경남|제주)\S*\s+\S+(?:시|군|구)\s+[^\n,]{0,40}?(?:로|길)\s*\d+(?:번길\s*\d+)?(?:\s*\([^)\n]{0,20}\))?/g;
  const ADDRESS_WORD_RE = /(주소|자택|배송지|거주지|우편\s*번호|address)\s*[:：]?[^\n]{0,40}(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충청|충북|충남|전라|전북|전남|경상|경북|경남|제주)/gi;
  const SECRET_RE = /((?:비밀\s*번호|password|PW|pw|ID|아이디)\s*[:：]\s*)\S+/g;
  const AUTH_SECRET_RE = /(?:OTP|인증\s*번호|보안\s*코드)\s*[:：#-]?\s*\d{4,8}/gi;
  const STRUCTURED_NUMBER_RE = /\b(?!(?:19|20)\d{2}-\d{1,2}-\d{1,2}\b)\d{2,6}-\d{2,6}-\d{2,8}(?:-\d{1,4})?\b/g;

  const LABELED_PATIENT_NAME_RE = /(?:환자\s*(?:명|이름)|patient\s*name)\s*[:：]\s*(?:[가-힣]{2,4}|[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/gi;
  const CLINICAL_PATIENT_NAME_RE = /환자\s+[가-힣]{2,4}(?:님)?\s+(?:검사|진료|입원|퇴원|시술|수술|처방|예약|결과)/g;
  const HEADER_RE = /^\s*(from|to|cc|bcc|reply-to|sender|보낸\s*사람|받는\s*사람|참조|숨은\s*참조|회신\s*주소|발신|수신)\s*[:：].*$/gim;

  const test = (re, value) => { re.lastIndex = 0; return re.test(value || ''); };
  const domains = emails => (emails || []).map(x => String(x).toLowerCase().split('@')[1]).filter(Boolean);

  function sensitiveFinding({ subject = '', snippet = '', threadText = '', senderEmails = [], patientSenders = [] }) {
    const normalizedSenders = senderEmails.map(x => String(x).toLowerCase());
    const normalizedRules = patientSenders.map(x => String(x).toLowerCase().trim()).filter(Boolean);
    if (normalizedSenders.some(email => normalizedRules.some(rule => rule.startsWith('@') ? email.endsWith(rule) : email === rule))) {
      return { excluded: 'patient', excludedDetail: 'configured_sender' };
    }
    const visible = `${subject}\n${snippet}`;
    const all = `${visible}\n${threadText}`;
    if (test(PATIENT_ID_RE, all)) return { excluded: 'patient', excludedDetail: 'patient_id' };
    if ([LABELED_PATIENT_NAME_RE, CLINICAL_PATIENT_NAME_RE].some(re => test(re, all))) {
      return { excluded: 'patient', excludedDetail: 'patient_name' };
    }
    // Lock only high-confidence values. Ordinary words such as "외래", "입금",
    // "participant", or "주소" are not sufficient by themselves.
    const personalChecks = [
      ['resident_number', RRN_RE], ['card_number', CARD_RE], ['account_number', ACCOUNT_RE],
      ['passport_number', PASSPORT_RE], ['authentication_secret', AUTH_SECRET_RE]
    ];
    for (const [excludedDetail, re] of personalChecks) {
      if (test(re, all)) return { excluded: 'personal', excludedDetail };
    }
    return null;
  }

  function classifySensitive(input) {
    return sensitiveFinding(input)?.excluded || null;
  }

  function maskIds(value = '') {
    return String(value)
      .replace(EMAIL_RE, '[이메일]')
      .replace(PHONE_RE, '[전화]')
      .replace(DATE_OF_BIRTH_RE, '[생년월일]')
      .replace(RRN_RE, '[주민번호]')
      .replace(CARD_RE, '[카드번호]')
      .replace(PASSPORT_RE, '[여권번호]')
      .replace(PATIENT_ID_RE, '[환자ID]')
      .replace(ACCOUNT_RE, '[계좌정보]')
      .replace(AUTH_SECRET_RE, '[인증정보]')
      .replace(STRUCTURED_NUMBER_RE, '[번호]')
      .replace(SECRET_RE, '$1[가림]')
      .replace(ADDRESS_RE, '[주소]')
      .replace(LONG_NUMBER_RE, '[번호]');
  }

  function stripAddressHeaders(value = '', selfEmails = []) {
    const own = (selfEmails || []).map(x => String(x).toLowerCase()).filter(Boolean);
    return String(value).replace(HEADER_RE, line => {
      const label = (line.match(/^\s*([^:：]+)/) || [])[1]?.trim() || 'header';
      const isSelf = own.some(email => line.toLowerCase().includes(email));
      return `${label}: ${isSelf ? '[SELF]' : '[REDACTED]'}`;
    });
  }

  function senderType(senderEmails = [], selfEmails = []) {
    const senders = senderEmails.map(x => String(x).toLowerCase());
    const ownDomains = new Set(domains(selfEmails));
    if (senders.some(x => ownDomains.has(x.split('@')[1]))) return 'organization_internal';
    if (senders.some(x => /(?:no-?reply|mailer-daemon|notification|alert|automated)/.test(x))) return 'automated';
    if (senders.some(x => /(?:journal|editorial|manuscript|scholarone|editorialmanager)/.test(x))) return 'journal_platform';
    if (senders.some(x => /(?:society|conference|congress|meeting)/.test(x))) return 'academic_organization';
    return 'external';
  }

  function finalSafetyScan(value = '') {
    const findings = [];
    const checks = [
      ['email', EMAIL_RE], ['phone', PHONE_RE], ['resident_number', RRN_RE],
      ['card', CARD_RE], ['account', ACCOUNT_RE], ['passport', PASSPORT_RE],
      ['address', ADDRESS_RE], ['address', ADDRESS_WORD_RE], ['patient_id', PATIENT_ID_RE],
      ['long_number', LONG_NUMBER_RE]
    ];
    for (const [name, re] of checks) if (test(re, value)) findings.push(name);
    return [...new Set(findings)];
  }

  function prepareOutbound({ subject = '', snippet = '', threadText = null, senderEmails = [], selfEmails = [], patientSenders = [] }) {
    const finding = sensitiveFinding({ subject, snippet, threadText: threadText || '', senderEmails, patientSenders });
    if (finding) return finding;
    const safeSubject = maskIds(subject).slice(0, 300);
    const source = threadText == null ? snippet : threadText;
    let safeText = maskIds(stripAddressHeaders(source, selfEmails)).trim();
    const bodyBudget = Math.max(0, MAX_EXTERNAL_TEXT - safeSubject.length);
    if (safeText.length > bodyBudget) {
      const marker = '...(earlier messages omitted)...\n';
      safeText = bodyBudget > marker.length
        ? marker + safeText.slice(-(bodyBudget - marker.length))
        : safeText.slice(-bodyBudget);
    }
    const email = {
      subject: safeSubject,
      sender_type: senderType(senderEmails, selfEmails),
      [threadText == null ? 'preview' : 'thread_text']: safeText
    };
    const findings = finalSafetyScan(JSON.stringify(email));
    return findings.length ? { excluded: 'personal', excludedDetail: 'final_safety_scan', findings } : { email };
  }

  function validateOutboundEmail(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid email payload');
    const allowed = ['subject', 'sender_type', 'thread_text', 'preview'];
    if (Object.keys(value).some(k => !allowed.includes(k))) throw new Error('Unexpected email field');
    const clean = {};
    for (const key of allowed) if (typeof value[key] === 'string') clean[key] = value[key];
    const allowedSenderTypes = ['organization_internal', 'automated', 'journal_platform', 'academic_organization', 'external'];
    if (!allowedSenderTypes.includes(clean.sender_type)) throw new Error('Invalid sender type');
    const externalTextLength = (clean.subject || '').length + (clean.thread_text || clean.preview || '').length;
    if (externalTextLength > MAX_EXTERNAL_TEXT) throw new Error('External text exceeds privacy limit');
    const findings = finalSafetyScan(JSON.stringify(clean));
    if (findings.length) throw new Error(`Privacy safety scan blocked: ${findings.join(', ')}`);
    return clean;
  }

  return { MAX_EXTERNAL_TEXT, sensitiveFinding, classifySensitive, maskIds, stripAddressHeaders, senderType, finalSafetyScan, prepareOutbound, validateOutboundEmail };
});
