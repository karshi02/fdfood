/* ---------- calendar: Thai months, Buddhist year; one sheet for every date field in the app ----------
   pickRange(from, to, done)          tap a start day then an end day (sales, dashboard)
   pickDate(value, opts, done)        one day, optionally with a time ('YYYY-MM-DD' or 'YYYY-MM-DDTHH:MM')
   calField(id, value, opts)          a button that looks like an input and opens pickDate; its .value works like an input's */
const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const TH_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
// '2026-10-20' -> '20 ต.ค. 69'
const calDay = k => { const [y, m, d] = k.split('-').map(Number); return `${d} ${TH_SHORT[m - 1]} ${(y + 543) % 100}`; };
const thRange = (a, b) => a === b ? calDay(a) : `${calDay(a)} – ${calDay(b)}`;
const daysIn = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5) + 1;
// '2026-10-20T18:30' -> '20 ต.ค. 69 · 18:30'
const calText = v => !v ? '' : calDay(v.slice(0, 10)) + (v.length > 10 ? ` · ${v.slice(11, 16)}` : '');
const MAX_RANGE = 400; // the server refuses longer ranges

function pickRange(from, to, done) { calOpen({ range: true, a: from, b: to, done }); }
// opts: time (also pick hour:minute), future (allow days after today), clear (label of a button that returns '')
function pickDate(value, opts, done) {
  const v = String(value || '').replace(' ', 'T');
  calOpen(Object.assign({}, opts, { a: v.slice(0, 10) || null, hm: v.slice(11, 16), done }));
}

function calOpen(o) {
  const today = dayKey(Date.now()), range = !!o.range, future = !!o.future;
  let a = o.a || (range ? null : today), b = range ? o.b : null, hm = o.hm || '';
  if (o.time && !hm) { const n = new Date(); hm = `${pad(n.getHours())}:${pad(n.getMinutes())}`; }
  let view = new Date((b || a || today).slice(0, 7) + '-01T00:00');
  const el = $('calSheet') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'calSheet', className: 'calwrap' }));
  const close = () => el.classList.add('hidden');
  const shift = (k, n) => { const d = new Date(k + 'T00:00'); d.setDate(d.getDate() + n); return dayKey(d); };
  const monthStart = n => { const d = new Date(); return dayKey(new Date(d.getFullYear(), d.getMonth() + n, 1)); };
  const presets = range ? [
    ['วันนี้', today, today], ['เมื่อวาน', shift(today, -1), shift(today, -1)], ['7 วันล่าสุด', shift(today, -6), today],
    ['30 วันล่าสุด', shift(today, -29), today], ['เดือนนี้', monthStart(0), today], ['เดือนที่แล้ว', monthStart(-1), shift(monthStart(0), -1)],
  ] : [['วันนี้', today, today], future ? ['พรุ่งนี้', shift(today, 1), shift(today, 1)] : ['เมื่อวาน', shift(today, -1), shift(today, -1)]];
  const opts = (n, cur) => Array.from({ length: n }, (_, i) => `<option${pad(i) === cur ? ' selected' : ''}>${pad(i)}</option>`).join('');
  const draw = () => {
    const y = view.getFullYear(), m = view.getMonth(), first = new Date(y, m, 1).getDay(), n = new Date(y, m + 1, 0).getDate();
    const cells = Array(first).fill('<span></span>');
    for (let d = 1; d <= n; d++) {
      const k = dayKey(new Date(y, m, d)), end = b || a, off = !future && k > today;
      const cls = [k === today && 'today', k === a && 'from', k === end && 'to', a && k > a && k < end && 'in', off && 'future'].filter(Boolean).join(' ');
      cells.push(`<button type="button" class="cd ${cls}" data-k="${k}" ${off ? 'disabled' : ''}>${d}</button>`);
    }
    const nextOff = !future && dayKey(new Date(y, m + 1, 1)) > today;
    const title = o.title || (range ? 'เลือกช่วงวันที่' : o.time ? 'เลือกวันและเวลา' : 'เลือกวันที่');
    const hint = range ? (!a ? 'แตะวันเริ่มต้น' : !b ? `${calDay(a)} — แตะวันสุดท้าย (หรือกดตกลงเพื่อดูวันเดียว)` : `${thRange(a, b)} · ${daysIn(a, b)} วัน`)
      : a ? calText(a + (o.time ? 'T' + hm : '')) : 'แตะเลือกวัน';
    el.innerHTML = `<div class="calsheet" role="dialog" aria-label="${title}">
      <div class="calhead"><b>${title}</b><button class="calx" type="button" aria-label="ปิด">${icon('close')}</button></div>
      <div class="calpre">${presets.map(([t, f, e], i) => `<button type="button" class="chip ${a === f && (b || a) === e ? 'on' : ''}" data-p="${i}">${t}</button>`).join('')}</div>
      <div class="calnav"><button type="button" data-mv="-1" aria-label="เดือนก่อน">${icon('back')}</button>
        <b>${TH_MONTHS[m]} ${y + 543}</b>
        <button type="button" data-mv="1" aria-label="เดือนถัดไป" ${nextOff ? 'disabled' : ''}>${icon('next')}</button></div>
      <div class="calgrid">${['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'].map(w => `<i>${w}</i>`).join('')}${cells.join('')}</div>
      ${o.time ? `<div class="caltime"><span>เวลา</span><select id="calH" aria-label="ชั่วโมง">${opts(24, hm.slice(0, 2))}</select><b>:</b><select id="calM" aria-label="นาที">${opts(60, hm.slice(3, 5))}</select><span>น.</span></div>` : ''}
      <p class="calhint">${hint}</p>
      ${o.clear ? `<button class="btn ghost calclr" type="button">${o.clear}</button>` : ''}
      <button class="btn brand calok" type="button" ${a ? '' : 'disabled'}>ตกลง</button>
    </div>`;
    el.querySelector('.calx').onclick = close;
    el.querySelectorAll('[data-mv]').forEach(x => x.onclick = () => { view = new Date(y, m + Number(x.dataset.mv), 1); draw(); });
    el.querySelectorAll('[data-p]').forEach(x => x.onclick = () => { const p = presets[x.dataset.p]; a = p[1]; b = range ? p[2] : null; view = new Date(p[2].slice(0, 7) + '-01T00:00'); draw(); });
    // range: first tap starts a new range, the second ends it (either order); one day: a tap picks it
    el.querySelectorAll('[data-k]').forEach(x => x.onclick = () => {
      const k = x.dataset.k;
      if (!range) a = k;
      else if (!a || b) { a = k; b = null; } else if (k < a) { b = a; a = k; } else b = k;
      draw();
    });
    if (o.time) $('calH').onchange = $('calM').onchange = () => { hm = `${$('calH').value}:${$('calM').value}`; el.querySelector('.calhint').textContent = calText(a + 'T' + hm); };
    if (o.clear) el.querySelector('.calclr').onclick = () => { close(); o.done(''); };
    el.querySelector('.calok').onclick = () => {
      if (!range) { close(); return o.done(o.time ? `${a}T${hm}` : a); }
      const e = b || a;
      if (daysIn(a, e) > MAX_RANGE) return alert(`เลือกได้ไม่เกิน ${MAX_RANGE} วัน`);
      close(); o.done(a, e);
    };
  };
  el.onclick = e => { if (e.target === el) close(); };
  el.classList.remove('hidden');
  draw();
}

