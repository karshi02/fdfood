/* ---------- print ---------- */
// a Bluetooth printer paired on this device takes the job; otherwise (or if it fails) the browser print dialog
async function viaBluetooth(job, what) {
  if (!BT.active()) return false;
  if (await job()) { toast(`พิมพ์${what}แล้ว`); return true; }
  return !confirm(`พิมพ์${what}ผ่านบลูทูธไม่สำเร็จ
${BT.state().msg}

พิมพ์ผ่านเบราว์เซอร์แทน?`);
}

async function printKitchen(tableName, items) {
  if (BT.useForKitchen() && await viaBluetooth(() => BT.printKitchen(tableName, items), 'ใบสั่งครัว')) return;
  $('receipt').className = 'kitchen';
  $('receipt').innerHTML = `<div class="c"><h3>โต๊ะ ${esc(tableName)}</h3><div>${new Date().toLocaleTimeString('th-TH')} · ${esc(ME.name)}</div></div><hr>
    <table>${items.map(i => `<tr><td><b>${i.qty} x ${esc(i.name)}</b>${i.note ? `<br>  * ${esc(i.note)}` : ''}</td></tr>`).join('')}</table><hr>`;
  window.print();
}

async function printBill(b, isPreview) {
  if (await viaBluetooth(() => BT.printBill(b, isPreview), isPreview ? 'ใบแจ้งยอด' : 'ใบเสร็จ')) return;
  const s = S.settings;
  $('receipt').className = '';
  $('receipt').innerHTML = `
    <div class="c"><h3>${esc(s.name)}</h3>${s.addr ? `<div>${esc(s.addr)}</div>` : ''}${s.phone ? `<div>โทร ${esc(s.phone)}</div>` : ''}</div>
    <hr>
    <div>${isPreview ? '<b>ใบแจ้งยอด (ยังไม่ชำระ)</b>' : `ใบเสร็จ #${b.no}${b.void ? ' (ยกเลิก)' : ''}`}</div>
    <div>โต๊ะ ${esc(b.table)} · ${(b.date instanceof Date ? b.date : toDate(b.date)).toLocaleString('th-TH')}</div>
    ${b.cashier ? `<div>แคชเชียร์ ${esc(b.cashier)}</div>` : ''}
    <hr>
    <table>${b.items.map(i => `<tr><td>${i.qty} x ${esc(i.name)}${i.note ? ` (${esc(i.note)})` : ''}</td><td class="r">${baht(i.price * i.qty)}</td></tr>`).join('')}</table>
    <hr>
    <table>
      <tr><td>รวม</td><td class="r">${baht(b.sub)}</td></tr>
      ${b.disc ? `<tr><td>ส่วนลด</td><td class="r">-${baht(b.disc)}</td></tr>` : ''}
      ${b.service ? `<tr><td>Service ${b.servicePct}%</td><td class="r">${baht(b.service)}</td></tr>` : ''}
      ${b.vat ? `<tr><td>VAT ${b.vatPct}%</td><td class="r">${baht(b.vat)}</td></tr>` : ''}
      <tr class="big"><td>ยอดสุทธิ</td><td class="r">${baht(b.total)}</td></tr>
      ${!isPreview ? `<tr><td>ชำระโดย</td><td class="r">${METHODS[b.method]}</td></tr>` : ''}
      ${b.cash !== null ? `<tr><td>รับเงิน</td><td class="r">${baht(b.cash)}</td></tr><tr><td>เงินทอน</td><td class="r">${baht(b.change)}</td></tr>` : ''}
    </table>
    ${isPreview && s.promptpay ? `<hr><div class="c">สแกนจ่ายพร้อมเพย์<br>${qrSvg(b.total)}</div>` : ''}
    <hr>
    <div class="c">${esc(s.footer)}</div>`;
  window.print();
}
