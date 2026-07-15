/**
 * typing.js
 * 필사(타자) 엔진.
 * - 한글 IME 조합을 정확히 처리합니다(조합 중에는 채점하지 않음).
 * - 각 글자를 맞음/틀림/현재로 분류해 색상 표시용 데이터를 제공합니다.
 * - CPM / WPM / 정확도 / 진행률 / 오타수 등 실시간 통계를 계산합니다.
 * - 붙여넣기와 자동완성 입력을 차단합니다.
 *
 * 이 클래스는 DOM을 직접 그리지 않고, 콜백으로 상태를 전달합니다.
 * 화면 렌더링은 app.js가 담당합니다(관심사 분리).
 */

export class TypingEngine {
  /**
   * @param {Object} opts
   * @param {string} opts.target 필사할 목표 텍스트
   * @param {(state:Object)=>void} opts.onUpdate 매 입력마다 호출
   * @param {(summary:Object)=>void} opts.onComplete 완료 시 호출
   */
  constructor({ target, onUpdate, onComplete, initialTyped, initialElapsed }) {
    this.target = target || '';
    this.onUpdate = onUpdate || (() => {});
    this.onComplete = onComplete || (() => {});

    // 이어하기: 저장된 입력을 복원. target을 넘지 않도록 잘라냄.
    this.typed = (initialTyped || '').slice(0, this.target.length);
    this.composing = false;   // IME 조합 중 여부
    // 경과 시간을 이어받으면, 시작 시각을 과거로 당겨 누적 시간이 유지되게 함.
    this.startTime = this.typed.length > 0
      ? performance.now() - (initialElapsed || 0)
      : null;
    this.finished = false;
    this.mistakeCount = 0;    // 누적 오타(잘못 확정된 글자 수)
    this._prevTypedLen = this.typed.length; // 오타 집계용 이전 길이
  }

  /** 입력 엘리먼트(textarea)를 연결하고 이벤트를 겁니다. */
  attach(inputEl) {
    this.input = inputEl;
    // 이어하기: 복원된 입력이 있으면 그대로 표시, 없으면 빈 값.
    this.input.value = this.typed;

    // IME 조합 시작/끝 추적. 조합 중에는 채점을 미룹니다.
    this._onCompositionStart = () => { this.composing = true; };
    this._onCompositionEnd = () => {
      this.composing = false;
      this._handleValue();
    };
    this._onInput = (e) => {
      // 붙여넣기/드래그/자동완성 등 비타이핑 입력 차단.
      if (e.inputType === 'insertFromPaste' ||
          e.inputType === 'insertFromDrop' ||
          e.inputType === 'insertReplacementText') {
        this.input.value = this.typed;
        return;
      }
      if (this.composing) return; // 조합 완료(compositionend)에서 처리
      this._handleValue();
    };
    this._onPaste = (e) => e.preventDefault();
    this._onDrop = (e) => e.preventDefault();
    // 복사/잘라내기는 허용하되 붙여넣기만 막습니다.
    this._onKeydown = (e) => {
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'v') e.preventDefault();
    };

    this.input.addEventListener('compositionstart', this._onCompositionStart);
    this.input.addEventListener('compositionend', this._onCompositionEnd);
    this.input.addEventListener('input', this._onInput);
    this.input.addEventListener('paste', this._onPaste);
    this.input.addEventListener('drop', this._onDrop);
    this.input.addEventListener('keydown', this._onKeydown);
  }

  /** 이벤트 해제(메모리 누수 방지). */
  detach() {
    if (!this.input) return;
    this.input.removeEventListener('compositionstart', this._onCompositionStart);
    this.input.removeEventListener('compositionend', this._onCompositionEnd);
    this.input.removeEventListener('input', this._onInput);
    this.input.removeEventListener('paste', this._onPaste);
    this.input.removeEventListener('drop', this._onDrop);
    this.input.removeEventListener('keydown', this._onKeydown);
    this.input = null;
  }

  /** 입력값을 읽어 상태를 갱신합니다. */
  _handleValue() {
    if (this.finished) return;
    let value = this.input.value;

    // 목표 길이를 넘겨 입력하지 못하도록 자릅니다.
    if (value.length > this.target.length) {
      value = value.slice(0, this.target.length);
      this.input.value = value;
    }

    if (this.startTime === null && value.length > 0) {
      this.startTime = performance.now();
    }

    // 새로 확정된 글자에 대해 오타를 집계합니다.
    if (value.length > this._prevTypedLen) {
      for (let i = this._prevTypedLen; i < value.length; i++) {
        if (value[i] !== this.target[i]) this.mistakeCount++;
      }
    }
    this._prevTypedLen = value.length;
    this.typed = value;

    const state = this.computeState();
    this.onUpdate(state);

    // 완료 판정: 길이가 같고 모든 글자가 정확할 때.
    if (value.length === this.target.length && state.correctChars === this.target.length) {
      this.finished = true;
      this.onComplete(this.summary());
    }
  }

  /** 렌더링·통계용 현재 상태를 계산합니다. */
  computeState() {
    const chars = [];
    let correct = 0;
    for (let i = 0; i < this.target.length; i++) {
      const expected = this.target[i];
      let status = 'pending';
      if (i < this.typed.length) {
        status = this.typed[i] === expected ? 'correct' : 'wrong';
        if (status === 'correct') correct++;
      } else if (i === this.typed.length) {
        status = 'current';
      }
      chars.push({ char: expected, status });
    }

    const elapsed = this.startTime ? performance.now() - this.startTime : 0;
    const minutes = elapsed / 60000;
    const cpm = minutes > 0 ? Math.round(this.typed.length / minutes) : 0;
    const wpm = minutes > 0 ? Math.round((this.typed.length / 5) / minutes) : 0;
    // 정확도: 지금까지 친 글자 중 목표와 일치하는 비율.
    const accuracy = this.typed.length > 0
      ? Math.round((correct / this.typed.length) * 100)
      : 100;
    const progress = this.target.length > 0
      ? Math.round((this.typed.length / this.target.length) * 100)
      : 0;

    return {
      chars,
      cpm,
      wpm,
      accuracy,
      progress,
      elapsed,
      correctChars: correct,
      typedChars: this.typed.length,
      remaining: this.target.length - this.typed.length,
      mistakes: this.mistakeCount,
      cursorIndex: this.typed.length,
    };
  }

  /** 완료 요약. */
  summary() {
    const s = this.computeState();
    return {
      elapsed: s.elapsed,
      cpm: s.cpm,
      wpm: s.wpm,
      accuracy: s.accuracy,
      totalChars: this.target.length,
      mistakes: this.mistakeCount,
    };
  }

  /** 처음부터 다시. */
  reset() {
    this.typed = '';
    this.composing = false;
    this.startTime = null;
    this.finished = false;
    this.mistakeCount = 0;
    this._prevTypedLen = 0;
    if (this.input) {
      this.input.value = '';
      this.input.focus();
    }
    this.onUpdate(this.computeState());
  }
}
