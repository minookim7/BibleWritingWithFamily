/* =================================================================
   성경 필사 2.0 — app.js (오케스트레이터)
   검증된 코어(bible/typing/stats/audio/storage/helpers)를 그대로 사용.
   새로운 것: 고정 시선 렌더링, 견고한 로컬 자동저장/이어하기.
   서비스워커 없음 → 오프라인 관련 문제 원천 제거.
   ================================================================= */
import * as bible from './components/bible.js';
import * as stats from './components/stats.js';
import { TypingEngine } from './components/typing.js';
import { AudioManager } from './components/audio.js';
import * as storage from './utils/storage.js';
import { qs, qsa, el, formatClock, humanDate, dateKey, debounce, randomItem } from './utils/helpers.js';

const audio = new AudioManager();
let engine = null;
let currentRef = null;          // { bookId, bookName, chapter }
let currentTarget = '';
let currentProgressKey = null;
let verseStartAt = {};
let memorizeMode = false;
let calCursor = new Date();
let _lastCursor = -1;

const DEFAULT_SETTINGS = {
  theme: 'ink', font: 'serif', size: 30, line: 2.1,
  autosave: true, sfx: true, track: 'none', volume: 45,
};
let settings = { ...DEFAULT_SETTINGS, ...storage.get('settings', {}) };

/* ---------- 자동 저장 (로컬) ---------- */
const PROGRESS_PREFIX = 'progress:';
const autosave = debounce(() => {
  if (!settings.autosave || !engine || !currentProgressKey) return;
  const s = engine.computeState();
  if (s.typedChars > 0 && s.remaining > 0) {
    storage.set(currentProgressKey, {
      bookId: currentRef.bookId, bookName: currentRef.bookName, chapter: currentRef.chapter,
      typed: engine.typed, elapsed: s.elapsed, progress: s.progress, savedAt: Date.now(),
    });
    note('저장됨');
  }
}, 500);

function saveNow() {
  if (!settings.autosave || !engine || !currentProgressKey) return;
  const s = engine.computeState();
  if (s.typedChars > 0 && s.remaining > 0) {
    autosave.cancel();
    storage.set(currentProgressKey, {
      bookId: currentRef.bookId, bookName: currentRef.bookName, chapter: currentRef.chapter,
      typed: engine.typed, elapsed: s.elapsed, progress: s.progress, savedAt: Date.now(),
    });
  }
}

function allProgress() {
  // storage에 저장된 모든 진행분을 모아 최근순으로.
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const fullKey = localStorage.key(i);
      // storage NS('bibleScribe:') + 'progress:bookId:chapter'
      const idx = fullKey ? fullKey.indexOf(PROGRESS_PREFIX) : -1;
      if (idx >= 0) {
        const logicalKey = fullKey.slice(fullKey.indexOf(':') + 1); // NS 제거
        const data = storage.get(logicalKey, null);
        if (data && data.typed) out.push({ key: logicalKey, ...data });
      }
    }
  } catch (e) { /* noop */ }
  return out.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}

/* ---------- 초기화 ---------- */
async function init() {
  applySettings();
  await populateBooks();
  bindGlobalEvents();
  bindSettingControls();
  renderResumeAndFav();
}

/* ---------- 설정 ---------- */
function applySettings() {
  document.documentElement.dataset.theme = settings.theme;
  document.documentElement.style.setProperty('--passage-font',
    settings.font === 'serif' ? 'var(--font-serif)' : 'var(--font-sans)');
  document.documentElement.style.setProperty('--passage-size', settings.size + 'px');
  document.documentElement.style.setProperty('--passage-line', String(settings.line));
  audio.setVolume(settings.volume / 100);
  audio.sfxEnabled = settings.sfx;
  if (audio.setMusicEnabled) audio.setMusicEnabled(settings.track !== 'none');
  // 컨트롤 반영
  const set = (id, v, prop = 'value') => { const e = qs(id); if (e) e[prop] = v; };
  set('#set-theme', settings.theme); set('#set-font', settings.font);
  set('#set-size', settings.size); set('#set-line', settings.line);
  set('#set-autosave', settings.autosave, 'checked'); set('#set-sfx', settings.sfx, 'checked');
  set('#set-track', settings.track); set('#set-volume', settings.volume);
}
function saveSettings() { storage.set('settings', settings); }

