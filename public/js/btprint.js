/* ---------- Bluetooth thermal printer (58 / 80 mm) ----------
 * Ported from TaladNads-Night (apps/web/src/lib/printer.ts, lib/fee/escpos.ts, lib/fee/receipt-canvas.ts),
 * where it was tuned against real PeriPage, MXW-W5 and generic POS58 printers.
 *
 * Receipts are drawn on a canvas and sent as an ESC/POS raster image (GS v 0): cheap printers handle Thai
 * text differently per model, an image prints the same everywhere.
 * Web Bluetooth needs Chrome/Edge on Android or desktop over https (or localhost); iPhone/iPad Safari has none,
 * so those devices keep using the browser print dialog.
 */
const BT = (() => {
  // service UUIDs seen on shop printers; PeriPage first because it also exposes 18f0 but only prints via ff02
  const SERVICES = [
    '0000ff00-0000-1000-8000-00805f9b34fb', // PeriPage
    '000018f0-0000-1000-8000-00805f9b34fb', // generic RPP / MTP / POS58
    '49535343-fe7d-4ae5-8fa9-9fafd205e455', // ISSC / Microchip
    'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // some Zjiang
    '0000ae30-0000-1000-8000-00805f9b34fb', // square 57 mm minis (MXW-W5, Phomemo M02, GB01)
    '0000fee7-0000-1000-8000-00805f9b34fb',
  ];
  // MXW-W5 advertises af30 but serves ae30 after connecting: the chooser filters on the advertised one
  const ADVERTISED = ['0000af30-0000-1000-8000-00805f9b34fb'];
  // services with several writable characteristics but only one that prints; a wrong one swallows data silently
  const PREFERRED_CHARS = {
    '0000ff00-0000-1000-8000-00805f9b34fb': '0000ff02-0000-1000-8000-00805f9b34fb',
    '0000ae30-0000-1000-8000-00805f9b34fb': '0000ae01-0000-1000-8000-00805f9b34fb',
  };
  const NAME_PREFIXES = ['PeriPage', 'MTP', 'RPP', 'POS', 'PT-', 'Printer', 'BlueTooth Printer',
    'MXW', 'C15', 'C19', 'MX0', 'GB0', 'GT01', 'T02', 'YT01', 'M02', 'M03', 'M04', 'Phomemo', 'Samu'];

  // MXW family speaks its own framed protocol: commands to ae01, image rows to ae03
  const MXW_SERVICE = '0000ae30-0000-1000-8000-00805f9b34fb';
  const MXW_CMD = '0000ae01-0000-1000-8000-00805f9b34fb';
  const MXW_BACK = '0000ae02-0000-1000-8000-00805f9b34fb';
  const MXW_DATA = '0000ae03-0000-1000-8000-00805f9b34fb';
  function mxwFrame(cmd, payload, last) {
    let c = 0;
    for (const b of payload) {
      c ^= b;
      for (let i = 0; i < 8; i++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff;
    }
    return [0x22, 0x21, cmd, 0x00, payload.length & 0xff, (payload.length >> 8) & 0xff, ...payload, c, last === undefined ? 0xff : last];
  }

  const KEY = { name: 'fd.printer.name', mode: 'fd.printer.mode', paper: 'fd.printer.paper', kitchen: 'fd.printer.kitchen' };
  const load = (k, ok, dflt) => { try { const v = localStorage.getItem(k); return ok.includes(v) ? v : dflt; } catch { return dflt; } };
  const save = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode: works for this page only */ } };

  const MODES = [
    { key: 'standard', label: 'มาตรฐาน', hint: 'เครื่องความร้อนทั่วไป · เร็วสุด' },
    { key: 'small', label: 'ก้อนเล็ก', hint: 'มือถือที่ส่งก้อนใหญ่แล้วกระดาษไม่ออก' },
    { key: 'peripage', label: 'PeriPage', hint: 'เติมคำสั่งปลุกเครื่องของ PeriPage' },
  ];

  let state = {
    status: 'none', // none | connecting | ready | printing
    mode: load(KEY.mode, ['standard', 'small', 'peripage'], 'standard'),
    paper: load(KEY.paper, ['58', '80'], '58'),
    kitchen: load(KEY.kitchen, ['1', '0'], '1') === '1', // kitchen tickets also go to the Bluetooth printer
    name: load(KEY.name, [], null) || (() => { try { return localStorage.getItem(KEY.name); } catch { return null; } })(),
    msg: '', bad: false,
  };
  const watchers = new Set();
  function set(patch) { state = Object.assign({}, state, patch); watchers.forEach(fn => fn(state)); }

  const api = () => (typeof navigator !== 'undefined' && navigator.bluetooth) || null;
  let device = null, sink = null, mxw = null;
  let attemptNo = 0, cancelledNo = 0;

  // printers drop the link when idle; reconnect to the same device without asking again
  const REBIND_STEPS_MS = [600, 2000, 5000, 10000, 20000, 30000];
  let wantConnected = false, rebindTimer = null, rebindStep = 0;
  function stopRebind() { if (rebindTimer) clearTimeout(rebindTimer); rebindTimer = null; rebindStep = 0; }
  async function rebindNow() {
    if (!wantConnected || sink || !device) return;
    try {
      sink = await withTimeout(openSink(device), CONNECT_TIMEOUT_MS);
      stopRebind(); startKeepAwake();
      set({ status: 'ready', name: device.name || state.name, msg: '', bad: false });
    } catch { scheduleRebind(); }
  }
  function scheduleRebind() {
    if (!wantConnected || rebindTimer) return;
    const wait = REBIND_STEPS_MS[Math.min(rebindStep, REBIND_STEPS_MS.length - 1)];
    rebindStep += 1;
    rebindTimer = setTimeout(() => { rebindTimer = null; rebindNow(); }, wait);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wantConnected && !sink) { stopRebind(); rebindNow(); }
  });

  // MXW printers fall asleep yet keep accepting writes; poke them with the job-open command every 20 s
  let keepAwake = null;
  async function pokeMxw() {
    if (!mxw || state.status === 'printing') return;
    try { await put(mxw.cmd, mxwFrame(0xa7, [], 0x00)); } catch { /* the real print will report it */ }
  }
  function startKeepAwake() { stopKeepAwake(); if (!mxw) return; pokeMxw(); keepAwake = setInterval(pokeMxw, 20000); }
  function stopKeepAwake() { if (keepAwake) clearInterval(keepAwake); keepAwake = null; }

  const CONNECT_TIMEOUT_MS = 12000;
  function withTimeout(work, ms) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`เครื่องพิมพ์ไม่ตอบใน ${Math.round(ms / 1000)} วินาที — เช็กว่าเปิดเครื่องอยู่ อยู่ใกล้ และไม่ได้ต่อค้างกับเครื่องอื่น`)), ms);
      work.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
    });
  }
  const wait = ms => new Promise(r => setTimeout(r, ms));
  async function put(c, bytes) {
    const b = Uint8Array.from(bytes);
    if (c.properties.writeWithoutResponse && c.writeValueWithoutResponse) await c.writeValueWithoutResponse(b);
    else await c.writeValue(b);
  }

  async function openSink(dev) {
    const server = await dev.gatt.connect();
    await wait(1200); // printers drop the first write if it comes right after connecting
    const pickWritable = async service => {
      const chars = await service.getCharacteristics().catch(() => []);
      const known = service.uuid ? PREFERRED_CHARS[service.uuid.toLowerCase()] : undefined;
      if (known) { const hit = chars.find(c => (c.uuid || '').toLowerCase() === known); if (hit) return hit; }
      return chars.find(c => c.properties.write) || chars.find(c => c.properties.writeWithoutResponse) || null;
    };
    mxw = null;
    let found = null;
    for (const uuid of SERVICES) {
      const service = await server.getPrimaryService(uuid).catch(() => null);
      if (!service) continue;
      if (uuid === MXW_SERVICE) {
        const chars = await service.getCharacteristics().catch(() => []);
        const at = u => chars.find(c => (c.uuid || '').toLowerCase() === u) || null;
        const cmd = at(MXW_CMD), dat = at(MXW_DATA);
        if (cmd && dat) {
          mxw = { cmd, data: dat };
          const back = at(MXW_BACK);
          if (back && back.startNotifications) await back.startNotifications().catch(() => {});
          found = cmd;
          break;
        }
      }
      found = await pickWritable(service);
      if (found) break;
    }
    if (!found && server.getPrimaryServices) {
      for (const service of await server.getPrimaryServices().catch(() => [])) {
        found = await pickWritable(service);
        if (found) break;
      }
    }
    if (!found) throw new Error('เครื่องนี้ไม่มีช่องรับข้อมูลสำหรับพิมพ์');
    dev.addEventListener('gattserverdisconnected', () => {
      stopKeepAwake(); mxw = null; sink = null;
      if (!wantConnected) return set({ status: 'none', msg: '', bad: false });
      set({ status: 'connecting', msg: 'เครื่องพิมพ์หลับ — กำลังต่อกลับให้เอง', bad: false });
      stopRebind(); rebindNow();
    });
    return found;
  }

  function adopt(dev, s) {
    device = dev; sink = s; wantConnected = true;
    stopRebind(); startKeepAwake();
    save(KEY.name, dev.name || null);
    set({ status: 'ready', name: dev.name || null, msg: '', bad: false });
  }

  // prompt = may open the browser's device chooser (must come from a click)
  async function ready(prompt, anyDevice) {
    const bt = api();
    if (!bt) throw new Error('UNSUPPORTED');
    if (sink && device && device.gatt && device.gatt.connected) return sink;
    const mine = ++attemptNo;
    const guard = () => { if (mine !== attemptNo || mine <= cancelledNo) throw new Error('CANCELLED'); };
    set({ status: 'connecting', msg: 'กำลังต่อเครื่องพิมพ์…', bad: false });
    if (device) {
      const s = await withTimeout(openSink(device), CONNECT_TIMEOUT_MS);
      guard(); adopt(device, s); return sink;
    }
    // a new page: Chrome may still hold the permission for the printer picked earlier
    if (bt.getDevices) {
      try {
        const hit = (await bt.getDevices()).find(d => d.gatt) || null;
        if (hit) { const s = await withTimeout(openSink(hit), CONNECT_TIMEOUT_MS); guard(); adopt(hit, s); return sink; }
      } catch (e) { if (e && e.message === 'CANCELLED') throw e; }
    }
    if (!prompt) { set({ status: 'none', msg: '', bad: false }); throw new Error('NEED_PAIR'); }
    const all = [...SERVICES, ...ADVERTISED];
    const picked = await bt.requestDevice(anyDevice
      ? { acceptAllDevices: true, optionalServices: all }
      : { filters: [...all.map(u => ({ services: [u] })), ...NAME_PREFIXES.map(namePrefix => ({ namePrefix }))], optionalServices: all });
    guard();
    const s = await withTimeout(openSink(picked), CONNECT_TIMEOUT_MS);
    guard(); adopt(picked, s);
    set({ msg: 'ต่อเครื่องพิมพ์แล้ว — บิลถัดไปพิมพ์ออกเครื่องนี้เลย' });
    return sink;
  }

  function friendlyError(why) {
    const t = String(why).toLowerCase();
    if (why === 'UNSUPPORTED') return 'เบราว์เซอร์นี้ต่อเครื่องพิมพ์บลูทูธไม่ได้ — ใช้ Chrome บนแอนดรอยด์หรือคอมพิวเตอร์ (iPhone/iPad ใช้ไม่ได้)';
    if (why === 'NEED_PAIR') return 'ยังไม่ได้ต่อเครื่องพิมพ์ — เปิด "เครื่องพิมพ์บลูทูธ" ในเมนูบัญชีแล้วกดเชื่อมต่อ';
    if (t.includes('globally disabled')) return 'เบราว์เซอร์นี้ปิดบลูทูธไว้ — เปิดหน้านี้ในแอป Chrome โดยตรง (ไม่ใช่ในไลน์/เฟซบุ๊ก)';
    if (t.includes('adapter') || t.includes('turned off') || t.includes('powered off')) return 'บลูทูธของเครื่องยังปิดอยู่ — เปิดบลูทูธแล้วลองใหม่';
    if (t.includes('permission') || t.includes('denied')) return 'Chrome ยังไม่ได้สิทธิ์ใช้บลูทูธ — เปิดสิทธิ์ "อุปกรณ์ใกล้เคียง" และ "ตำแหน่ง" ให้แอป Chrome';
    if (t.includes('secure context') || t.includes('https')) return 'ต้องเปิดผ่าน https (หรือ localhost) ถึงจะต่อบลูทูธได้';
    if (t.includes('no devices found') || t.includes('chooser')) return 'ไม่เจอเครื่องพิมพ์ — เช็กว่าเปิดเครื่อง อยู่ใกล้ และไม่ได้ต่อค้างกับเครื่องอื่น';
    return `ต่อเครื่องพิมพ์ไม่สำเร็จ — ${why}`;
  }
  const cancelledByUser = why => /user cancelled|cancelled by the user/i.test(why);

  async function connect(anyDevice) {
    try { await ready(true, anyDevice); return true; }
    catch (e) {
      const why = e && e.message ? e.message : String(e);
      if (why === 'CANCELLED') return false;
      set({ status: 'none', msg: cancelledByUser(why) ? '' : friendlyError(why), bad: !cancelledByUser(why) });
      return false;
    }
  }
  // on page load: reconnect silently if Chrome remembers the printer, never opens the chooser
  async function resume() { if (api() && state.name) { try { await ready(false); } catch { /* wait for a click */ } } }
  function forget() {
    cancelledNo = attemptNo; wantConnected = false; stopRebind(); stopKeepAwake();
    try { if (device && device.gatt) device.gatt.disconnect(); } catch { /* not connected */ }
    mxw = null; device = null; sink = null; save(KEY.name, null);
    set({ status: 'none', name: null, msg: 'ลืมเครื่องพิมพ์แล้ว — บิลจะพิมพ์ผ่านเบราว์เซอร์', bad: false });
  }

  /* ---------- sending ---------- */
  async function printViaMxw(data, io, pad) {
    const at = data.indexOf(0x1d);
    if (!(at >= 0 && data[at + 1] === 0x76 && data[at + 2] === 0x30)) throw new Error('ไม่พบภาพใบเสร็จในข้อมูลที่จะพิมพ์');
    const wide = data[at + 4] | (data[at + 5] << 8), rows = data[at + 6] | (data[at + 7] << 8), from = at + 8;
    if (wide <= 0 || rows <= 0 || from + wide * rows > data.length) throw new Error('ขนาดภาพใบเสร็จไม่ถูกต้อง');
    const tall = rows + (pad === undefined ? 56 : pad); // blank rows past the tear bar: MXW has no feed command
    // the vendor app's exact sequence and gaps; halving them made the printer accept data and print nothing
    await put(io.cmd, mxwFrame(0xa7, [], 0x00)); await wait(300);
    await put(io.cmd, mxwFrame(0xb1, [0x00])); await wait(300);
    await put(io.cmd, mxwFrame(0xa1, [0x00])); await wait(300);
    await put(io.cmd, mxwFrame(0xa2, [0x5d])); await wait(300);
    await put(io.cmd, mxwFrame(0xa9, [tall & 0xff, (tall >> 8) & 0xff, wide & 0xff, (wide >> 8) & 0xff], 0x00)); await wait(500);
    // ESC/POS puts the leftmost dot in the high bit, MXW in the low bit: reverse bits inside each byte
    const flip = new Uint8Array(256);
    for (let i = 0; i < 256; i++) { let v = i, r = 0; for (let b = 0; b < 8; b++) { r = (r << 1) | (v & 1); v >>= 1; } flip[i] = r; }
    const img = new Uint8Array(wide * tall);
    for (let i = 0; i < wide * rows; i++) img[i] = flip[data[from + i]];
    // whole rows per write, under the 509-byte BLE ceiling (MTU 512 - 3); a split row shears the image
    const step = Math.max(wide, Math.floor(509 / wide) * wide);
    for (let i = 0; i < img.length; i += step) {
      await put(io.data, img.slice(i, i + step));
      set({ status: 'printing', msg: `กำลังส่ง… ${Math.min(100, Math.round((i + step) / img.length * 100))}%`, bad: false });
    }
    await wait(500);
    await put(io.cmd, mxwFrame(0xad, [0x00], 0x00));
  }

  // the first job after a minute idle is dropped by MXW printers: send an 8-row blank job first
  const WARM_AFTER_MS = 60000;
  let lastMxwOkAt = 0;
  function blankJob(rows) {
    const wide = 48, out = new Uint8Array(8 + wide * rows);
    out.set([0x1d, 0x76, 0x30, 0x00, wide, 0, rows & 0xff, (rows >> 8) & 0xff], 0);
    return out;
  }

  async function printBytes(input, prompt) {
    try {
      const out = await ready(prompt !== false);
      set({ status: 'printing', msg: 'กำลังส่งไปเครื่องพิมพ์…', bad: false });
      if (mxw) {
        if (Date.now() - lastMxwOkAt > WARM_AFTER_MS) {
          await printViaMxw(blankJob(8), mxw, 0).catch(() => {});
          await wait(400);
        }
        await printViaMxw(input, mxw);
        lastMxwOkAt = Date.now();
        set({ status: 'ready', msg: 'ส่งไปเครื่องพิมพ์แล้ว', bad: false });
        return true;
      }
      // PeriPage needs its wake-up prefix and its own feed command, or it keeps the data and prints nothing
      let data = input;
      if (state.mode === 'peripage') {
        data = new Uint8Array(4 + input.length + 3);
        data.set([0x10, 0xff, 0xfe, 0x01], 0); data.set(input, 4); data.set([0x1b, 0x4a, 0x50], 4 + input.length);
      }
      // write-with-response: PeriPage silently drops write-without-response; 20-byte chunks fit any phone's MTU
      const CHUNK = state.mode === 'standard' ? 100 : 20;
      const gap = state.mode === 'standard' ? 25 : state.mode === 'peripage' ? 15 : 8;
      for (let i = 0; i < data.length; i += CHUNK) {
        const part = data.slice(i, i + CHUNK);
        if (out.properties.write) await out.writeValue(part); else await out.writeValueWithoutResponse(part);
        await wait(gap);
        const pct = Math.round((i + CHUNK) / data.length * 100);
        if (pct % 10 === 0 || i + CHUNK >= data.length) set({ status: 'printing', msg: `กำลังส่ง… ${Math.min(100, pct)}%`, bad: false });
      }
      set({ status: 'ready', msg: 'ส่งไปเครื่องพิมพ์แล้ว', bad: false });
      return true;
    } catch (e) {
      const why = e && e.message ? e.message : String(e);
      if (!(device && device.gatt && device.gatt.connected)) sink = null;
      set({
        status: device && device.gatt && device.gatt.connected ? 'ready' : 'none',
        msg: why === 'CANCELLED' ? 'ยกเลิกแล้ว' : cancelledByUser(why) ? '' : friendlyError(why),
        bad: true,
      });
      return false;
    }
  }

  /* ---------- drawing ---------- */
  const DOTS = { 58: 384, 80: 576 };
  const SIZE = {
    58: { base: 21, small: 18, item: 23, big: 34, title: 28, table: 40, pad: 8, gap: 7, logoMax: 120 },
    80: { base: 24, small: 20, item: 26, big: 40, title: 32, table: 48, pad: 12, gap: 8, logoMax: 150 },
  };
  const FONT = '"IBM Plex Sans Thai", "Sarabun", "Leelawadee UI", Tahoma, sans-serif';
  const font = (px, bold) => `${bold ? '700 ' : ''}${px}px ${FONT}`;

  // canvas -> ESC/POS raster (GS v 0); transparent counts as paper, not black
  function raster(canvas) {
    const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height, row = Math.ceil(w / 8);
    const px = ctx.getImageData(0, 0, w, h).data, bits = new Uint8Array(row * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (px[i + 3] < 128) continue;
      if (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2] < 160) bits[y * row + (x >> 3)] |= 0x80 >> (x & 7);
    }
    const out = new Uint8Array(2 + 8 + bits.length + 7);
    out.set([0x1b, 0x40, 0x1d, 0x76, 0x30, 0x00, row & 0xff, row >> 8, h & 0xff, h >> 8], 0);
    out.set(bits, 10);
    out.set([0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x42, 0x00], 10 + bits.length); // feed, then cut where there is a blade
    return out;
  }

  // img/logo-print.png: 1-bit black cow and stars on white, cut for 58 mm paper (no dithering needed)
  let logoCache = null;
  function shopLogo() {
    if (!logoCache) logoCache = new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => { logoCache = null; resolve(null); }; // no logo is fine: the bill still prints
      img.src = 'img/logo-print.png';
    });
    return logoCache;
  }

  const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('th', { granularity: 'word' }) : null;
  const words = text => seg ? Array.from(seg.segment(text), x => x.segment) : text.split(/(\s+)/);

  // a list of drawing ops, measured first so the canvas is exactly as tall as the content
  function layout(paper) {
    const width = DOTS[paper], Z = SIZE[paper], ops = [];
    const m = document.createElement('canvas').getContext('2d');
    let y = Z.pad;
    const wrap = (text, px, bold, max) => {
      m.font = font(px, bold);
      const lines = [];
      let cur = '';
      // Thai has no spaces between words: split on Thai word boundaries where the browser knows them
      // (Intl.Segmenter, Chrome 87+), and only break inside a word when even one word is too wide
      const fits = t => m.measureText(t).width <= max;
      for (const word of words(String(text))) {
        if (fits(cur + word)) { cur += word; continue; }
        if (cur.trim()) { lines.push(cur.trim()); cur = ''; }
        if (fits(word.trimStart())) { cur = word.trimStart(); continue; }
        for (const ch of Array.from(word.trimStart())) {
          if (fits(cur + ch) || !cur) cur += ch;
          else { lines.push(cur); cur = ch; }
        }
      }
      if (cur.trim() || !lines.length) lines.push(cur.trim());
      return lines;
    };
    const L = {
      width, Z, ops,
      gap(n) { y += n === undefined ? Z.gap : n; },
      center(text, px, bold) {
        for (const line of wrap(text, px, bold, width - Z.pad * 2)) { y += px; ops.push({ t: line, x: width / 2, a: 'center', px, bold, y }); y += Z.gap - 2; }
      },
      left(text, px, bold, indent) {
        const ind = indent || 0;
        for (const line of wrap(text, px, bold, width - Z.pad * 2 - ind)) { y += px; ops.push({ t: line, x: Z.pad + ind, a: 'left', px, bold, y }); y += Z.gap - 2; }
      },
      // left text wraps in the space the right-hand amount leaves free
      pair(left, right, px, bold) {
        m.font = font(px, bold);
        const rw = right ? m.measureText(right).width + 10 : 0;
        wrap(left, px, bold, width - Z.pad * 2 - rw).forEach((line, i) => {
          y += px;
          ops.push({ t: line, x: Z.pad, a: 'left', px, bold, y });
          if (i === 0 && right) ops.push({ t: right, x: width - Z.pad, a: 'right', px, bold, y });
          y += Z.gap - 2;
        });
      },
      rule() { y += Z.gap; ops.push({ line: true, y }); y += Z.gap; },
      image(c, w, h) { ops.push({ img: c, x: Math.round((width - w) / 2), y, w, h }); y += h + Z.gap; },
      qr(text, size) {
        if (typeof qrcode === 'undefined' || !text) return;
        const q = qrcode(0, 'M'); q.addData(text); q.make();
        const n = q.getModuleCount(), cell = Math.max(2, Math.floor(size / (n + 8))), s = cell * (n + 8);
        ops.push({ qr: q, n, cell, x: Math.round((width - s) / 2), y });
        y += s + Z.gap;
      },
      render() {
        const c = document.createElement('canvas');
        c.width = width; c.height = Math.ceil(y + Z.pad);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.fillStyle = '#000'; ctx.strokeStyle = '#000'; ctx.textBaseline = 'alphabetic';
        for (const o of ops) {
          if (o.line) { ctx.beginPath(); ctx.setLineDash([4, 3]); ctx.moveTo(Z.pad, o.y + 0.5); ctx.lineTo(width - Z.pad, o.y + 0.5); ctx.lineWidth = 1; ctx.stroke(); continue; }
          if (o.img) { ctx.imageSmoothingEnabled = false; ctx.drawImage(o.img, o.x, o.y, o.w, o.h); continue; }
          if (o.qr) {
            for (let r = 0; r < o.n; r++) for (let k = 0; k < o.n; k++) if (o.qr.isDark(r, k)) ctx.fillRect(o.x + (k + 4) * o.cell, o.y + (r + 4) * o.cell, o.cell, o.cell);
            continue;
          }
          ctx.font = font(o.px, o.bold); ctx.textAlign = o.a; ctx.fillText(o.t, o.x, o.y, width - Z.pad * 2);
        }
        return c;
      },
    };
    return L;
  }

  async function drawBill(b, isPreview) {
    const s = S.settings, L = layout(state.paper), Z = L.Z;
    const logo = await shopLogo();
    if (logo) {
      const k = Math.min(L.width * 0.7 / logo.width, Z.logoMax / logo.height);
      L.image(logo, Math.round(logo.width * k), Math.round(logo.height * k));
    }
    L.center(s.name || 'โคขุน', Z.title, true);
    if (s.addr) L.center(s.addr, Z.small);
    if (s.phone) L.center(`โทร ${s.phone}`, Z.small);
    L.rule();
    L.center(isPreview ? 'ใบแจ้งยอด (ยังไม่ชำระ)' : `ใบเสร็จรับเงิน #${b.no}${b.void ? ' (ยกเลิก)' : ''}`, Z.base, true);
    const when = (b.date instanceof Date ? b.date : toDate(b.date)).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
    L.pair('โต๊ะ', String(b.table), Z.base, true);
    L.pair('วันที่', when, Z.base);
    if (b.cashier) L.pair('แคชเชียร์', b.cashier, Z.base);
    L.rule();
    for (const i of b.items) {
      L.pair(`${i.qty} x ${i.name}`, baht(i.price * i.qty), Z.item, true);
      if (i.note) L.left(`* ${i.note}`, Z.small, false, 16);
    }
    L.rule();
    L.pair('รวม', baht(b.sub), Z.base);
    if (b.disc) L.pair('ส่วนลด', `-${baht(b.disc)}`, Z.base);
    if (b.service) L.pair(`Service ${b.servicePct}%`, baht(b.service), Z.base);
    if (b.vat) L.pair(`VAT ${b.vatPct}%`, baht(b.vat), Z.base);
    L.gap(4);
    L.pair('ยอดสุทธิ', `฿${baht(b.total)}`, Z.big, true);
    if (!isPreview) L.pair('ชำระโดย', METHODS[b.method] || '', Z.base);
    if (b.cash !== null && b.cash !== undefined) { L.pair('รับเงิน', baht(b.cash), Z.base); L.pair('เงินทอน', baht(b.change), Z.base); }
    if (isPreview && s.promptpay) {
      const payload = promptpayPayload(s.promptpay, b.total);
      if (payload) { L.rule(); L.center('สแกนจ่ายพร้อมเพย์', Z.base, true); L.qr(payload, Math.round(L.width * 0.62)); }
    }
    L.rule();
    if (s.footer) L.center(s.footer, Z.small);
    return L.render();
  }

  // kitchen ticket: big table name and dishes, no logo or prices
  function drawKitchen(tableName, items) {
    const L = layout(state.paper), Z = L.Z;
    L.center(`โต๊ะ ${tableName}`, Z.table, true);
    L.center(`${new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} · ${ME ? ME.name : ''}`, Z.small);
    L.rule();
    for (const i of items) {
      L.left(`${i.qty} x ${i.name}`, Z.title, true);
      if (i.note) L.left(`* ${i.note}`, Z.base, true, 20);
    }
    L.rule();
    return L.render();
  }

  // a short slip drawn the same way as real bills: if this prints, bills print
  function drawTest() {
    const L = layout(state.paper), Z = L.Z;
    L.center('ทดสอบเครื่องพิมพ์', Z.title, true);
    L.center(new Date().toLocaleString('th-TH'), Z.small);
    L.center(`กระดาษ ${state.paper} มม. · ${L.width} จุด`, Z.small);
    L.rule();
    L.pair('ถ้าอ่านบรรทัดนี้ออก', 'ใช้ได้ ✓', Z.base, true);
    return L.render();
  }

  return {
    MODES,
    supported: () => !!api(),
    state: () => state,
    onChange(fn) { watchers.add(fn); fn(state); },
    // a printer was paired on this device: bills go to Bluetooth instead of the print dialog
    active: () => !!api() && !!state.name,
    useForKitchen: () => state.kitchen,
    connect, resume, forget,
    setMode(mode) { save(KEY.mode, mode); set({ mode, msg: `วิธีส่ง: ${MODES.find(x => x.key === mode).label} — กดทดสอบพิมพ์ดู`, bad: false }); },
    setPaper(paper) { save(KEY.paper, paper); set({ paper, msg: '', bad: false }); },
    setKitchen(on) { save(KEY.kitchen, on ? '1' : '0'); set({ kitchen: on }); },
    test: () => printBytes(raster(drawTest()), true),
    printBill: async (b, isPreview) => printBytes(raster(await drawBill(b, isPreview)), false),
    printKitchen: (name, items) => printBytes(raster(drawKitchen(name, items)), false),
    preview: async b => drawBill(b, false),
  };
})();

