/**
 * storage.js
 * LocalStorage 안전 래퍼.
 * - 모든 키에 네임스페이스 접두사를 붙여 충돌을 방지합니다.
 * - JSON 직렬화/역직렬화를 자동 처리합니다.
 * - 사생활 보호 모드/용량 초과 등 예외 상황에서 앱이 죽지 않도록 방어합니다.
 */

const NS = 'bibleScribe:';

/**
 * LocalStorage 사용 가능 여부를 한 번만 검사해 캐싱합니다.
 * @returns {boolean}
 */
let _available = null;
function isAvailable() {
  if (_available !== null) return _available;
  try {
    const testKey = `${NS}__test__`;
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    _available = true;
  } catch (e) {
    console.warn('[storage] LocalStorage를 사용할 수 없습니다. 메모리 폴백을 사용합니다.', e);
    _available = false;
  }
  return _available;
}

// LocalStorage를 못 쓸 때를 위한 메모리 폴백 저장소.
const _memory = new Map();

/**
 * 값을 저장합니다. 객체는 자동으로 JSON 직렬화됩니다.
 * @param {string} key
 * @param {*} value
 * @returns {boolean} 성공 여부
 */
export function set(key, value) {
  const fullKey = NS + key;
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch (e) {
    console.error(`[storage] 직렬화 실패: ${key}`, e);
    return false;
  }

  if (isAvailable()) {
    try {
      window.localStorage.setItem(fullKey, serialized);
      return true;
    } catch (e) {
      // 용량 초과(QuotaExceededError) 등.
      console.error(`[storage] 저장 실패: ${key}`, e);
      _memory.set(fullKey, serialized);
      return false;
    }
  }
  _memory.set(fullKey, serialized);
  return true;
}

/**
 * 값을 읽어옵니다.
 * @param {string} key
 * @param {*} [fallback=null] 값이 없거나 파싱 실패 시 반환할 기본값
 * @returns {*}
 */
export function get(key, fallback = null) {
  const fullKey = NS + key;
  let raw = null;

  if (isAvailable()) {
    try {
      raw = window.localStorage.getItem(fullKey);
    } catch (e) {
      console.error(`[storage] 읽기 실패: ${key}`, e);
    }
  }
  if (raw === null && _memory.has(fullKey)) {
    raw = _memory.get(fullKey);
  }
  if (raw === null) return fallback;

  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error(`[storage] 파싱 실패: ${key}`, e);
    return fallback;
  }
}

/**
 * 키를 삭제합니다.
 * @param {string} key
 */
export function remove(key) {
  const fullKey = NS + key;
  if (isAvailable()) {
    try {
      window.localStorage.removeItem(fullKey);
    } catch (e) {
      console.error(`[storage] 삭제 실패: ${key}`, e);
    }
  }
  _memory.delete(fullKey);
}

/**
 * 이 앱이 저장한 모든 데이터를 초기화합니다. (다른 앱 데이터는 건드리지 않음)
 */
export function clearAll() {
  if (isAvailable()) {
    try {
      const keys = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(NS)) keys.push(k);
      }
      keys.forEach((k) => window.localStorage.removeItem(k));
    } catch (e) {
      console.error('[storage] 초기화 실패', e);
    }
  }
  _memory.clear();
}