// a date field: <button class="calfield" value="..."> shows the Thai date and opens the calendar; picking sets .value
// and fires input + change, so code written for <input type="date|datetime-local"> keeps working
// data-time: with hour:minute · data-future: days after today allowed · data-empty: text shown when blank (blank allowed)
function calField(id, value, opts = {}) {
  return `<button type="button" class="calfield" id="${id}" value="${esc(value || '')}"${opts.time ? ' data-time="1"' : ''}${opts.future ? ' data-future="1"' : ''}${opts.empty ? ` data-empty="${esc(opts.empty)}"` : ''}>${icon('calendar')}<span>${esc(calText(value) || opts.empty || 'เลือกวันที่')}</span></button>`;
}
const calLabel = f => { const s = f.querySelector('span:last-child'); if (s) s.textContent = calText(f.value) || f.dataset.empty || 'เลือกวันที่'; };
document.addEventListener('click', e => {
  const f = e.target.closest('.calfield');
  if (!f) return;
  pickDate(f.value, { time: !!f.dataset.time, future: !!f.dataset.future, clear: f.dataset.empty ? `ใช้${f.dataset.empty}` : '' }, v => {
    f.value = v; calLabel(f);
    // the table sheet re-renders on every sync; show the pick on the field that replaced this one too
    const now = f.id && $(f.id);
    if (now && now !== f) now.value = v;
    f.dispatchEvent(new Event('input', { bubbles: true })); f.dispatchEvent(new Event('change', { bubbles: true }));
  });
});
// code that sets .value directly (forms, edit buttons) still gets the right label: button.value reflects to the attribute
new MutationObserver(ms => ms.forEach(m => m.target.classList.contains('calfield') && calLabel(m.target)))
  .observe(document.body, { attributes: true, attributeFilter: ['value'], subtree: true });