/* ---------- printer panel (account menu → เครื่องพิมพ์บลูทูธ) ---------- */
(() => {
  const panel = $('printerPanel');
  if (!panel) return;
  const open = () => { panel.classList.remove('hidden'); $('acctMenu').classList.add('hidden'); };
  const close = () => panel.classList.add('hidden');
  $('printerBtn').onclick = open;
  $('prClose').onclick = close;
  panel.onclick = e => { if (e.target === panel) close(); };
  $('prConnect').onclick = () => BT.connect(false);
  $('prAny').onclick = () => BT.connect(true);
  $('prTest').onclick = () => BT.test();
  $('prForget').onclick = () => { if (confirm('ลืมเครื่องพิมพ์นี้? บิลจะกลับไปพิมพ์ผ่านเบราว์เซอร์')) BT.forget(); };
  $('prKitchen').onchange = e => BT.setKitchen(e.target.checked);
  const LABEL = { none: 'ยังไม่ได้ต่อ', connecting: 'กำลังต่อ…', ready: 'พร้อมพิมพ์', printing: 'กำลังพิมพ์…' };
  BT.onChange(s => {
    const on = s.status === 'ready' || s.status === 'printing';
    $('prStatus').textContent = s.name ? `${s.name} · ${LABEL[s.status]}` : LABEL[s.status];
    $('prStatus').className = `pr-status ${on ? 'on' : s.status === 'connecting' ? 'wait' : ''}`;
    $('printerDot').className = `pr-dot ${on ? 'on' : s.name ? 'wait' : ''}`;
    $('prMsg').textContent = s.msg;
    $('prMsg').style.color = s.bad ? 'var(--danger)' : '';
    $('prTest').disabled = $('prForget').disabled = !s.name;
    $('prKitchen').checked = s.kitchen;
    $('prModes').innerHTML = BT.MODES.map(m => `<button type="button" class="chip ${m.key === s.mode ? 'on' : ''}" data-mode="${m.key}" title="${esc(m.hint)}">${m.label}</button>`).join('');
    $('prModes').querySelectorAll('[data-mode]').forEach(b => b.onclick = () => BT.setMode(b.dataset.mode));
    $('prPaper').querySelectorAll('[data-paper]').forEach(b => { b.classList.toggle('on', b.dataset.paper === s.paper); b.onclick = () => BT.setPaper(b.dataset.paper); });
  });
  if (!BT.supported()) {
    $('prUnsupported').classList.remove('hidden');
    ['prConnect', 'prAny', 'prTest'].forEach(id => { $(id).disabled = true; });
  }
  BT.resume();
})();