/* ---------- 책/장 선택 ---------- */
async function populateBooks() {
  const books = await bible.listBooks();
  const sel = qs('#select-book');
  sel.innerHTML = '';
  books.forEach((b) => {
    const o = el('option', { value: b.id, text: b.name });
    sel.appendChild(o);
  });
  const last = storage.get('lastSelection', null);
  if (last) { sel.value = last.bookId; }
  await populateChapters();
  if (last) qs('#select-chapter').value = last.chapter;
}

async function populateChapters() {
  const bookId = qs('#select-book').value;
  const meta = await bible.findBookMeta(bookId);
  const sel = qs('#select-chapter');
  sel.innerHTML = '';
  for (let i = 0; i < meta.chapters; i++) {
    sel.appendChild(el('option', { value: String(i), text: `${i + 1}장` }));
  }
}

/* ---------- 필사 시작 ---------- */
async function startScribe(bookId, chapter) {
  const meta = await bible.findBookMeta(bookId);
  const verses = await bible.loadChapter(bookId, chapter);
  const target = verses.join(' ');
  currentTarget = target;

  // 절 경계 기록 (표시용, 타이핑 대상 아님)
  verseStartAt = {};
  let pos = 0;
  verses.forEach((v, i) => { verseStartAt[pos] = i + 1; pos += v.length + 1; });

  currentRef = { bookId, bookName: meta.name, chapter };
  currentProgressKey = `${PROGRESS_PREFIX}${bookId}:${chapter}`;
  storage.set('lastSelection', { bookId, chapter });
  stats.pushRecent(currentRef);

  qs('#scribe-ref').textContent = `${meta.name} ${chapter + 1}장`;
  updateFavButton();

  // 이어하기 복원
  const saved = storage.get(currentProgressKey, null);
  let initialTyped = '', initialElapsed = 0;
  if (saved && saved.typed && saved.typed.length > 0 && saved.typed.length < target.length) {
    initialTyped = saved.typed; initialElapsed = saved.elapsed || 0;
  }

  if (engine) engine.detach();
  engine = new TypingEngine({
    target, initialTyped, initialElapsed,
    onUpdate: renderTypingState, onComplete: onComplete,
  });

  _lastCursor = -1;
  switchView('scribe');
  const input = qs('#typing-input');
  engine.attach(input);
  renderTypingState(engine.computeState());
  requestAnimationFrame(() => input.focus());

  if (initialTyped) {
    const pct = Math.round((initialTyped.length / target.length) * 100);
    note(`${pct}% 지점부터 이어서 필사합니다`);
    announce(`이어서 필사합니다. ${pct}% 지점부터 시작합니다.`);
  } else {
    note('');
  }
}

/* ---------- 필사 화면 렌더링 (고정 시선) ---------- */
function renderTypingState(state) {
  const passage = qs('#passage');
  const frag = document.createDocumentFragment();
  state.chars.forEach((c, i) => {
    if (verseStartAt[i]) {
      const badge = el('span', { className: 'verse-no', text: String(verseStartAt[i]) });
      badge.setAttribute('aria-hidden', 'true');
      frag.appendChild(badge);
    }
    const isSpace = c.char === ' ';
    frag.appendChild(el('span', {
      className: `ch ${c.status}${isSpace ? ' space' : ''}`,
      text: isSpace ? '\u00A0' : c.char,
    }));
  });
  passage.textContent = '';
  passage.appendChild(frag);
  passage.classList.toggle('is-hidden', memorizeMode);

  // 통계
  qs('#stat-progress').textContent = state.progress + '%';
  qs('#stat-cpm').textContent = state.cpm;
  qs('#stat-accuracy').textContent = state.accuracy + '%';
  qs('#stat-time').textContent = formatClock(state.elapsed);
  qs('#stat-mistakes').textContent = state.mistakes;
  qs('#progress-fill').style.width = state.progress + '%';

  // 타건음
  if (state.cursorIndex > _lastCursor && _lastCursor >= 0) {
    const just = state.chars[state.cursorIndex - 1];
    if (just && settings.sfx) audio.keyClick(just.status === 'correct');
  }
  _lastCursor = state.cursorIndex;

  // 고정 시선: 현재 글자가 gaze 중앙에 오도록 passage를 transform으로 이동
  requestAnimationFrame(() => positionGaze());

  // 자동 저장
  if (state.typedChars > 0 && state.remaining > 0) autosave();
}

