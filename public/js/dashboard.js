/* ---------- dashboard (admin) ---------- */
const EXP_CATS = ['วัตถุดิบ', 'เครื่องดื่ม/น้ำแข็ง', 'ค่าแรงพนักงาน', 'ค่าเช่า', 'ค่าน้ำ/ค่าไฟ', 'แก๊ส', 'อุปกรณ์/ของใช้', 'อื่นๆ'];
const thDay = (k, opt = { day: 'numeric', month: 'short' }) => new Date(k + 'T00:00').toLocaleDateString('th-TH', opt);
let dash = null, dashPreset = '7';
// presets keep their meaning when coming back to the tab ("7 days" moves with today); a range picked on the calendar stays put
function setDashRange(f, t) { $('dFrom').value = f; $('dTo').value = t; $('dRangeTxt').textContent = thRange(f, t); }
function setPreset(p) {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth();
  let from = now, to = now;
  if (p === '7' || p === '30') from = new Date(y, m, now.getDate() - Number(p) + 1);
  if (p === 'month') from = new Date(y, m, 1);
  if (p === 'lastmonth') { from = new Date(y, m - 1, 1); to = new Date(y, m, 0); }
  dashPreset = p; setDashRange(dayKey(from), dayKey(to));
  loadDash();
}
$('dRange').onclick = () => pickRange($('dFrom').value, $('dTo').value, (f, t) => { dashPreset = ''; setDashRange(f, t); loadDash(); });
async function loadDash() {
  if (!$('dFrom').value) setDashRange(dayKey(Date.now() - 6 * 864e5), dayKey(Date.now()));
  const d = await act(`dash&from=${$('dFrom').value}&to=${$('dTo').value}`);
  if (d) { dash = d; renderDash(); }
}
// every day in the range, including days with no sales or expenses
function dashDays() {
  const out = [];
  for (let t = new Date(dash.from + 'T00:00'); dayKey(t) <= dash.to; t.setDate(t.getDate() + 1)) {
    const k = dayKey(t);
    out.push({ k, ...(dash.days[k] || { n: 0, income: 0, disc: 0, expense: 0 }) });
  }
  return out;
}
function renderDash() {
  const days = dashDays();
  const sum = f => days.reduce((a, x) => a + x[f], 0);
  const inc = sum('income'), exp = sum('expense'), n = sum('n'), net = inc - exp;
  renderDashTop(inc, exp, net);
  $('dStats').innerHTML = [['จำนวนบิล', n], ['ยกเลิก', dash.voids + ' บิล'], ['เฉลี่ย/บิล', '฿' + baht(n ? inc / n : 0)],
    ['เฉลี่ย/วัน', '฿' + baht(inc / days.length)], ['ส่วนลดรวม', '฿' + baht(sum('disc'))]]
    .map(([k, v]) => `<span><small>${k}</small><b>${v}</b></span>`).join('');
  renderDashChart(days);

  const bars = (rows, color) => {
    const max = Math.max(...rows.map(r => r.amt), 0) || 1, total = rows.reduce((a, r) => a + r.amt, 0) || 1;
    return rows.map(r => `<div class="bar-row"><span>${esc(r.label)}</span><span class="num">฿${baht(r.amt)} <span class="muted">${(r.amt / total * 100).toFixed(0)}%</span></span>
      <div class="track"><span style="width:${r.amt / max * 100}%;background:${color}"></span></div></div>`).join('') || '<p class="muted">ไม่มีข้อมูล</p>';
  };
  const byCat = {};
  dash.expenses.forEach(e => byCat[e.cat] = (byCat[e.cat] || 0) + e.amount);
  $('dExpCats').innerHTML = bars(Object.entries(byCat).map(([label, amt]) => ({ label, amt })).sort((a, b) => b.amt - a.amt), 'var(--exp)');
  $('dMethods').innerHTML = bars(dash.methods.map(m => ({ label: METHODS[m.method], amt: m.amt })), 'var(--inc)');
  $('dTop').innerHTML = dash.top.map(i => `<tr><td>${esc(i.name)}</td><td class="num">${i.qty}</td><td class="num">${baht(i.amt)}</td></tr>`).join('')
    || '<tr><td colspan="3" class="muted">-</td></tr>';
  $('dDays').innerHTML = days.slice().reverse().map(x => `<tr><td>${thDay(x.k, { weekday: 'short', day: 'numeric', month: 'short', year: '2-digit' })}</td>
    <td class="num">${x.n}</td><td class="num">${baht(x.income)}</td><td class="num">${baht(x.expense)}</td>
    <td class="num" style="color:${x.income - x.expense < 0 ? 'var(--danger)' : 'inherit'}">${baht(x.income - x.expense)}</td></tr>`).join('');

  $('expCats').innerHTML = [...new Set([...EXP_CATS, ...Object.keys(byCat)])].map(c => `<option value="${esc(c)}">`).join('');
  // phone: each expense is a card with the note on its own full-width line (see .exptbl in pages.css)
  $('expBody').innerHTML = dash.expenses.map(e => `<tr data-exp="${e.id}"><td class="xdate">${thDay(e.date)}</td><td class="xcat">${esc(e.cat)}</td>
    <td class="xnote">${esc(e.note)}</td><td class="num xamt">${baht(e.amount)}</td>
    <td class="num xact"><button class="btn ghost sm" data-eedit="${e.id}">แก้ไข</button> <button class="btn ghost sm" data-edel="${e.id}">ลบ</button></td></tr>`).join('')
    || '<tr><td colspan="5" class="muted">ยังไม่มีรายจ่ายในช่วงนี้</td></tr>';
  $('expBody').querySelectorAll('[data-eedit]').forEach(b => b.onclick = () => {
    const e = dash.expenses.find(x => x.id == b.dataset.eedit);
    $('eId').value = e.id; $('eDate').value = e.date; $('eCat').value = e.cat; $('eAmt').value = e.amount; $('eNote').value = e.note;
    $('eSubmit').textContent = 'บันทึกการแก้ไข'; $('eAmt').focus();
  });
  $('expBody').querySelectorAll('[data-edel]').forEach(b => b.onclick = async () => {
    if (confirm('ลบรายจ่ายนี้?') && await act('expense_del', { id: Number(b.dataset.edel) })) { loadDash(); toast('ลบรายจ่ายแล้ว'); }
  });
}
function renderDashChart(days) {
  const W = 800, H = 260, L = 56, R = 8, T = 12, B = 28, pw = W - L - R, ph = H - T - B;
  const max = Math.max(...days.map(x => Math.max(x.income, x.expense)), 0);
  // round the axis top up to a 1/2/5 step so the gridlines land on readable numbers
  const raw = (max || 1000) / 4, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 5, 10].find(s => s * mag >= raw) * mag, top = step * 4;
  const y = v => T + ph - v / top * ph, slot = pw / days.length, bw = Math.max(1, Math.min(18, (slot - 6) / 2));
  const short = v => v >= 1e6 ? (v / 1e6).toFixed(1).replace('.0', '') + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1).replace('.0', '') + 'k' : String(v);
  const bar = (x, v, c) => {
    if (!v) return '';
    const h = Math.max(1, y(0) - y(v)), r = Math.min(4, bw / 2, h);
    return `<path fill="${c}" d="M${x},${y(0)} v${-(h - r)} q0,${-r} ${r},${-r} h${bw - 2 * r} q${r},0 ${r},${r} v${h - r} z"/>`;
  };
  const every = Math.ceil(days.length / 10);
  let svg = '';
  for (let i = 0; i <= 4; i++) svg += `<line x1="${L}" x2="${W - R}" y1="${y(step * i)}" y2="${y(step * i)}" stroke="var(--line)"/>
    <text x="${L - 8}" y="${y(step * i) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${short(step * i)}</text>`;
  days.forEach((x, i) => {
    const cx = L + slot * i + slot / 2;
    svg += bar(cx - bw - 1, x.income, 'var(--inc)') + bar(cx + 1, x.expense, 'var(--exp)');
    if (i % every === 0) svg += `<text x="${cx}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--muted)">${thDay(x.k)}</text>`;
    svg += `<rect x="${L + slot * i}" y="${T}" width="${slot}" height="${ph}" fill="transparent" data-i="${i}"/>`;
  });
  $('dChart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="กราฟรายรับรายจ่ายรายวัน">${svg}</svg><div class="tip hidden"></div>`;
  const tip = $('dChart').querySelector('.tip');
  $('dChart').querySelectorAll('rect[data-i]').forEach(r => {
    r.onmouseenter = r.onclick = () => {
      const x = days[r.dataset.i], box = $('dChart').getBoundingClientRect(), rb = r.getBoundingClientRect();
      tip.innerHTML = `<b>${thDay(x.k, { weekday: 'short', day: 'numeric', month: 'short' })}</b><br>
        <span style="color:var(--inc)">■</span> รายรับ ฿${baht(x.income)} (${x.n} บิล)<br>
        <span style="color:var(--exp)">■</span> รายจ่าย ฿${baht(x.expense)}<br>กำไร ฿${baht(x.income - x.expense)}`;
      tip.classList.remove('hidden');
      tip.style.top = '8px';
      tip.style.left = Math.max(0, Math.min(box.width - tip.offsetWidth, rb.left - box.left + rb.width / 2 - tip.offsetWidth / 2)) + 'px';
      r.setAttribute('fill', 'rgba(15,23,42,.04)');
    };
    r.onmouseleave = () => { tip.classList.add('hidden'); r.setAttribute('fill', 'transparent'); };
  });
}
function resetExpForm() { $('expForm').reset(); $('eId').value = ''; $('eDate').value = dayKey(Date.now()); $('eSubmit').textContent = 'บันทึก'; }
resetExpForm();
$('expForm').onsubmit = async e => {
  e.preventDefault();
  const edit = $('eId').value;
  if (!$('eDate').value) return alert('เลือกวันที่ก่อน');
  if (await act('expense_save', { id: Number(edit) || null, date: $('eDate').value, cat: $('eCat').value, amount: Number($('eAmt').value), note: $('eNote').value })) {
    const keepDate = $('eDate').value, keepCat = $('eCat').value;
    resetExpForm(); if (!edit) { $('eDate').value = keepDate; $('eCat').value = keepCat; }
    loadDash(); toast(edit ? 'แก้ไขรายจ่ายแล้ว' : 'บันทึกรายจ่ายแล้ว'); $('eAmt').focus();
  }
};
$('eCancel').onclick = resetExpForm;

