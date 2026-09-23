// Jev for Gmail - background service worker
// Calls the TypeSafe Jev API. Each user enters their own API key in the options page;
// it is stored only in this browser profile (chrome.storage.local).
importScripts('privacy.js');

async function getCfg() {
  const { __jev_cfg } = await chrome.storage.local.get('__jev_cfg');
  return __jev_cfg || {};
}

chrome.runtime.onInstalled.addListener(d => { if (d.reason === 'install') chrome.runtime.openOptionsPage(); });

const QUESTIONS = {
  needs_action: {
    type: 'noul',
    instructions: 'Does this email require the recipient to personally do something (reply, approve, sign up, register, submit, correct, confirm, prepare) rather than just read it?',
    criteria: { true: 'A concrete action by the recipient is requested or clearly needed', false: 'Informational, promotional, automated notice, or no action needed' }
  },
  urgency: {
    type: 'score',
    instructions: 'How time-sensitive is this email for the recipient, given `now`? Consider any deadlines or dates in the body.',
    criteria: ['No time pressure or not relevant', 'Should be handled within the next few weeks', 'Should be handled within the next few days', 'Needs attention today, deadline imminent, or already overdue']
  },
  importance: {
    type: 'score',
    instructions: "How important is this email to the anonymized `recipient_role` (research/manuscripts, IRB/regulatory, hospital duties, academic roles)?",
    criteria: ['Marketing, newsletter, spam, or irrelevant', 'Low-value FYI or routine automated notice', 'Relevant work information worth reading', 'Important: affects his patients, his manuscripts/grants/IRB, or formal obligations']
  },
  already_handled: {
    type: 'noul',
    instructions: 'Based on `email.thread_text` (a redacted address header marked `[SELF]` is the recipient), has the recipient already done what this email asks, or is the matter clearly over given `now`?',
    criteria: { true: 'Evidence shows the recipient already replied/approved/registered, or the deadline/event has clearly passed', false: 'No evidence it was handled; still pending (or no action was ever needed)' }
  },
  category: {
    type: 'choice',
    instructions: 'What kind of email is this?',
    criteria: {
      patient_care: 'Patient schedules, admissions, procedures, prescribing',
      research_manuscript: 'Manuscript submissions, journals, preprints, peer review, trials',
      irb_regulatory: 'IRB, ethics, regulatory, study compliance',
      hospital_admin: 'Hospital administration, teaching, internal notices',
      academic_society: 'Conferences, society invitations, honoraria, registrations',
      personal_finance: 'Receipts, banking, personal accounts, security notices',
      newsletter_marketing: 'Newsletters, promotions, ads, product announcements'
    }
  }
};

async function callJev(state, apiKey) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'jev-latest', state, questions: QUESTIONS })
    });
    if (r.status === 429 || r.status === 529) { await new Promise(res => setTimeout(res, 600 * 2 ** attempt)); continue; }
    const j = await r.json();
    if (!r.ok) throw new Error('Jev ' + r.status + ': ' + JSON.stringify(j).slice(0, 200));
    return j;
  }
  throw new Error('Jev: retries exhausted');
}

function nowSeoul() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16) + ' (Asia/Seoul)';
}

const RECIPIENT_ROLES = {
  healthcare_research: 'healthcare professional and clinical researcher',
  healthcare: 'healthcare professional',
  research: 'academic researcher',
  academic_admin: 'academic and institutional administrator',
  general_professional: 'professional Gmail user'
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'jev-score' || msg?.type === 'jev-test') {
    getCfg().then(cfg => {
      if (!cfg.apiKey) throw new Error('API 키가 설정되지 않았습니다. 확장 옵션에서 입력하세요.');
      const candidate = msg.type === 'jev-test' ? { subject: '연결 테스트', sender_type: 'automated', preview: '다음 주 수요일까지 회신 부탁드립니다.' } : msg.email;
      const email = JevPrivacy.validateOutboundEmail(candidate);
      const state = { recipient_role: RECIPIENT_ROLES[cfg.recipientRole] || RECIPIENT_ROLES.healthcare_research, now: nowSeoul(), email };
      return callJev(state, cfg.apiKey);
    })
      .then(j => sendResponse({ ok: true, answers: j.answers, usage: j.usage, model: j.model }))
      .catch(e => sendResponse({ ok: false, error: String(e.message || e) }));
    return true; // async response
  }
});