function positionGaze() {
  const gaze = qs('#gaze');
  const passage = qs('#passage');
  const cur = qs('.ch.current', passage);
  if (!gaze || !passage) return;
  const target = cur || qs('.ch.correct:last-of-type', passage);
  if (!target) { passage.style.transform = 'translateY(0)'; return; }
  // 현재 글자의 passage 내부 상대 위치
  const passRect = passage.getBoundingClientRect();
  const curRect = target.getBoundingClientRect();
  const gazeRect = gaze.getBoundingClientRect();
  // 현재 글자의 세로 중심을 gaze 세로 중심에 맞춘다
  const curCenterInPassage = (curRect.top - passRect.top) + curRect.height / 2;
  const desired = gazeRect.height / 2 - curCenterInPassage;
  // 위로만 올리고(양수 translateY로 시작 여백 허용), 과하게 내려가지 않게 clamp
  const clamped = Math.min(gazeRect.height * 0.42, desired);
  passage.style.transform = `translateY(${clamped}px)`;
}

/* ---------- 완료 ---------- */
function onComplete(summary) {
  if (settings.sfx) audio.fanfare();
  stats.recordSession({ ...currentRef, summary });
  if (currentProgressKey) { autosave.cancel(); storage.remove(currentProgressKey); }

  qs('#done-ref').textContent = `${currentRef.bookName} ${currentRef.chapter + 1}장`;
  qs('#done-time').textContent = formatClock(summary.elapsed);
  qs('#done-cpm').textContent = summary.cpm;
  qs('#done-accuracy').textContent = summary.accuracy + '%';
  switchView('done');
  renderResumeAndFav();
}

/* ---------- 뷰 전환 ---------- */
function switchView(name) {
  qsa('.view').forEach((v) => { v.hidden = true; });
  qs('#view-' + name).hidden = false;
  if (name !== 'scribe') { saveNow(); }
  window.scrollTo(0, 0);
}
function backToSelect() {
  saveNow();
  if (engine) engine.detach();
  renderResumeAndFav();
  switchView('select');
}

/* ---------- 이어하기 & 즐겨찾기 목록 ---------- */
function renderResumeAndFav() {
  // 이어하기
  const resume = allProgress();
  const rlist = qs('#resume-list');
  const rbtn = qs('#btn-resume');
  rlist.innerHTML = '';
  if (resume.length === 0) {
    rlist.appendChild(el('p', { className: 'empty-hint', text: '아직 저장된 필사가 없어요.' }));
    if (rbtn) rbtn.hidden = true;
  } else {
    if (rbtn) rbtn.hidden = false;
    resume.slice(0, 6).forEach((p) => {
      const chip = el('button', { className: 'chip' });
      chip.appendChild(el('span', { text: `${p.bookName} ${p.chapter + 1}장` }));
      chip.appendChild(el('span', { className: 'chip-meta', text: `${p.progress || 0}%` }));
      chip.addEventListener('click', () => startScribe(p.bookId, p.chapter));
      rlist.appendChild(chip);
    });
  }

  // 즐겨찾기
  const favs = stats.getFavorites();
  const flist = qs('#fav-list');
  flist.innerHTML = '';
  if (!favs || favs.length === 0) {
    flist.appendChild(el('p', { className: 'empty-hint', text: '별표한 장이 여기 모여요.' }));
  } else {
    favs.slice(0, 6).forEach((f) => {
      const chip = el('button', { className: 'chip' });
      chip.appendChild(el('span', { text: `${f.bookName} ${f.chapter + 1}장` }));
      chip.addEventListener('click', () => startScribe(f.bookId, f.chapter));
      flist.appendChild(chip);
    });
  }
}