// top of the dashboard: greeting + what's open right now, then the period's money in one card
// "ซ่อน" blurs the amounts (e.g. a customer looking at the screen); remembered on this device
let dashHide = false;
try { dashHide = localStorage.getItem('dashHide') === '1'; } catch {}
// whole baht without ".00", otherwise always two decimals
const money0 = v => { const d = Number.isInteger(Math.round(v * 100) / 100) ? 0 : 2; return Number(v).toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d }); };
function renderDashTop(inc, exp, net) {
  const h = new Date().getHours();
  const hi = h < 12 ? 'สวัสดีตอนเช้า' : h < 17 ? 'สวัสดีตอนบ่าย' : h < 19 ? 'สวัสดีตอนเย็น' : 'สวัสดีตอนค่ำ';
  const busy = S.tables.filter(t => t.status === 'busy'), resv = S.tables.filter(t => t.status === 'resv').length;
  const due = busy.reduce((a, t) => a + calc(t.order, t.discount).total, 0);
  const now = !busy.length && !resv ? 'ตอนนี้ไม่มีโต๊ะค้าง — สบาย ๆ'
    : [busy.length && `มีลูกค้า ${busy.length} โต๊ะ`, resv && `จองไว้ ${resv} โต๊ะ`].filter(Boolean).join(' · ');
  $('dHero').innerHTML = `<div class="dh-top"><b class="dh-hi">${hi} ${esc(ME.name)} <span aria-hidden="true">👋</span></b>
      <span class="dh-date">${new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
    <button class="dh-now" type="button" data-go="tables"><span class="dh-ic">${icon('clock')}</span>
      <span><small>โต๊ะตอนนี้</small><b>${now}</b></span>${icon('next')}</button>`;
  const paidPct = inc + due > 0 ? Math.round(inc / (inc + due) * 100) : 100;
  const tile = (cls, ic, label, v, sub, go) => `<button class="dt ${cls}" type="button" data-go="${go}"><span class="dt-ic">${icon(ic)}</span>
    <span class="dt-l">${label}</span><b class="dt-v money">${v}</b><small>${sub}</small>${icon('next', 'dt-go')}</button>`;
  $('dSum').innerHTML = `<div class="ds-head">${icon('dollar')}<b>ยอดขาย<small>${esc(thRange(dash.from, dash.to))}</small></b>
      <button class="ds-hide" type="button" id="dHide">${icon(dashHide ? 'eye' : 'eyeoff')}<span>${dashHide ? 'แสดง' : 'ซ่อน'}</span></button></div>
    <button class="ds-big" type="button" data-go="report"><b class="money">${money0(inc)}</b><span>บาท</span>${icon('next')}</button>
    <div class="ds-paid"><span>เก็บเงินได้แล้ว</span><b>${paidPct}%</b></div>
    <div class="ds-bar"><span style="width:${paidPct}%"></span></div>
    <div class="ds-tiles">
      ${tile('ok', 'check', 'รับเงินแล้ว', money0(inc), 'บาท', 'report')}
      ${tile('bad', 'receipt', 'รายจ่าย', money0(exp), `${dash.expenses.length} รายการ`, 'exp')}
      ${tile('due', 'clock', 'ค้างรับ', money0(due), `${busy.length} โต๊ะที่เปิดอยู่`, 'tables')}
      ${tile(net < 0 ? 'bad' : 'ok', 'trend', 'กำไรสุทธิ', (net < 0 ? '-' : '') + money0(Math.abs(net)), inc ? `อัตรากำไร ${(net / inc * 100).toFixed(1)}%` : 'บาท', 'days')}
    </div>`;
  $('tab-dash').classList.toggle('hidemoney', dashHide);
  $('dHide').onclick = () => { dashHide = !dashHide; try { localStorage.setItem('dashHide', dashHide ? '1' : '0'); } catch {} renderDashTop(inc, exp, net); };
  // tiles jump to the tab or the card that explains the number
  $('tab-dash').querySelectorAll('[data-go]').forEach(b => b.onclick = () => {
    const g = b.dataset.go;
    if (g === 'tables' || g === 'report') {
      if (g === 'report') { rPicked = !(dash.from === dash.to && dash.to === dayKey(Date.now())); setRange(dash.from, dash.to); }
      return showTab(g);
    }
    $(g === 'exp' ? 'expTitle' : 'daysTitle').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}
