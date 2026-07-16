/**
 * stats.js
 * 필사 기록과 통계.
 * - 완료 세션을 저장하고, 총합/최고/평균/연속(Streak)을 계산합니다.
 * - LocalStorage(storage.js)를 백엔드로 사용합니다.
 */

import * as storage from '../utils/storage.js';
import { dateKey } from '../utils/helpers.js';

const KEY_SESSIONS = 'sessions';   // 완료 세션 배열
const KEY_FAVORITES = 'favorites'; // 즐겨찾기 배열
const KEY_RECENT = 'recent';       // 최근 읽은 구절 배열
const MAX_RECENT = 20;

/**
 * 완료 세션 하나를 기록합니다.
 * @param {Object} session
 * @param {string} session.bookId
 * @param {string} session.bookName
 * @param {number} session.chapter
 * @param {Object} session.summary typing 엔진의 summary()
 */
export function recordSession({ bookId, bookName, chapter, summary }) {
  const sessions = storage.get(KEY_SESSIONS, []);
  sessions.push({
    date: dateKey(),
    ts: Date.now(),
    bookId,
    bookName,
    chapter,
    chars: summary.totalChars,
    ms: summary.elapsed,
    cpm: summary.cpm,
    accuracy: summary.accuracy,
    mistakes: summary.mistakes,
  });
  storage.set(KEY_SESSIONS, sessions);
}

/** 전체 세션 배열. */
export function allSessions() {
  return storage.get(KEY_SESSIONS, []);
}

/**
 * 오늘/이번주/이번달/전체 요약 통계.
 * @returns {Object}
 */
export function summaryStats() {
  const sessions = allSessions();
  const now = new Date();
  const todayKey = dateKey(now);

  const startOfWeek = new Date(now);
  startOfWeek.setHours(0, 0, 0, 0);
  startOfWeek.setDate(now.getDate() - now.getDay()); // 일요일 시작
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const acc = {
    todayChars: 0, todayMs: 0,
    weekChars: 0, weekMs: 0,
    monthChars: 0, monthMs: 0,
    totalChars: 0, totalMs: 0,
    bestCpm: 0,
    accSum: 0, accCount: 0,
    sessionCount: sessions.length,
  };

  sessions.forEach((s) => {
    acc.totalChars += s.chars;
    acc.totalMs += s.ms;
    if (s.cpm > acc.bestCpm) acc.bestCpm = s.cpm;
    acc.accSum += s.accuracy;
    acc.accCount++;

    if (s.date === todayKey) { acc.todayChars += s.chars; acc.todayMs += s.ms; }
    if (s.ts >= startOfWeek.getTime()) { acc.weekChars += s.chars; acc.weekMs += s.ms; }
    if (s.ts >= startOfMonth.getTime()) { acc.monthChars += s.chars; acc.monthMs += s.ms; }
  });

  acc.avgAccuracy = acc.accCount ? Math.round(acc.accSum / acc.accCount) : 0;
  acc.streak = computeStreak(sessions);
  return acc;
}

/**
 * 연속 필사(Streak) 계산: 오늘(또는 어제)부터 거꾸로 며칠 연속 기록이 있는지.
 * @param {Array} [sessions]
 * @returns {number}
 */
export function computeStreak(sessions = allSessions()) {
  if (!sessions.length) return 0;
  const daysWithRecord = new Set(sessions.map((s) => s.date));
  let streak = 0;
  const cursor = new Date();
  // 오늘 기록이 없으면 어제부터 셉니다(오늘 아직 안 했을 수 있음).
  if (!daysWithRecord.has(dateKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }
  while (daysWithRecord.has(dateKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/**
 * 달력 표시용: 특정 연·월에 기록이 있는 날짜 집합.
 * @param {number} year
 * @param {number} month 0-base
 * @returns {Set<string>} dateKey 집합
 */
export function activeDaysInMonth(year, month) {
  const set = new Set();
  allSessions().forEach((s) => {
    const d = new Date(s.ts);
    if (d.getFullYear() === year && d.getMonth() === month) set.add(s.date);
  });
  return set;
}

/* ------------------------- 즐겨찾기 ------------------------- */

/** 즐겨찾기 목록. */
export function getFavorites() {
  return storage.get(KEY_FAVORITES, []);
}

/**
 * 즐겨찾기 토글.
 * @param {{bookId,bookName,chapter}} ref
 * @returns {boolean} 토글 후 즐겨찾기 상태(true=추가됨)
 */
export function toggleFavorite(ref) {
  const favs = getFavorites();
  const idx = favs.findIndex((f) => f.bookId === ref.bookId && f.chapter === ref.chapter);
  if (idx >= 0) {
    favs.splice(idx, 1);
    storage.set(KEY_FAVORITES, favs);
    return false;
  }
  favs.unshift({ ...ref, ts: Date.now() });
  storage.set(KEY_FAVORITES, favs);
  return true;
}

/** 특정 구절이 즐겨찾기인지. */
export function isFavorite(bookId, chapter) {
  return getFavorites().some((f) => f.bookId === bookId && f.chapter === chapter);
}

/* ------------------------- 최근 읽은 구절 ------------------------- */

/** 최근 목록에 추가(중복 제거, 최대 개수 유지). */
export function pushRecent(ref) {
  let recent = storage.get(KEY_RECENT, []);
  recent = recent.filter((r) => !(r.bookId === ref.bookId && r.chapter === ref.chapter));
  recent.unshift({ ...ref, ts: Date.now() });
  if (recent.length > MAX_RECENT) recent = recent.slice(0, MAX_RECENT);
  storage.set(KEY_RECENT, recent);
}

/** 최근 목록. */
export function getRecent() {
  return storage.get(KEY_RECENT, []);
}