function updateFavButton() {
  const btn = qs('#btn-fav');
  if (!btn || !currentRef) return;
  const on = stats.isFavorite(currentRef.bookId, currentRef.chapter);
  btn.textContent = on ? '★' : '☆';
  btn.classList.toggle('on', on);
}

/* ---------- 검색 ---------- */
const runSearch = debounce(async (q) => {
  const box = qs('#search-results');
  box.innerHTML = '';
  if (!q || q.trim().length < 2) return;
  const hits = bible.searchLoaded(q.trim(), 20);
  if (hits.length === 0) {
    box.appendChild(el('p', { className: 'empty-hint', text: '불러온 본문에서 찾지 못했어요. (아직 열지 않은 책은 검색되지 않습니다)' }));
    return;
  }
  hits.forEach((h) => {
    const btn = el('button', { className: 'search-hit' });
    btn.appendChild(el('span', { className: 'hit-ref', text: `${h.bookName} ${h.chapter + 1}:${h.verse + 1}` }));
    btn.appendChild(document.createTextNode(h.text));
    btn.addEventListener('click', () => startScribe(h.bookId, h.chapter));
    box.appendChild(btn);
  });
}, 250);

/* ---------- 기록 ---------- */
function openRecords() {
  const s = stats.summaryStats();
  const grid = qs('#record-grid');
  grid.innerHTML = '';
  const cells = [
    ['오늘 (자)', s.todayChars],
    ['이번 주 (자)', s.weekChars],
    ['이번 달 (자)', s.monthChars],
    ['전체 (자)', s.totalChars],
    ['필사 횟수', s.sessionCount],
    ['최고 타/분', s.bestCpm],
    ['평균 정확도', s.avgAccuracy + '%'],
    ['연속', s.streak + '일'],
  ];
  cells.forEach(([label, val]) => {
    const c = el('div', { className: 'record-cell' });
    c.appendChild(el('b', { text: String(val) }));
    c.appendChild(el('span', { text: label }));
    grid.appendChild(c);
  });
  renderCalendar();
  switchView('records');
}

function renderCalendar() {
  const y = calCursor.getFullYear(), m = calCursor.getMonth();
  qs('#cal-label').textContent = `${y}년 ${m + 1}월`;
  const active = stats.activeDaysInMonth(y, m);
  const first = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const cal = qs('#calendar');
  cal.innerHTML = '';
  ['일','월','화','수','목','금','토'].forEach((d) =>
    cal.appendChild(el('div', { className: 'cal-cell blank', text: d })));
  for (let i = 0; i < first; i++) cal.appendChild(el('div', { className: 'cal-cell blank' }));
  for (let d = 1; d <= days; d++) {
    const cell = el('div', { className: 'cal-cell' + (active.includes(d) ? ' active' : ''), text: String(d) });
    cal.appendChild(cell);
  }
}

