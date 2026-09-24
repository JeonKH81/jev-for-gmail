// Jev for Gmail - content script
// Only adds visual badges to the Gmail list. Never changes mail, labels, or read state.
(() => {
  const MAX_AGE_DAYS = 7;          // score only mails whose latest message is within N days
  const CONCURRENCY = 4;
  const CACHE_TTL_DAYS = 30;
  const CACHE_SCHEMA = 3;          // privacy rule changes must not reuse older decisions
  const W = { act: 0.4, urg: 0.3, imp: 0.3, doneDiscount: 0.6 };
  const CAT_KO = { patient_care: '환자', research_manuscript: '연구/원고', irb_regulatory: 'IRB/규제', hospital_admin: '병원행정', academic_society: '학회', personal_finance: '개인/금융', newsletter_marketing: '광고/뉴스레터' };
  const { sensitiveFinding, prepareOutbound } = JevPrivacy;
  const LOCK_REASON_KO = {
    configured_sender: '설정에서 제외한 발신자 또는 도메인',
    patient_schedule_or_roster: '환자 시술 일정 또는 입원·환자 명단',
    patient_id: '명시된 환자 ID',
    patient_name: '명시된 환자명',
    resident_number: '주민등록번호',
    card_number: '카드번호',
    account_number: '실제 계좌번호',
    passport_number: '여권번호',
    authentication_secret: '인증번호 또는 보안코드',
    final_safety_scan: 'masking 후 최종 안전 검사 미통과'
  };

  // ---- Patient-related mail: never fetched, never sent to Jev ----
  let PATIENT_SENDERS = [];   // set per user in the options page
  let SELF_EMAILS = [];       // local-only: used to replace thread headers with [SELF]
  let privacyConfigFingerprint = 'default';
  let configured = false;
  function visibleSensitiveFinding(info) {
    return sensitiveFinding({ subject: info.subject, snippet: info.snippet, senderEmails: info.senderEmails, patientSenders: PATIENT_SENDERS });
  }

  // Only the Inbox "기본/Primary" tab (or inbox without category tabs)
  function inPrimaryInbox() {
    const h = location.hash || '#inbox';
    if (!/^#inbox\/?$/.test(h) && h !== '') return false;
    const tabs = [...document.querySelectorAll('[role=tab]')].filter(t => t.offsetParent && /기본|Primary|프로모션|Promotions|소셜|Social|업데이트|Updates|포럼|Forums/.test(t.innerText));
    if (!tabs.length) return true;
    const sel = tabs.find(t => t.getAttribute('aria-selected') === 'true');
    return !!sel && /기본|Primary/.test(sel.innerText);
  }

  const memCache = {};        // key -> result
  let seen = {};              // tid -> {subject, snippet, when}  (remembered across tabs/views)
  let seenTimer = null;
  const inflight = new Set();
  const queue = [];
  let active = 0;
  let enabled = true;

  // ---------- styles ----------
  function ensureStyle() {
    if (document.getElementById('jev-style')) return;
    const st = document.createElement('style');
    st.id = 'jev-style';
    st.textContent = `.jev-badge{display:inline-flex;align-items:center;justify-content:center;min-width:38px;padding:1px 6px;margin-right:6px;border-radius:10px;font:600 11px/16px Roboto,Arial,sans-serif;color:#fff;vertical-align:middle;cursor:help;flex:none}
.jev-hi{background:#d93025}.jev-mid{background:#f29900}.jev-lo{background:#80868b}.jev-min{background:#dadce0;color:#5f6368}
.jev-done{outline:2px dashed #188038;outline-offset:-2px}.jev-wait{background:#e8f0fe;color:#1a73e8}.jev-err{background:#fce8e6;color:#c5221f}`;
    document.head.appendChild(st);
  }

  // ---------- helpers ----------
  const accountIndex = () => (location.pathname.match(/\/mail\/u\/(\d+)/) || [, '0'])[1];

  function extensionAlive() {
    try { return !!chrome.runtime?.id; } catch (_) { return false; }
  }

  function safeStorageSet(values) {
    if (!extensionAlive()) return;
    try {
      const pending = chrome.storage.local.set(values);
      if (pending?.catch) pending.catch(() => {});
    } catch (_) { /* An extension reload invalidates the old content-script context. */ }
  }

  function parseRowDate(tr) {
    const t = tr.querySelector('td.xW span[title]')?.getAttribute('title') || '';
    let m = t.match(/(\d{4})년\s*(\d+)월\s*(\d+)일.*?(오전|오후)\s*(\d+):(\d+)/);
    if (m) {
      let h = +m[5] % 12; if (m[4] === '오후') h += 12;
      return new Date(+m[1], +m[2] - 1, +m[3], h, +m[6]).getTime();
    }
    const d = Date.parse(t);
    return isNaN(d) ? null : d;
  }

  function hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

  function htmlToText(html) {
    return html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>|<\/(p|div|tr|table|h\d|li)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
      .replace(/https?:\/\/\S{60,}/g, '[link]')
      .replace(/[ \t\u00a0\u200c\u034f]+/g, ' ')
      .replace(/\n\s*\n+/g, '\n')
      .trim();
  }

  async function fetchThreadText(legacyId) {
    const r = await fetch(`/mail/u/${accountIndex()}/?view=pt&search=all&th=${legacyId}`, { credentials: 'include' });
    if (!r.ok) throw new Error('print view ' + r.status);
    let txt = htmlToText(await r.text());
    // drop the account header line before the first message
    const cut = txt.search(/\n\s*\d+\s*(개의 메일|messages?)\s*\n/);
    if (cut > 0) txt = txt.slice(cut).trim();
    return txt;
  }

  function rowInfo(tr) {
    const tidEl = tr.querySelector('[data-thread-id]');
    const legEl = tr.querySelector('[data-legacy-thread-id]');
    if (!tidEl || !legEl) return null;
    const tid = tidEl.getAttribute('data-thread-id');
    const legacy = legEl.getAttribute('data-legacy-thread-id');
    const subject = tr.querySelector('.bog')?.innerText?.trim() || '';
    const snippet = (tr.querySelector('.y2')?.innerText || '').replace(/^\s*-\s*/, '').trim();
    const senderEls = [...tr.querySelectorAll('span[email]')];
    const senderEmails = [...new Set(senderEls.map(e => (e.getAttribute('email') || '').toLowerCase()))];
    const when = parseRowDate(tr) || (legacy ? parseInt(legacy.slice(0, 11), 16) : null);
    const key = '#jev|' + tid + '|' + hash(snippet + '|' + (tr.querySelector('td.xW span[title]')?.getAttribute('title') || '')) + '|p' + CACHE_SCHEMA + '|' + privacyConfigFingerprint;
    return { tr, tid, legacy, subject, snippet, senderEmails, when, key };
  }

  // "Please approve X" followed later by "X received/confirmed" -> treat X as handled (rule in code, not model)
  function confirmedLater(info, allInfos) {
    const ids = (info.subject.match(/[A-Z0-9][A-Z0-9\/\-]*\d{4,}[A-Z0-9\/\-]*/gi) || []).filter(s => s.length >= 6);
    if (!ids.length) return null;
    const pool = [...allInfos, ...Object.entries(seen).filter(([tid]) => !allInfos.some(i => i.tid === tid)).map(([tid, v]) => ({ tid, ...v }))];
    const hit = pool.find(o => o.tid !== info.tid && o.when && info.when && o.when > info.when &&
      ids.some(id => (o.subject + ' ' + o.snippet).includes(id)) &&
      /received|acknowledg|confirm|approved|접수완료|접수 완료/i.test(o.subject + ' ' + o.snippet));
    return hit ? hit.subject : null;
  }

  function score(res) {
    const a = res.answers;
    const base = W.act * a.needs_action.noul + W.urg * a.urgency.score / 3 + W.imp * a.importance.score / 3;
    return { base, act: a.needs_action.noul, urg: a.urgency.score, imp: a.importance.score, doneJev: a.already_handled.noul, cat: a.category.choice };
  }

  // ---------- rendering ----------
  function render(info, data, state) {
    let b = info.tr.querySelector('.jev-badge');
    const cell = info.tr.querySelector('td.xY .xT') || info.tr.querySelector('.xT') || info.tr.querySelector('.y6');
    if (!cell) return;
    if (!b) { b = document.createElement('span'); cell.prepend(b); }
    if (state === 'wait') { b.className = 'jev-badge jev-wait'; b.textContent = '…'; b.title = 'Jev 채점 중'; return; }
    if (data && data.excluded) {
      const reason = LOCK_REASON_KO[data.excludedDetail] || (data.excluded === 'personal' ? '고위험 개인정보' : '환자 관련 고위험 정보');
      b.className = 'jev-badge jev-min'; b.textContent = '🔒';
      b.title = `Jev에 보내지 않음\n잠금 원인: ${reason}`;
      return;
    }
    if (state === 'err') { b.className = 'jev-badge jev-err'; b.textContent = '!'; b.title = 'Jev 오류: ' + data; return; }
    const done = data.rule ? Math.max(data.doneJev, 0.95) : data.doneJev;
    const p = data.base * (1 - W.doneDiscount * done);
    b.className = 'jev-badge ' + (p >= 0.7 ? 'jev-hi' : p >= 0.5 ? 'jev-mid' : p >= 0.3 ? 'jev-lo' : 'jev-min') + (done >= 0.6 ? ' jev-done' : '');
    b.textContent = (done >= 0.6 ? '✓ ' : '') + p.toFixed(2);
    b.title = `Jev 우선순위 ${p.toFixed(2)}\n할 일 확률 ${data.act.toFixed(2)} · 급함 ${data.urg.toFixed(1)}/3 · 중요도 ${data.imp.toFixed(1)}/3\n이미 처리됨 ${done.toFixed(2)}${data.rule ? ' (접수확인 메일: ' + data.rule.slice(0, 40) + ')' : ''}\n분류: ${CAT_KO[data.cat] || data.cat}`;
  }

  // ---------- queue ----------
  function pump() {
    while (active < CONCURRENCY && queue.length) {
      const job = queue.shift();
      active++;
      runJob(job).finally(() => { active--; inflight.delete(job.info.key); pump(); });
    }
  }

  async function runJob({ info }) {
    try {
      render(info, null, 'wait');
      let text;
      try { text = await fetchThreadText(info.legacy); } catch (e) { text = null; }
      const prepared = prepareOutbound({
        subject: info.subject,
        snippet: info.snippet,
        threadText: text,
        senderEmails: info.senderEmails,
        selfEmails: SELF_EMAILS,
        patientSenders: PATIENT_SENDERS
      });
      if (prepared.excluded) {
        // Fail closed: sensitive content and any post-masking safety finding stay local.
        memCache[info.key] = { excluded: prepared.excluded, excludedDetail: prepared.excludedDetail, findings: prepared.findings, cacheSchema: CACHE_SCHEMA, t: Date.now() };
        safeStorageSet({ [info.key]: memCache[info.key] });
        refreshRowsFor(info.key, memCache[info.key]);
        return;
      }
      if (!extensionAlive()) return;
      const res = await chrome.runtime.sendMessage({ type: 'jev-score', email: prepared.email });
      if (!res?.ok) throw new Error(res?.error || 'no response');
      const data = { ...score(res), cacheSchema: CACHE_SCHEMA, t: Date.now() };
      memCache[info.key] = data;
      safeStorageSet({ [info.key]: data });
      data.rule = info.rule;
      refreshRowsFor(info.key, data);
    } catch (e) {
      if (extensionAlive()) render(info, String(e.message || e).slice(0, 150), 'err');
    }
  }

  function refreshRowsFor(key, data) {
    document.querySelectorAll('tr.zA').forEach(tr => {
      const i = rowInfo(tr);
      if (i && i.key === key) render(i, data);
    });
  }

  // ---------- main scan ----------
  async function scan() {
    if (!enabled || !extensionAlive()) return;
    const rows = [...document.querySelectorAll('tr.zA')].filter(tr => tr.offsetParent);
    const infos = rows.map(rowInfo).filter(Boolean);
    // remember non-patient rows from any view (local only) so "later confirmation" rule works across tabs
    for (const i of infos) if (!visibleSensitiveFinding(i)) seen[i.tid] = { subject: i.subject, snippet: i.snippet.slice(0, 300), when: i.when };
    clearTimeout(seenTimer);
    seenTimer = setTimeout(() => {
      if (!extensionAlive()) return;
      const entries = Object.entries(seen).sort((a, b) => (b[1].when || 0) - (a[1].when || 0)).slice(0, 600);
      seen = Object.fromEntries(entries);
      safeStorageSet({ __jev_seen: seen });
    }, 2000);
    if (!inPrimaryInbox() || !configured) return;
    ensureStyle();
    const cutoff = Date.now() - MAX_AGE_DAYS * 864e5;
    const need = infos.filter(i => !memCache[i.key]).map(i => i.key);
    if (need.length) Object.assign(memCache, await chrome.storage.local.get(need));
    for (const info of infos) {
      const finding = visibleSensitiveFinding(info);
      if (finding) { render(info, finding); continue; }
      info.rule = confirmedLater(info, infos);
      const cached = memCache[info.key]?.cacheSchema === CACHE_SCHEMA ? memCache[info.key] : null;
      if (cached) { render(info, { ...cached, rule: info.rule }); continue; }
      if (info.when && info.when < cutoff) continue;
      if (inflight.has(info.key)) continue;
      inflight.add(info.key);
      queue.push({ info });
    }
    pump();
  }

  // prune old cache entries once per load
  chrome.storage.local.get(null).then(all => {
    const old = Object.entries(all).filter(([k, v]) => k.startsWith('#') && v?.t && v.t < Date.now() - CACHE_TTL_DAYS * 864e5).map(([k]) => k);
    if (old.length) chrome.storage.local.remove(old);
  });

  function applyCfg(cfg) {
    cfg = cfg || {};
    configured = !!cfg.apiKey;
    PATIENT_SENDERS = (cfg.patientSenders || []).map(x => x.toLowerCase().trim()).filter(Boolean);
    SELF_EMAILS = (cfg.recipientEmails || []).map(x => x.toLowerCase().trim()).filter(Boolean);
    privacyConfigFingerprint = hash(JSON.stringify([PATIENT_SENDERS.slice().sort(), SELF_EMAILS.slice().sort(), cfg.recipientRole || '']));
  }
  chrome.storage.local.get(['__jev_enabled', '__jev_seen', '__jev_cfg']).then(v => { enabled = v.__jev_enabled !== false; seen = v.__jev_seen || {}; applyCfg(v.__jev_cfg); scan(); });
  chrome.storage.onChanged.addListener(ch => {
    if ('__jev_cfg' in ch) { applyCfg(ch.__jev_cfg.newValue); scan(); }
    if ('__jev_enabled' in ch) {
      enabled = ch.__jev_enabled.newValue !== false;
      if (!enabled) document.querySelectorAll('.jev-badge').forEach(b => b.remove()); else scan();
    }
    let removedCache = false;
    for (const [key, change] of Object.entries(ch)) {
      if (key.startsWith('#') && change.newValue === undefined) { delete memCache[key]; removedCache = true; }
    }
    if (removedCache) scan();
  });

  let timer = null;
  new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(scan, 400); })
    .observe(document.body, { childList: true, subtree: true });
})();
