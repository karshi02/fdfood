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
  $('dStats').innerHTML = `
    <div class="stat"><span class="muted">รายรับ (ยอดขายสุทธิ)</span><b>฿${baht(inc)}</b><small>เฉลี่ย ฿${baht(inc / days.length)}/วัน</small></div>
    <div class="stat"><span class="muted">รายจ่าย</span><b>฿${baht(exp)}</b><small>${dash.expenses.length} รายการ</small></div>
    <div class="stat ${net >= 0 ? 'good' : 'bad'}"><span class="muted">กำไรสุทธิ</span><b>${net < 0 ? '-' : ''}฿${baht(Math.abs(net))}</b><small>${inc ? `อัตรากำไร ${(net / inc * 100).toFixed(1)}%` : '&nbsp;'}</small></div>
    <div class="stat"><span class="muted">จำนวนบิล</span><b>${n}</b><small>ยกเลิก ${dash.voids} บิล</small></div>
    <div class="stat"><span class="muted">เฉลี่ย/บิล</span><b>฿${baht(n ? inc / n : 0)}</b><small>ส่วนลดรวม ฿${baht(sum('disc'))}</small></div>`;
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
  $('expBody').innerHTML = dash.expenses.map(e => `<tr><td style="white-space:nowrap">${thDay(e.date)}</td><td>${esc(e.cat)}</td>
    <td class="muted">${esc(e.note)}</td><td class="num">${baht(e.amount)}</td>
    <td class="num" style="white-space:nowrap"><button class="btn ghost sm" data-eedit="${e.id}">แก้ไข</button> <button class="btn ghost sm" data-edel="${e.id}">ลบ</button></td></tr>`).join('')
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