function exportCsv() {
  const sessions = stats.allSessions();
  const header = '날짜,책,장,걸린시간(초),타per분,정확도(%),오타\n';
  const rows = sessions.map((s) =>
    `${humanDate(new Date(s.ts))},${s.bookName},${s.chapter + 1},${Math.round((s.ms || 0) / 1000)},${s.cpm},${s.accuracy},${s.mistakes}`
  ).join('\n');
  const blob = new Blob(['\uFEFF' + header + rows], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = el('a', {}); a.href = url; a.download = 'bible-scribe-records.csv';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

/* ---------- 이벤트 바인딩 ---------- */
function bindGlobalEvents() {
  // 종료/백그라운드 시 저장 flush
  const flush = () => saveNow();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);

  qs('#btn-home').addEventListener('click', backToSelect);
  qs('#btn-records').addEventListener('click', openRecords);
  qs('#btn-theme').addEventListener('click', () => {
    const order = ['ink', 'paper', 'sepia'];
    settings.theme = order[(order.indexOf(settings.theme) + 1) % order.length];
    applySettings(); saveSettings();
  });
  qs('#btn-settings').addEventListener('click', () => { qs('#settings-overlay').hidden = false; });
  qs('#btn-settings-close').addEventListener('click', () => { qs('#settings-overlay').hidden = true; });
  qs('#settings-overlay').addEventListener('click', (e) => {
    if (e.target === qs('#settings-overlay')) qs('#settings-overlay').hidden = true;
  });

  qs('#select-book').addEventListener('change', populateChapters);
  qs('#btn-start').addEventListener('click', () => {
    startScribe(qs('#select-book').value, Number(qs('#select-chapter').value));
  });
  qs('#btn-today').addEventListener('click', async () => {
    const books = await bible.listBooks();
    // 날짜 시드로 오늘의 책·장을 고정
    const seed = Number(dateKey().replace(/-/g, ''));
    const book = books[seed % books.length];
    const meta = await bible.findBookMeta(book.id);
    const chapter = seed % meta.chapters;
    startScribe(book.id, chapter);
  });
  qs('#btn-random').addEventListener('click', async () => {
    const books = await bible.listBooks();
    const book = randomItem(books);
    const meta = await bible.findBookMeta(book.id);
    const chapter = Math.floor(Math.random() * meta.chapters);
    startScribe(book.id, chapter);
  });
  qs('#btn-resume').addEventListener('click', () => {
    const p = allProgress()[0];
    if (p) startScribe(p.bookId, p.chapter);
  });

  qs('#search-input').addEventListener('input', (e) => runSearch(e.target.value));

  // 필사 화면
  qs('#btn-exit').addEventListener('click', backToSelect);
  qs('#btn-fav').addEventListener('click', () => {
    if (!currentRef) return;
    stats.toggleFavorite(currentRef);
    updateFavButton();
  });
  qs('#btn-memorize').addEventListener('click', () => {
    memorizeMode = !memorizeMode;
    qs('#passage').classList.toggle('is-hidden', memorizeMode);
    qs('#btn-memorize').classList.toggle('on', memorizeMode);
    qs('#typing-input').focus();
  });
  // 화면 아무 곳이나 탭하면 입력창 포커스(모바일)
  qs('#gaze').addEventListener('click', () => qs('#typing-input').focus());

  // 완료 화면
  qs('#btn-next').addEventListener('click', async () => {
    const meta = await bible.findBookMeta(currentRef.bookId);
    if (currentRef.chapter + 1 < meta.chapters) startScribe(currentRef.bookId, currentRef.chapter + 1);
    else backToSelect();
  });
  qs('#btn-retry').addEventListener('click', () => {
    if (currentProgressKey) storage.remove(currentProgressKey);
    if (engine) { engine.reset(); _lastCursor = -1; switchView('scribe'); qs('#typing-input').focus(); }
  });
  qs('#btn-done-home').addEventListener('click', backToSelect);

  // 기록 화면
  qs('#btn-records-back').addEventListener('click', backToSelect);
  qs('#cal-prev').addEventListener('click', () => { calCursor.setMonth(calCursor.getMonth() - 1); renderCalendar(); });
  qs('#cal-next').addEventListener('click', () => { calCursor.setMonth(calCursor.getMonth() + 1); renderCalendar(); });
  qs('#btn-export').addEventListener('click', exportCsv);
}

function bindSettingControls() {
  const bind = (id, key, transform = (v) => v, evt = 'change') => {
    const e = qs(id); if (!e) return;
    e.addEventListener(evt, () => {
      const val = e.type === 'checkbox' ? e.checked : transform(e.value);
      settings[key] = val; applySettings(); saveSettings();
    });
  };
  bind('#set-theme', 'theme');
  bind('#set-font', 'font');
  bind('#set-size', 'size', Number, 'input');
  bind('#set-line', 'line', Number, 'input');
  bind('#set-autosave', 'autosave');
  bind('#set-sfx', 'sfx');
  bind('#set-track', 'track');
  bind('#set-volume', 'volume', Number, 'input');
}

/* ---------- 유틸 ---------- */
function announce(msg) { qs('#sr-live').textContent = msg; }
let noteTimer = null;
function note(msg) {
  const n = qs('#autosave-note');
  if (!n) return;
  n.textContent = msg;
  clearTimeout(noteTimer);
  if (msg === '저장됨') noteTimer = setTimeout(() => { n.textContent = ''; }, 1500);
}

init();
