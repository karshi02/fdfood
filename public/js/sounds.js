/* ---------- kitchen alert sounds: built-in tunes made with WebAudio (no files), or sounds the shop uploaded ----------
   A setting value is 'b:<name>' for a built-in tune or 'f:<file key>' for an uploaded one. */
const SOUNDS = {
  ding: 'ติ๊งต่อง (กริ่งหน้าร้าน)', marimba: 'มาริมบา 3 โน้ต', chime: 'ระฆังแก้ว', coin: 'เหรียญเกม', bell: 'กระดิ่งครัว', jingle: 'ทำนองสั้นติดหู',
  westminster: 'กริ่งบ้าน 4 โน้ต', kaching: 'เครื่องคิดเงิน กริ๊ง!', xylo: 'ระนาดขึ้น-ลง', pop: 'ป๊อปฟองสบู่', notify: 'แจ้งเตือนมือถือ', urgent: 'เตือนด่วน (ดังมาก)',
};
let audioCtx = null;
const actx = () => (audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)());
// one note: frequency (Hz), start (s from now), length (s), wave, loudness
function tone(f, at, len, type = 'sine', vol = 0.35) {
  const c = actx(), o = c.createOscillator(), g = c.createGain(), t = c.currentTime + at;
  o.type = type; o.frequency.setValueAtTime(f, t);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(g).connect(c.destination); o.start(t); o.stop(t + len + 0.05);
}
const NOTE = { C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880, B5: 987.77, C6: 1046.5, E6: 1318.5, G6: 1568 };
const BUILTIN = {
  ding: () => { tone(NOTE.E5, 0, 0.9, 'sine', 0.45); tone(NOTE.C5, 0.45, 1.2, 'sine', 0.45); },
  marimba: () => [NOTE.C5, NOTE.E5, NOTE.G5].forEach((f, i) => { tone(f, i * 0.14, 0.35, 'triangle', 0.5); tone(f * 4, i * 0.14, 0.08, 'sine', 0.08); }),
  chime: () => [NOTE.G5, NOTE.C6, NOTE.E6].forEach((f, i) => { tone(f, i * 0.22, 1.4, 'sine', 0.3); tone(f * 2.76, i * 0.22, 0.5, 'sine', 0.06); }),
  coin: () => { tone(NOTE.B5, 0, 0.09, 'square', 0.18); tone(NOTE.E6, 0.09, 0.45, 'square', 0.18); },
  bell: () => { for (let i = 0; i < 6; i++) tone(i % 2 ? 2100 : 1900, i * 0.07, 0.12, 'triangle', 0.3); },
  jingle: () => [[NOTE.E5, 0], [NOTE.G5, 0.15], [NOTE.A5, 0.3], [NOTE.G5, 0.45], [NOTE.C6, 0.6]].forEach(([f, t]) => tone(f, t, t === 0.6 ? 0.7 : 0.18, 'triangle', 0.45)),
  westminster: () => [NOTE.E5, NOTE.C5, NOTE.D5, 392].forEach((f, i) => tone(f, i * 0.42, 0.9, 'sine', 0.42)),
  kaching: () => { tone(2400, 0, 0.05, 'square', 0.12); tone(1800, 0.05, 0.05, 'square', 0.12); [NOTE.E6, NOTE.G6].forEach((f, i) => tone(f, 0.12 + i * 0.08, 0.9, 'sine', 0.3)); },
  xylo: () => [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6, NOTE.G5, NOTE.C6].forEach((f, i) => tone(f, i * 0.1, 0.25, 'triangle', 0.45)),
  pop: () => [0, 0.16, 0.32].forEach(t => { const c = actx(), o = c.createOscillator(), g = c.createGain(), s = c.currentTime + t;
    o.frequency.setValueAtTime(380, s); o.frequency.exponentialRampToValueAtTime(1400, s + 0.09);
    g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.5, s + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.12);
    o.connect(g).connect(c.destination); o.start(s); o.stop(s + 0.15); }),
  notify: () => { tone(NOTE.A5, 0, 0.16, 'sine', 0.4); tone(NOTE.E6, 0.14, 0.5, 'sine', 0.4); },
  urgent: () => { for (let i = 0; i < 4; i++) { tone(1320, i * 0.28, 0.11, 'square', 0.22); tone(1760, i * 0.28 + 0.13, 0.11, 'square', 0.22); } },
};
// files: S.files from the server ({k, name, url}); returns false if the sound could not start (audio still locked)
function playSound(value, files = []) {
  const [kind, name] = String(value || 'b:ding').split(':');
  try {
    if (kind === 'f') {
      const f = files.find(x => x.k === name);
      if (f) { const a = new Audio(f.url); a.play().catch(() => {}); return true; }
    }
    const c = actx();
    if (c.state === 'suspended') c.resume();
    (BUILTIN[name] || BUILTIN.ding)();
    return c.state === 'running';
  } catch { return false; }
}
// every choice for a <select>: built-ins first, then uploaded files
const soundOptions = (files = []) => [...Object.entries(SOUNDS).map(([k, label]) => ['b:' + k, label]),
  ...files.filter(f => f.k.startsWith('snd_')).map(f => ['f:' + f.k, '🎵 ' + (f.name || 'เสียงที่อัปโหลด')])];

// how long each built-in tune rings (s), so a repeat starts only after the previous one ends
const BUILTIN_LEN = { ding: 1.65, marimba: 0.63, chime: 1.84, coin: 0.54, bell: 0.47, jingle: 1.3, westminster: 2.16, kaching: 1.1, xylo: 0.75, pop: 0.47, notify: 0.64, urgent: 1.08 };
// one alert = the sound `times` times with `gap` seconds of silence in between; a new alert cancels one still playing
let alertTimer = null, alertAudio = null;
function playAlert(value, files = [], times = 3, gap = 0.5) {
  clearTimeout(alertTimer); if (alertAudio) alertAudio.pause();
  const [kind, name] = String(value || 'b:ding').split(':');
  const f = kind === 'f' && files.find(x => x.k === name);
  let left = times;
  const next = () => {
    if (left-- <= 0) return;
    if (f) {
      alertAudio = new Audio(f.url);
      alertAudio.onended = () => { alertTimer = setTimeout(next, gap * 1000); };
      alertAudio.play().catch(() => {});
    } else {
      playSound(value, files);
      alertTimer = setTimeout(next, ((BUILTIN_LEN[name] || 1.65) + gap) * 1000);
    }
  };
  next();
}
