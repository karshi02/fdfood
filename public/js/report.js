/* ---------- report (admin) ---------- */
$('rDate').value = dayKey(Date.now());
let rDatePicked = false;
$('rDate').onchange = () => { rDatePicked = $('rDate').value !== dayKey(Date.now()); loadReport(); };
let report = { bills: [] };
async function loadReport() {
  const d = await act('bills&date=' + $('rDate').value);
  if (d) { report = d; renderReport(); }
}
function dayData() {
  const ok = report.bills.filter(b => !b.void), byMethod = {}, items = {};
  ok.forEach(b => {
    byMethod[b.method] = (byMethod[b.method] || 0) + b.total;
    b.items.forEach(i => { const x = items[i.name] || (items[i.name] = { name: i.name, qty: 0, amt: 0 }); x.qty += i.qty; x.amt += i.qty * i.price; });
  });
  return { bills: report.bills, ok, byMethod, total: ok.reduce((a, b) => a + b.total, 0), disc: ok.reduce((a, b) => a + b.disc, 0),
    top: Object.values(items).sort((a, b) => b.qty - a.qty) };
}
function renderReport() {
  const d = dayData();
  $('repStats').innerHTML = `
    <div class="stat"><span class="muted">ยอดขายสุทธิ</span><b>฿${baht(d.total)}</b></div>
    <div class="stat"><span class="muted">จำนวนบิล</span><b>${d.ok.length}</b></div>
    <div class="stat"><span class="muted">เฉลี่ย/บิล</span><b>฿${baht(d.ok.length ? d.total / d.ok.length : 0)}</b></div>
    <div class="stat"><span class="muted">ส่วนลดรวม</span><b>฿${baht(d.disc)}</b></div>
    ${Object.entries(d.byMethod).map(([k, v]) => `<div class="stat"><span class="muted">${METHODS[k]}</span><b>฿${baht(v)}</b></div>`).join('')}`;
  $('billBody').innerHTML = d.bills.slice().reverse().map(b => `<tr class="${b.void ? 'void' : ''}">
    <td>#${b.no}</td><td>${toDate(b.date).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</td><td>${esc(b.table)}</td>
    <td>${esc(b.cashier)}</td><td>${b.void ? 'ยกเลิก' : METHODS[b.method]}</td><td class="num">${baht(b.total)}</td>
    <td class="num" style="white-space:nowrap"><button class="btn ghost sm" data-print="${b.no}">พิมพ์ซ้ำ</button>
    ${isOwner() ? `<button class="btn ghost sm" data-redate="${b.no}">เปลี่ยนวัน</button>` : ''}
    ${b.void ? '' : `<button class="btn danger sm" data-void="${b.no}">ยกเลิก</button>`}</td></tr>`).join('')
    || '<tr><td colspan="7" class="muted">ไม่มีบิลวันนี้</td></tr>';
  $('topBody').innerHTML = d.top.map(i => `<tr><td>${esc(i.name)}</td><td class="num">${i.qty}</td><td class="num">${baht(i.amt)}</td></tr>`).join('')
    || '<tr><td colspan="3" class="muted">-</td></tr>';
  $('billBody').querySelectorAll('[data-print]').forEach(b => b.onclick = () => printBill(report.bills.find(x => x.no == b.dataset.print)));
  $('billBody').querySelectorAll('[data-redate]').forEach(x => x.onclick = () => redateBill(report.bills.find(b => b.no == x.dataset.redate)));
  $('billBody').querySelectorAll('[data-void]').forEach(b => b.onclick = async () => {
    if (confirm(`ยกเลิกบิล #${b.dataset.void}? ยอดจะไม่นับรวมยอดขาย`) && await act('bill_void', { no: Number(b.dataset.void) })) { loadReport(); toast(`ยกเลิกบิล #${b.dataset.void} แล้ว`); }
  });
}
// owner only: move a bill to another payment date-time; it then counts in that day's sales
async function redateBill(b) {
  const v = prompt(`เปลี่ยนวันชำระบิล #${b.no} (ปี-เดือน-วัน ชั่วโมง:นาที)`, String(b.date).slice(0, 16));
  if (v === null) return;
  const date = v.trim().replace('T', ' ');
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(date)) return alert('รูปแบบวันเวลาไม่ถูกต้อง เช่น 2026-10-20 18:30');
  if (await act('bill_date', { no: b.no, date })) { toast(`ย้ายบิล #${b.no} ไป ${date} แล้ว`); loadReport(); }
}
// one big bill for the whole day: all dishes added up, every bill listed (voided ones marked), totals
$('rPrint').onclick = async () => {
  const d = dayData(), s = S.settings;
  d.date = $('rDate').value;
  d.time = b => toDate(b.date).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  if (!d.bills.length) return toast('ไม่มีบิลในวันนี้');
  if (await viaBluetooth(() => BT.printDay(d), 'บิลรวมทั้งวัน')) return;
  $('receipt').className = '';
  $('receipt').innerHTML = `<div class="c"><h3>${esc(s.name)}</h3><div><b>บิลรวมทั้งวัน ${esc(d.date)}</b></div></div><hr>
    <table>${d.top.map(i => `<tr><td>${i.qty} x ${esc(i.name)}</td><td class="r">${baht(i.amt)}</td></tr>`).join('')}</table><hr>
    <table>${d.bills.map(b => `<tr><td>#${b.no} ${d.time(b)} โต๊ะ ${esc(b.table)}</td><td class="r">${b.void ? 'ยกเลิก' : baht(b.total)}</td></tr>`).join('')}</table><hr>
    <table><tr><td>จำนวนบิล</td><td class="r">${d.ok.length}</td></tr>
    ${Object.entries(d.byMethod).map(([k, v]) => `<tr><td>${METHODS[k]}</td><td class="r">${baht(v)}</td></tr>`).join('')}
    ${d.disc ? `<tr><td>ส่วนลดรวม</td><td class="r">-${baht(d.disc)}</td></tr>` : ''}
    <tr class="big"><td>ยอดสุทธิ</td><td class="r">${baht(d.total)}</td></tr></table>
    <hr><div class="c">พิมพ์ ${new Date().toLocaleString('th-TH')} โดย ${esc(ME.name)}</div>`;
  window.print();
};
