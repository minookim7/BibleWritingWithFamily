/**
 * helpers.js
 * 여러 모듈에서 공통으로 쓰는 순수 함수 모음.
 * DOM 삽입은 항상 textContent를 사용하므로 XSS로부터 안전합니다.
 */

/**
 * 짧은 querySelector 별칭.
 * @param {string} sel
 * @param {ParentNode} [root=document]
 * @returns {Element|null}
 */
export const qs = (sel, root = document) => root.querySelector(sel);

/**
 * querySelectorAll을 배열로 반환.
 * @param {string} sel
 * @param {ParentNode} [root=document]
 * @returns {Element[]}
 */
export const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/**
 * 안전한 엘리먼트 생성기. 텍스트는 textContent로만 넣어 XSS를 차단합니다.
 * @param {string} tag
 * @param {Object} [opts]
 * @param {string} [opts.className]
 * @param {string} [opts.text]
 * @param {Object} [opts.attrs] 속성 맵
 * @param {Element[]} [opts.children]
 * @returns {HTMLElement}
 */
export function el(tag, opts = {}) {
  const node = document.createElement(tag);
  if (opts.className) node.className = opts.className;
  if (opts.text != null) node.textContent = String(opts.text);
  if (opts.value != null) node.value = opts.value;
  if (opts.attrs) {
    for (const [k, v] of Object.entries(opts.attrs)) {
      node.setAttribute(k, String(v));
    }
  }
  if (opts.children) {
    opts.children.forEach((c) => c && node.appendChild(c));
  }
  return node;
}

/**
 * 밀리초를 "1분 23초" 형태 문자열로.
 * @param {number} ms
 * @returns {string}
 */
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts = [];
  if (h) parts.push(`${h}시간`);
  if (m) parts.push(`${m}분`);
  parts.push(`${s}초`);
  return parts.join(' ');
}

/**
 * 밀리초를 "MM:SS" 시계 형태로 (경과시간 표시용).
 * @param {number} ms
 * @returns {string}
 */
export function formatClock(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const m = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

/**
 * Date를 "YYYY-MM-DD" 로컬 문자열로. Streak/기록 키에 사용.
 * @param {Date} [date=new Date()]
 * @returns {string}
 */
export function dateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 사람이 읽는 한국어 날짜. 예: "2026년 7월 10일 금요일"
 * @param {Date} [date=new Date()]
 * @returns {string}
 */
export function humanDate(date = new Date()) {
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 ${days[date.getDay()]}요일`;
}

/**
 * 디바운스. 연속 호출 중 마지막 것만 실행.
 * @param {Function} fn
 * @param {number} wait
 * @returns {Function}
 */
export function debounce(fn, wait = 200) {
  let t = null;
  let lastArgs = null;
  let lastThis = null;
  function debounced(...args) {
    lastArgs = args;
    lastThis = this;
    clearTimeout(t);
    t = setTimeout(() => { t = null; fn.apply(lastThis, lastArgs); }, wait);
  }
  // 예약된 호출 취소(실행하지 않음).
  debounced.cancel = () => { clearTimeout(t); t = null; };
  // 예약된 호출을 즉시 실행(대기 없이 지금 저장 등).
  debounced.flush = () => {
    if (t !== null) { clearTimeout(t); t = null; fn.apply(lastThis, lastArgs); }
  };
  return debounced;
}

/**
 * 값을 [min, max] 범위로 제한.
 * @param {number} v
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

/**
 * 배열에서 무작위 원소 하나.
 * @param {Array} arr
 * @returns {*}
 */
export function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
