/* ---------- date-range calendar: Thai months, Buddhist year, tap a start day then an end day ---------- */
const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const TH_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
// '2026-10-20' -> '20 ต.ค. 69'
const calDay = k => { const [y, m, d] = k.split('-').map(Number); return `${d} ${TH_SHORT[m - 1]} ${(y + 543) % 100}`; };
const thRange = (a, b) => a === b ? calDay(a) : `${calDay(a)} – ${calDay(b)}`;
const daysIn = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5) + 1;
const MAX_RANGE = 400; // the server refuses longer ranges

// opens the sheet with from..to selected; done(from, to) runs on "ตกลง"
function pickRange(from, to, done) {
  const today = dayKey(Date.now());
  let a = from, b = to, view = new Date(to.slice(0, 7) + '-01T00:00');
  const el = $('calSheet') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'calSheet', className: 'calwrap' }));
  const close = () => el.classList.add('hidden');
  const shift = (k, n) => { const d = new Date(k + 'T00:00'); d.setDate(d.getDate() + n); return dayKey(d); };
  const monthStart = n => { const d = new Date(); return dayKey(new Date(d.getFullYear(), d.getMonth() + n, 1)); };
  const presets = [
    ['วันนี้', today, today], ['เมื่อวาน', shift(today, -1), shift(today, -1)], ['7 วันล่าสุด', shift(today, -6), today],
    ['เดือนนี้', monthStart(0), today], ['เดือนที่แล้ว', monthStart(-1), shift(monthStart(0), -1)],
  ];
  const draw = () => {
    const y = view.getFullYear(), m = view.getMonth(), first = new Date(y, m, 1).getDay(), n = new Date(y, m + 1, 0).getDate();
    const cells = Array(first).fill('<span></span>');
    for (let d = 1; d <= n; d++) {
      const k = dayKey(new Date(y, m, d)), end = b || a;
      const cls = [k === today && 'today', k === a && 'from', k === end && 'to', a && k > a && k < end && 'in', k > today && 'future'].filter(Boolean).join(' ');
      cells.push(`<button type="button" class="cd ${cls}" data-k="${k}" ${k > today ? 'disabled' : ''}>${d}</button>`);
    }
    const nextOff = dayKey(new Date(y, m + 1, 1)) > today;
    el.innerHTML = `<div class="calsheet" role="dialog" aria-label="เลือกช่วงวันที่">
      <div class="calhead"><b>เลือกช่วงวันที่</b><button class="calx" type="button" aria-label="ปิด">${icon('close')}</button></div>
      <div class="calpre">${presets.map(([t, f, e], i) => `<button type="button" class="chip ${a === f && (b || a) === e ? 'on' : ''}" data-p="${i}">${t}</button>`).join('')}</div>
      <div class="calnav"><button type="button" data-mv="-1" aria-label="เดือนก่อน">${icon('back')}</button>
        <b>${TH_MONTHS[m]} ${y + 543}</b>
        <button type="button" data-mv="1" aria-label="เดือนถัดไป" ${nextOff ? 'disabled' : ''}>${icon('next')}</button></div>
      <div class="calgrid">${['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'].map(w => `<i>${w}</i>`).join('')}${cells.join('')}</div>
      <p class="calhint">${!a ? 'แตะวันเริ่มต้น' : !b ? `${calDay(a)} — แตะวันสุดท้าย (หรือกดตกลงเพื่อดูวันเดียว)` : `${thRange(a, b)} · ${daysIn(a, b)} วัน`}</p>
      <button class="btn brand calok" type="button" ${a ? '' : 'disabled'}>ตกลง</button>
    </div>`;
    el.querySelector('.calx').onclick = close;
    el.querySelectorAll('[data-mv]').forEach(x => x.onclick = () => { view = new Date(y, m + Number(x.dataset.mv), 1); draw(); });
    el.querySelectorAll('[data-p]').forEach(x => x.onclick = () => { const p = presets[x.dataset.p]; a = p[1]; b = p[2]; view = new Date(b.slice(0, 7) + '-01T00:00'); draw(); });
    // first tap starts a new range; the second ends it (either order)
    el.querySelectorAll('[data-k]').forEach(x => x.onclick = () => {
      const k = x.dataset.k;
      if (!a || b) { a = k; b = null; } else if (k < a) { b = a; a = k; } else b = k;
      draw();
    });
    el.querySelector('.calok').onclick = () => {
      const e = b || a;
      if (daysIn(a, e) > MAX_RANGE) return alert(`เลือกได้ไม่เกิน ${MAX_RANGE} วัน`);
      close(); done(a, e);
    };
  };
  el.onclick = e => { if (e.target === el) close(); };
  el.classList.remove('hidden');
  draw();
}
