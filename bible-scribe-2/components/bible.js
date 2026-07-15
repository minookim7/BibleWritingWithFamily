/**
 * bible.js
 * 성경 데이터 접근 계층.
 * - books.json(색인)과 개별 책 JSON을 fetch로 읽어옵니다.
 * - 한 번 읽은 책은 메모리에 캐싱해 재요청을 막습니다. (Lazy Loading)
 * - 외부 데이터를 신뢰하지 않고 구조를 검증합니다.
 */

const DATA_DIR = './data/';

let _index = null;                 // books.json 캐시
const _bookCache = new Map();      // id -> 검증된 book 객체

/**
 * 책 색인(books.json)을 읽어옵니다.
 * @returns {Promise<Object>} { testaments: [...] }
 */
export async function loadIndex() {
  if (_index) return _index;
  const res = await fetch(`${DATA_DIR}books.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`책 목록을 불러오지 못했습니다 (${res.status})`);
  const data = await res.json();
  if (!data || !Array.isArray(data.testaments)) {
    throw new Error('책 목록 형식이 올바르지 않습니다.');
  }
  _index = data;
  return _index;
}

/**
 * 색인을 평탄화한 전체 책 목록.
 * @returns {Promise<Array<{id,name,chapters,file,testament}>>}
 */
export async function listBooks() {
  const idx = await loadIndex();
  const out = [];
  idx.testaments.forEach((t) => {
    (t.books || []).forEach((b) => out.push({ ...b, testament: t.name }));
  });
  return out;
}

/**
 * 색인에서 특정 책 메타데이터를 찾습니다.
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
export async function findBookMeta(id) {
  const books = await listBooks();
  return books.find((b) => b.id === id) || null;
}

/**
 * 개별 책 본문을 읽어옵니다. (캐싱)
 * @param {string} id 예: "genesis"
 * @returns {Promise<{book:string,id:string,chapters:string[][]}>}
 */
export async function loadBook(id) {
  if (_bookCache.has(id)) return _bookCache.get(id);

  const meta = await findBookMeta(id);
  if (!meta) throw new Error(`알 수 없는 책입니다: ${id}`);

  const res = await fetch(`${DATA_DIR}${meta.file}`, { cache: 'no-cache' });
  if (!res.ok) {
    throw new Error(`"${meta.name}" 본문 파일이 아직 준비되지 않았습니다.`);
  }
  const data = await res.json();
  validateBook(data, meta.name);

  const book = { book: data.book || meta.name, id, chapters: data.chapters };
  _bookCache.set(id, book);
  return book;
}

/**
 * 특정 장의 절 배열을 반환.
 * @param {string} id
 * @param {number} chapterIndex 0-base
 * @returns {Promise<string[]>}
 */
export async function loadChapter(id, chapterIndex) {
  const book = await loadBook(id);
  const chapter = book.chapters[chapterIndex];
  if (!Array.isArray(chapter)) {
    throw new Error('해당 장이 존재하지 않습니다.');
  }
  return chapter;
}

/**
 * 데이터 어딘가에서 무작위 구절 하나를 뽑습니다. (오늘의 말씀/랜덤 구절용)
 * 이미 로드된 책이 있으면 그 중에서, 없으면 첫 책을 로드해 사용합니다.
 * @param {string[]} [preferredIds] 우선 탐색할 책 id 목록
 * @returns {Promise<{bookId,bookName,chapter,verse,text}>}
 */
export async function randomVerse(preferredIds = []) {
  const books = await listBooks();
  const candidates = preferredIds.length ? preferredIds : [books[0].id];
  for (const id of candidates) {
    try {
      const book = await loadBook(id);
      const ci = Math.floor(Math.random() * book.chapters.length);
      const verses = book.chapters[ci];
      const vi = Math.floor(Math.random() * verses.length);
      const meta = books.find((b) => b.id === id);
      return {
        bookId: id,
        bookName: meta ? meta.name : book.book,
        chapter: ci,
        verse: vi,
        text: verses[vi],
      };
    } catch (e) {
      // 이 책 파일이 없으면 다음 후보로.
      continue;
    }
  }
  throw new Error('사용할 수 있는 본문이 없습니다.');
}

/**
 * 로드된(캐싱된) 책들 안에서 텍스트 검색.
 * 파일을 전부 내려받지 않으므로, 미리 로드된 책 위주로 동작합니다.
 * @param {string} query
 * @param {number} [limit=30]
 * @returns {Array<{bookId,bookName,chapter,verse,text}>}
 */
export function searchLoaded(query, limit = 30) {
  const q = query.trim();
  if (!q) return [];
  const results = [];
  for (const [id, book] of _bookCache) {
    book.chapters.forEach((verses, ci) => {
      verses.forEach((text, vi) => {
        if (text.includes(q)) {
          results.push({ bookId: id, bookName: book.book, chapter: ci, verse: vi, text });
        }
      });
    });
    if (results.length >= limit) break;
  }
  return results.slice(0, limit);
}

/**
 * 책 데이터 구조 검증. 신뢰할 수 없는 외부 JSON을 방어합니다.
 * @param {*} data
 * @param {string} name
 */
function validateBook(data, name) {
  if (!data || typeof data !== 'object') {
    throw new Error(`"${name}" 데이터가 비어 있습니다.`);
  }
  if (!Array.isArray(data.chapters) || data.chapters.length === 0) {
    throw new Error(`"${name}"에 장 정보가 없습니다.`);
  }
  const badChapter = data.chapters.some(
    (ch) => !Array.isArray(ch) || ch.some((v) => typeof v !== 'string')
  );
  if (badChapter) {
    throw new Error(`"${name}" 본문 형식이 올바르지 않습니다.`);
  }
}
