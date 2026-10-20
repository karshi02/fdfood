/* ---------- report (admin) ---------- */
// sales for one day or a from..to range picked on the calendar; rPicked keeps a picked range when coming back to the tab
let rFrom = dayKey(Date.now()), rTo = rFrom, rPicked = false;
function setRange(f, t) { rFrom = f; rTo = t; $('rRangeTxt').textContent = thRange(f, t); }
setRange(rFrom, rTo);
$('rRange').onclick = () => pickRange(rFrom, rTo, (f, t) => { const today = dayKey(Date.now()); rPicked = !(f === today && t === today); setRange(f, t); loadReport(); });
let report = { bills: [] };
async function loadReport() {
  const d = await act(`bills&from=${rFrom}&to=${rTo}`);
  if (d) { report = d; renderReport(); }
}
function dayData() {
  const ok = report.bills.filter(b => !b.void), byMethod = {}, items = {};
  ok.forEach(b => {
    Object.entries(payParts(b)).forEach(([k, v]) => { byMethod[k] = (byMethod[k] || 0) + v; });
    b.items.forEach(i => { const x = items[i.name] || (items[i.name] = { name: i.name, qty: 0, amt: 0 }); x.qty += i.qty; x.amt += i.qty * i.price; });
  });
  // bill items keep no category, so group by the dish's current one; deleted or renamed dishes fall under "ไม่มีหมวด"
  const catOf = new Map(S.menu.map(m => [m.name, m.cat])), byCat = {};
  Object.values(items).forEach(i => { const k = catOf.get(i.name) || '', x = byCat[k] || (byCat[k] = { cat: k, qty: 0, amt: 0 }); x.qty += i.qty; x.amt += i.amt; });
  return { bills: report.bills, ok, byMethod, total: ok.reduce((a, b) => a + b.total, 0), disc: ok.reduce((a, b) => a + b.disc, 0),
    top: Object.values(items).sort((a, b) => b.qty - a.qty), cats: Object.values(byCat).sort((a, b) => b.amt - a.amt) };
}
function renderReport() {
  const d = dayData();
  $('repStats').innerHTML = `
    <div class="stat"><span class="muted">ยอดขายสุทธิ</span><b>฿${baht(d.total)}</b></div>
    <div class="stat"><span class="muted">จำนวนบิล</span><b>${d.ok.length}</b></div>
    <div class="stat"><span class="muted">เฉลี่ย/บิล</span><b>฿${baht(d.ok.length ? d.total / d.ok.length : 0)}</b></div>
    <div class="stat"><span class="muted">ส่วนลดรวม</span><b>฿${baht(d.disc)}</b></div>
    ${Object.entries(d.byMethod).map(([k, v]) => `<div class="stat"><span class="muted">${METHODS[k]}</span><b>฿${baht(v)}</b></div>`).join('')}`;
  // phone: each row becomes a compact two-line card (see .billtbl in sheet.css); tap it for the dishes and the bill's actions
  $('billBody').innerHTML = d.bills.slice().reverse().map(b => `<tr class="${b.void ? 'void' : ''}" data-row="${b.no}">
    <td class="bno"><button class="linkbtn" data-view="${b.no}" title="ดูรายการในบิล">#${billNo(b)}</button></td>
    <td class="btime">${rFrom === rTo ? '' : calDay(dayKey(toDate(b.date))) + ' '}${toDate(b.date).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</td>
    <td class="btbl">${esc(b.table)}</td><td class="bwho">${esc(b.cashier)}</td>
    <td class="bpay">${b.void ? 'ยกเลิก' : METHODS[b.method]}${b.method === 'mixed' && !b.void ? `<div class="muted">สด ${baht(b.total - b.transfer)} · โอน ${baht(b.transfer)}</div>` : ''}</td>
    <td class="num bamt">${baht(b.total)}</td>
    <td class="num bact">${billActs(b)}</td></tr>`).join('')
    || `<tr><td colspan="7" class="muted">ไม่มีบิล${rFrom === rTo ? 'วันนี้' : 'ในช่วงนี้'}</td></tr>`;
  $('topBody').innerHTML = d.top.map(i => `<tr><td>${esc(i.name)}</td><td class="num">${i.qty}</td><td class="num">${baht(i.amt)}</td></tr>`).join('')
    || '<tr><td colspan="3" class="muted">-</td></tr>';
  const catSum = d.cats.reduce((a, c) => a + c.amt, 0) || 1, catMax = d.cats.length ? d.cats[0].amt || 1 : 1;
  $('catBody').innerHTML = d.cats.map((c, n) => `<tr><td class="muted">${n + 1}</td>
    <td>${esc(c.cat || 'ไม่มีหมวด')}<div class="cattrack"><span style="width:${c.amt / catMax * 100}%"></span></div></td>
    <td class="num">${c.qty}</td><td class="num">${baht(c.amt)}</td><td class="num">${(c.amt / catSum * 100).toFixed(0)}%</td></tr>`).join('')
    || '<tr><td colspan="5" class="muted">-</td></tr>';
  $('billBody').querySelectorAll('[data-view]').forEach(x => x.onclick = () => viewBill(report.bills.find(b => b.no == x.dataset.view)));
  $('billBody').querySelectorAll('[data-row]').forEach(r => r.onclick = e => { if (!e.target.closest('button, select')) viewBill(report.bills.find(b => b.no == r.dataset.row)); });
  bindBillActs($('billBody'));
}
// reprint / change date / void, and for the owner: change how it was paid or reopen it; shown in the table row and in the bill sheet
function billActs(b, withPrint = true) {
  return `${withPrint ? `<button class="btn ghost sm" data-print="${b.no}">พิมพ์ซ้ำ</button>` : ''}
    ${isOwner() ? `<button class="btn ghost sm" data-redate="${b.no}">เปลี่ยนวัน</button>` : ''}
    ${b.void ? '' : `<button class="btn danger sm" data-void="${b.no}">ยกเลิก</button>`}
    ${!b.void && isOwner() ? `<div class="owneract">
      <select data-method="${b.no}" title="เปลี่ยนวิธีชำระ">${PAY_METHODS.concat(PAY_METHODS.includes(b.method) ? [] : [b.method]).map(k => `<option value="${k}" ${k === b.method ? 'selected' : ''}>${METHODS[k]}</option>`).join('')}</select>
      <button class="btn warn sm" data-reopen="${b.no}">เปิดบิลชำระใหม่</button></div>` : ''}`;
}
// done(): close the bill sheet before a change reloads the list under it
function bindBillActs(root, done = () => {}) {
  root.querySelectorAll('[data-print]').forEach(b => b.onclick = () => printBill(report.bills.find(x => x.no == b.dataset.print)));
  root.querySelectorAll('[data-redate]').forEach(x => x.onclick = () => { done(); redateBill(report.bills.find(b => b.no == x.dataset.redate)); });
  // owner only (the server checks too): fix how a bill was paid, or reopen it to take payment again
  root.querySelectorAll('[data-method]').forEach(s => s.onchange = async () => {
    const no = Number(s.dataset.method), bill = report.bills.find(x => x.no === no);
    if (!confirm(`เปลี่ยนวิธีชำระบิล #${billNo(bill)} จาก "${METHODS[bill.method]}" เป็น "${METHODS[s.value]}"?`)) { s.value = bill.method; return; }
    if (await act('bill_method', { no, method: s.value })) { done(); toast(`บิล #${billNo(bill)} เปลี่ยนเป็น ${METHODS[s.value]} แล้ว`); loadReport(); }
    else s.value = bill.method;
  });
  root.querySelectorAll('[data-reopen]').forEach(b => b.onclick = async () => {
    const no = Number(b.dataset.reopen), bill = report.bills.find(x => x.no === no);
    if (!confirm(`เปิดบิล #${billNo(bill)} (โต๊ะ ${bill.table} ฿${baht(bill.total)}) เพื่อชำระใหม่?\nบิลนี้จะถูกบันทึกเป็น "ยกเลิก" และรายการทั้งหมดจะกลับไปที่โต๊ะ ${bill.table}`)) return;
    const d = await act('bill_reopen', { no });
    if (!d) return;
    done();
    toast(`เปิดบิล #${billNo(bill)} ที่โต๊ะ ${bill.table} แล้ว — ชำระใหม่ได้เลย`);
    loadReport();
    showTab('tables'); openTable(d.table);
  });
  root.querySelectorAll('[data-void]').forEach(b => b.onclick = async () => {
    const shown = billNo(report.bills.find(x => x.no == b.dataset.void));
    if (confirm(`ยกเลิกบิล #${shown}? ยอดจะไม่นับรวมยอดขาย`) && await act('bill_void', { no: Number(b.dataset.void) })) { done(); loadReport(); toast(`ยกเลิกบิล #${shown} แล้ว`); }
  });
}
// tap a bill number: its dishes, totals and how it was paid
function viewBill(b) {
  if (!b) return;
  $('bvTitle').textContent = `บิล #${billNo(b)}${b.void ? ' (ยกเลิก)' : ''}`;
  $('bvBody').innerHTML = `<p class="muted" style="margin:0 0 10px">${toDate(b.date).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })} · โต๊ะ ${esc(b.table)}${b.cashier ? ' · ' + esc(b.cashier) : ''}</p>
    <table class="list"><thead><tr><th>รายการ</th><th class="num">จำนวน</th><th class="num">ราคา</th><th class="num">รวม</th></tr></thead><tbody>
    ${b.items.map(i => `<tr><td>${esc(i.name)}${i.note ? `<div class="muted">${esc(i.note)}</div>` : ''}</td><td class="num">${i.qty}</td><td class="num">${baht(i.price)}</td><td class="num">${baht(i.qty * i.price)}</td></tr>`).join('')
      || '<tr><td colspan="4" class="muted">ไม่มีรายการ</td></tr>'}</tbody></table>
    <table class="list bv-sum">
      <tr><td>รวม</td><td class="num">${baht(b.sub)}</td></tr>
      ${b.disc ? `<tr><td>ส่วนลด</td><td class="num">-${baht(b.disc)}</td></tr>` : ''}
      ${b.service ? `<tr><td>ค่าบริการ ${b.servicePct}%</td><td class="num">${baht(b.service)}</td></tr>` : ''}
      ${b.vat ? `<tr><td>VAT ${b.vatPct}%</td><td class="num">${baht(b.vat)}</td></tr>` : ''}
      <tr><td><b>ยอดสุทธิ</b></td><td class="num"><b>฿${baht(b.total)}</b></td></tr>
      ${b.method === 'mixed' ? `<tr><td>เงินสด</td><td class="num">${baht(b.total - b.transfer)}</td></tr><tr><td>โอน</td><td class="num">${baht(b.transfer)}</td></tr>` : ''}
      <tr><td>${b.void ? 'ยกเลิกแล้ว' : 'ชำระโดย ' + (METHODS[b.method] || b.method)}</td><td class="num">${b.cash != null ? `รับ ${baht(b.cash)} · ทอน ${baht(b.change)}` : ''}</td></tr>
    </table>
    <div class="bvacts">${billActs(b, false)}</div>`;
  bindBillActs($('bvBody'), () => $('billView').classList.add('hidden'));
  $('bvPrint').onclick = () => printBill(b);
  $('billView').classList.remove('hidden');
}
$('bvClose').onclick = () => $('billView').classList.add('hidden');
$('billView').onclick = e => { if (e.target.id === 'billView') $('billView').classList.add('hidden'); };
// owner only: move a bill to another payment date-time; it then counts in that day's sales
async function redateBill(b) {
  const v = prompt(`เปลี่ยนวันชำระบิล #${billNo(b)} (ปี-เดือน-วัน ชั่วโมง:นาที)`, String(b.date).slice(0, 16));
  if (v === null) return;
  const date = v.trim().replace('T', ' ');
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(date)) return alert('รูปแบบวันเวลาไม่ถูกต้อง เช่น 2026-10-20 18:30');
  if (await act('bill_date', { no: b.no, date })) { toast(`ย้ายบิล #${billNo(b)} ไป ${date} แล้ว`); loadReport(); }
}
// one big bill for the picked day or range: all dishes added up, every bill listed (voided ones marked), totals
$('rPrint').onclick = async () => {
  const d = dayData(), s = S.settings;
  d.date = thRange(rFrom, rTo);
  d.title = (rFrom === rTo ? 'บิลรวมทั้งวัน ' : 'บิลรวม ') + d.date;
  d.time = b => (rFrom === rTo ? '' : calDay(dayKey(toDate(b.date))) + ' ') + toDate(b.date).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  if (!d.bills.length) return toast('ไม่มีบิลในช่วงนี้');
  if (await viaBluetooth(() => BT.printDay(d), 'บิลรวม')) return;
  $('receipt').className = '';
  $('receipt').innerHTML = `<div class="c"><h3>${esc(s.name)}</h3><div><b>${esc(d.title)}</b></div></div><hr>
    <table>${d.top.map(i => `<tr><td>${i.qty} x ${esc(i.name)}</td><td class="r">${baht(i.amt)}</td></tr>`).join('')}</table><hr>
    <table>${d.bills.map(b => `<tr><td>#${billNo(b)} ${d.time(b)} โต๊ะ ${esc(b.table)}</td><td class="r">${b.void ? 'ยกเลิก' : baht(b.total)}</td></tr>`).join('')}</table><hr>
    <table><tr><td>จำนวนบิล</td><td class="r">${d.ok.length}</td></tr>
    ${Object.entries(d.byMethod).map(([k, v]) => `<tr><td>${METHODS[k]}</td><td class="r">${baht(v)}</td></tr>`).join('')}
    ${d.disc ? `<tr><td>ส่วนลดรวม</td><td class="r">-${baht(d.disc)}</td></tr>` : ''}
    <tr class="big"><td>ยอดสุทธิ</td><td class="r">${baht(d.total)}</td></tr></table>
    <hr><div class="c">พิมพ์ ${new Date().toLocaleString('th-TH')} โดย ${esc(ME.name)}</div>`;
  window.print();
};
