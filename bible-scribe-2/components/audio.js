/**
 * audio.js
 * 배경음악과 효과음.
 *
 * 저작권/오프라인 문제를 피하기 위해, 외부 음원 파일 대신
 * Web Audio API로 소리를 실시간 생성합니다. (빗소리·새소리·숲·계곡·피아노)
 * /music 폴더에 실제 파일을 넣고 싶다면 FILE_TRACKS 매핑만 채우면 됩니다.
 *
 * 오디오 컨텍스트는 사용자의 첫 상호작용 이후에만 시작됩니다(브라우저 정책).
 */

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.currentNodes = [];   // 현재 재생 중인 노드(정지 시 정리)
    this.currentTrack = 'none';
    this.volume = 0.5;
    this.musicEnabled = true;
    this.sfxEnabled = true;
    this._fileEl = null;      // 파일 기반 트랙용 <audio>
  }

  /** 첫 사용자 제스처에서 호출. AudioContext를 준비합니다. */
  _ensureContext() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      console.warn('[audio] 이 브라우저는 Web Audio를 지원하지 않습니다.');
      return;
    }
    this.ctx = new AC();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.volume;
    this.masterGain.connect(this.ctx.destination);
  }

  /** 볼륨 0~1 설정. */
  setVolume(v) {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.masterGain) this.masterGain.gain.value = this.volume;
    if (this._fileEl) this._fileEl.volume = this.volume;
  }

  setMusicEnabled(on) {
    this.musicEnabled = on;
    if (!on) this.stopMusic();
  }

  setSfxEnabled(on) { this.sfxEnabled = on; }

  /**
   * 배경 트랙 선택.
   * @param {'piano'|'rain'|'birds'|'forest'|'stream'|'none'} track
   * @param {boolean} [loop=true] 자동 반복
   */
  playTrack(track, loop = true) {
    this._ensureContext();
    if (!this.ctx) return;
    this.stopMusic();
    this.currentTrack = track;
    if (!this.musicEnabled || track === 'none') return;

    if (this.ctx.state === 'suspended') this.ctx.resume();

    switch (track) {
      case 'rain':   this._noiseBed({ lp: 1200, gain: 0.5 }); break;
      case 'stream': this._noiseBed({ lp: 800, gain: 0.4, wobble: true }); break;
      case 'forest': this._noiseBed({ lp: 500, gain: 0.25 }); this._birdChirps(); break;
      case 'birds':  this._birdChirps(); break;
      case 'piano':  this._pianoPad(); break;
      default: break;
    }
  }

  /** 재생 중인 배경음 정지. */
  stopMusic() {
    this.currentNodes.forEach((n) => {
      try { n.stop ? n.stop() : n.disconnect(); } catch (e) { /* 이미 정지됨 */ }
    });
    this.currentNodes = [];
    if (this._birdTimer) { clearInterval(this._birdTimer); this._birdTimer = null; }
    if (this._fileEl) { this._fileEl.pause(); this._fileEl = null; }
  }

  /** 키 입력 효과음(짧은 클릭). */
  keyClick(correct = true) {
    if (!this.sfxEnabled) return;
    this._ensureContext();
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = correct ? 660 : 180;
    const t = this.ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.12, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    osc.connect(gain).connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.09);
  }

  /** 완료 팡파르(상승 아르페지오). */
  fanfare() {
    if (!this.sfxEnabled) return;
    this._ensureContext();
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C E G C
    notes.forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      const t = this.ctx.currentTime + i * 0.12;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      osc.connect(gain).connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.42);
    });
  }

  /* ---------------- 내부: 소리 생성 헬퍼 ---------------- */

  /** 필터링된 화이트노이즈(비/계곡/숲 배경). */
  _noiseBed({ lp = 1000, gain = 0.4, wobble = false }) {
    const bufferSize = 2 * this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const out = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) out[i] = Math.random() * 2 - 1;

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = lp;

    const g = this.ctx.createGain();
    g.gain.value = gain;

    noise.connect(filter).connect(g).connect(this.masterGain);
    noise.start();
    this.currentNodes.push(noise);

    if (wobble) {
      const lfo = this.ctx.createOscillator();
      const lfoGain = this.ctx.createGain();
      lfo.frequency.value = 0.2;
      lfoGain.gain.value = 200;
      lfo.connect(lfoGain).connect(filter.frequency);
      lfo.start();
      this.currentNodes.push(lfo);
    }
  }

  /** 무작위 새소리 짹짹. */
  _birdChirps() {
    const chirp = () => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      const base = 1800 + Math.random() * 1200;
      const t = this.ctx.currentTime;
      osc.frequency.setValueAtTime(base, t);
      osc.frequency.linearRampToValueAtTime(base + 400, t + 0.08);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(gain).connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.2);
    };
    this._birdTimer = setInterval(() => {
      if (Math.random() < 0.6) chirp();
      if (Math.random() < 0.3) setTimeout(chirp, 150);
    }, 1400);
  }

  /** 잔잔한 피아노 패드(코드 반복). */
  _pianoPad() {
    const chord = [261.63, 329.63, 392.0]; // C major
    chord.forEach((f) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = f;
      gain.gain.value = 0.06;
      const lfo = this.ctx.createOscillator();
      const lfoGain = this.ctx.createGain();
      lfo.frequency.value = 0.15;
      lfoGain.gain.value = 0.04;
      lfo.connect(lfoGain).connect(gain.gain);
      osc.connect(gain).connect(this.masterGain);
      osc.start();
      lfo.start();
      this.currentNodes.push(osc, lfo);
    });
  }
}
