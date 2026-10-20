/* ---------- table modal ---------- */
// cashIn survives re-renders, so another device's change doesn't wipe the amount the cashier typed
let cur = null, curCat = '', payMethod = 'cash', cashIn = '';
function openTable(id) { cur = id; curCat = ''; payMethod = 'cash'; cashIn = ''; $('modal').classList.remove('hidden'); renderModal(); }
function closeModal() { cur = null; $('modal').classList.add('hidden'); }
$('modal').onclick = e => { if (e.target.id === 'modal') closeModal(); };
document.addEventListener('keydown', e => { if (e.key === 'Escape' && cur) closeModal(); });

function renderModal() {
  const t = S.tables.find(x => x.id === cur);
  if (!t) return closeModal();
  $('mdTitle').textContent = `โต๊ะ ${t.name}`;
  $('mdTools').innerHTML = (t.status === 'busy' ? '<button class="btn ghost sm" id="move">ย้าย / รวมโต๊ะ</button>' : '')
    + '<button class="btn ghost sm" id="mdClose">ปิด ✕</button>';
  $('mdClose').onclick = closeModal;
  if ($('move')) $('move').onclick = () => moveTable(t);
  const b = $('mdBody');

  if (t.status !== 'busy') {
    const r = t.resv || { time: '', pax: 2 };
    b.innerHTML = `<div class="card">
      <h2>${t.status === 'resv' ? 'ข้อมูลการจอง' : 'จองโต๊ะ'}</h2>
      <div class="row">
        <div><label>วัน-เวลา</label><input id="rTime" type="datetime-local" value="${esc(String(r.time || '').replace(' ', 'T'))}"></div>
        <div><label>จำนวนคน</label><input id="rPax" type="number" min="1" value="${esc(r.pax)}"></div>
      </div>
      <div class="actions">
        <button class="btn" id="rSave">${t.status === 'resv' ? 'บันทึกการจอง' : 'จองโต๊ะ'}</button>
        ${t.status === 'resv' ? '<button class="btn ghost" id="rCancel">ยกเลิกการจอง</button>' : ''}
        <button class="btn brand" id="open">เปิดโต๊ะ / เริ่มสั่งอาหาร</button>
      </div></div>`;
    $('rSave').onclick = async () => {
      if (await act('resv_save', { table: t.id, time: $('rTime').value.replace('T', ' '), pax: Number($('rPax').value) })) closeModal();
    };
    if ($('rCancel')) $('rCancel').onclick = async () => { if (confirm('ยกเลิกการจอง?') && await act('resv_cancel', { table: t.id })) { closeModal(); toast(`ยกเลิกการจองโต๊ะ ${t.name} แล้ว`); } };
    $('open').onclick = () => act('open', { table: t.id });
    return;
  }

  const list = S.menu.filter(m => !curCat || m.cat === curCat);
  const c = calc(t.order, t.discount);
  const pendingQty = t.order.reduce((a, i) => a + Math.max(0, i.qty - i.sent), 0);
  const has = t.order.length > 0;
  b.innerHTML = `<div class="split">
    <div class="card">
      <div class="sheet-head" style="margin-bottom:8px"><h2 style="margin:0">เมนู (กดเพื่อสั่ง)</h2>
        ${can('menu') ? '<button class="btn sm" id="qaToggle">+ เมนูใหม่</button>' : ''}</div>
      <div id="qa" class="qa hidden">
        <div class="row">
          <div><label>ชื่อเมนู</label><input id="qaName"></div>
          <div style="flex:0 1 100px"><label>ราคา</label><input id="qaPrice" type="number" min="0" step="0.01"></div>
          <div style="flex:0 1 130px"><label>หมวด</label><input id="qaCat" list="catList" value="${esc(curCat)}"></div>
        </div>
        <div class="actions"><button class="btn brand sm" id="qaOrder">บันทึก + สั่งเลย</button><button class="btn ghost sm" id="qaOnly">บันทึกเมนูอย่างเดียว</button></div>
      </div>
      <input id="search" placeholder="ค้นหาเมนู..." style="margin-bottom:10px">
      <div class="cats scroll">${['', ...cats()].map(k => `<button class="chip ${k === curCat ? 'on' : ''}" data-cat="${esc(k)}">${esc(k || 'ทั้งหมด')}</button>`).join('')}</div>
      <div class="menu-grid" id="mGrid">${list.map(m => `<button class="mi" data-add="${m.id}" data-n="${esc(m.name.toLowerCase())}" ${m.out ? 'disabled style="opacity:.45"' : ''}>${esc(m.name)}<span>${m.out ? 'หมด' : '฿' + baht(m.price)}</span></button>`).join('') || '<p class="muted">ไม่มีเมนู</p>'}</div>
    </div>
    <div class="card order" id="orderCard">
      <h2>รายการที่สั่ง ${t.resv && t.resv.name ? `<span class="muted">· ${esc(t.resv.name)}</span>` : ''}</h2>
      <table class="list"><tbody>${t.order.map(i => `<tr>
        <td>${esc(i.name)}${i.qty > i.sent ? `<span class="tag">ใหม่ ${i.qty - i.sent}</span>` : ''}
          <div class="muted">฿${baht(i.price)} · <button class="note" data-note="${i.id}">${i.note ? esc(i.note) : '+ หมายเหตุ'}</button></div></td>
        <td><span class="qty"><button data-q="${i.id}" data-d="-1">−</button>${i.qty}<button data-q="${i.id}" data-d="1">+</button></span></td>
        <td class="num">${baht(i.price * i.qty)}</td></tr>`).join('') || '<tr><td class="muted">ยังไม่มีรายการ</td></tr>'}</tbody></table>
      <div class="actions"><button class="btn sm" id="kitchen" ${pendingQty ? '' : 'disabled'}>ส่งครัว (${pendingQty})</button>
        ${can('discount') ? `<button class="btn ghost sm" id="disc" ${has ? '' : 'disabled'}>${t.discount ? 'แก้ส่วนลด' : 'ส่วนลด'}</button>` : ''}</div>
      <div style="margin-top:10px">
        <div class="line"><span>รวม</span><span>${baht(c.sub)}</span></div>
        ${c.disc ? `<div class="line"><span>ส่วนลด${t.discount.type === 'pct' ? ' ' + t.discount.value + '%' : ''}</span><span>-${baht(c.disc)}</span></div>` : ''}
        ${c.service ? `<div class="line"><span>Service ${S.settings.service}%</span><span>${baht(c.service)}</span></div>` : ''}
        ${c.vat ? `<div class="line"><span>VAT ${S.settings.vat}%</span><span>${baht(c.vat)}</span></div>` : ''}
        <div class="total"><span>ยอดสุทธิ</span><span>฿${baht(c.total)}</span></div>
      </div>
      ${t.checked ? `<p class="muted" style="margin:0 0 10px;color:var(--resv)">${sameTotal(t)
        ? `เช็คบิลแล้ว ${toDate(t.checked.at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} · รอชำระ`
        : `ยอดเปลี่ยนจากตอนเช็คบิล (฿${baht(t.checked.total)}) — กดเช็คบิลพิมพ์ใหม่`}</p>` : ''}
      <div class="cats">${Object.entries(METHODS).map(([k, v]) => `<button class="chip ${k === payMethod ? 'on' : ''}" data-m="${k}">${v}</button>`).join('')}</div>
      ${payMethod === 'cash' ? `<div class="row"><div><label>รับเงิน (บาท)</label><input id="cash" type="number" min="0" step="0.01" value="${esc(cashIn)}"></div>
        <div><label>เงินทอน</label><input id="change" readonly></div></div>
        <div class="actions" style="margin-top:6px">${[100, 500, 1000].map(n => `<button class="chip" data-cash="${n}">${n}</button>`).join('')}<button class="chip" data-cash="${c.total}">พอดี</button></div>` : ''}
      ${payMethod === 'qr' ? (S.settings.promptpay ? `<div class="qr">${qrSvg(c.total) || '<p class="muted">สร้าง QR ไม่ได้ (ต้องต่ออินเทอร์เน็ต)</p>'}<div class="muted">พร้อมเพย์ ${esc(S.settings.promptpay)} · ฿${baht(c.total)}</div></div>` : '<p class="muted">ให้แอดมินตั้งเบอร์พร้อมเพย์ในแท็บ "ตั้งค่า" ก่อน</p>') : ''}
      <div class="actions">
        <button class="btn brand lg" id="pay" ${has ? '' : 'disabled'}>ชำระเงิน + พิมพ์บิล · ฿${baht(c.total)}</button>
        <button class="btn ghost" style="flex:1" id="preview" ${has ? '' : 'disabled'}>${t.checked ? 'เช็คบิล + พิมพ์อีกครั้ง' : 'เช็คบิล + พิมพ์'}</button>
        ${has ? '' : '<button class="btn danger" id="cancelOpen">ยกเลิกเปิดโต๊ะ</button>'}
        ${has && can('void') ? '<button class="btn danger" id="voidTable">ยกเลิกบิล / ปิดโต๊ะ (ไม่เก็บเงิน)</button>' : ''}
      </div>
    </div></div>
    <button class="btn brand jump" id="jump"><span>ดูรายการ / ชำระเงิน (${t.order.reduce((a, i) => a + i.qty, 0)})</span><span>฿${baht(c.total)}</span></button>`;
  $('jump').onclick = () => $('orderCard').scrollIntoView({ behavior: 'smooth' });

  b.querySelectorAll('[data-cat]').forEach(x => x.onclick = () => { curCat = x.dataset.cat; renderModal(); });
  b.querySelectorAll('[data-m]').forEach(x => x.onclick = () => { payMethod = x.dataset.m; renderModal(); });
  b.querySelectorAll('[data-add]').forEach(x => x.onclick = () => act('item_add', { table: t.id, menu: Number(x.dataset.add) }));
  b.querySelectorAll('[data-q]').forEach(x => x.onclick = () => {
    const i = t.order.find(o => o.id == x.dataset.q), d = Number(x.dataset.d);
    if (d < 0 && i.qty <= i.sent && !confirm(`"${i.name}" ส่งครัวไปแล้ว ยืนยันลด?`)) return;
    act('item_qty', { item: i.id, delta: d });
  });
  b.querySelectorAll('[data-note]').forEach(x => x.onclick = () => {
    const i = t.order.find(o => o.id == x.dataset.note);
    const n = prompt('หมายเหตุ (เช่น ไม่เผ็ด, ไม่ใส่ผัก)', i.note);
    if (n !== null) act('item_note', { item: i.id, note: n });
  });
  if ($('qaToggle')) {
    $('qaToggle').onclick = () => { $('qa').classList.toggle('hidden'); $('qaName').focus(); };
    const qaSave = order => {
      const name = $('qaName').value.trim();
      if (!name || $('qaPrice').value === '') return alert('ใส่ชื่อและราคา');
      const body = { name, price: Number($('qaPrice').value), cat: $('qaCat').value.trim() };
      act(order ? 'menu_add_order' : 'menu_save', order ? { table: t.id, ...body } : body);
    };
    $('qaOrder').onclick = () => qaSave(true);
    $('qaOnly').onclick = () => qaSave(false);
    $('qaPrice').onkeydown = e => { if (e.key === 'Enter') qaSave(true); };
  }
  $('search').oninput = e => {
    const q = e.target.value.toLowerCase();
    $('mGrid').querySelectorAll('.mi').forEach(el => el.classList.toggle('hidden', !el.dataset.n.includes(q)));
  };
  $('kitchen').onclick = async () => {
    const d = await act('kitchen', { table: t.id });
    if (d && d.pending.length) printKitchen(t.name, d.pending);
  };
  if ($('disc')) $('disc').onclick = () => {
    const v = prompt('ส่วนลด: พิมพ์ตัวเลข = บาท, ลงท้าย % = เปอร์เซ็นต์ (เช่น 50 หรือ 10%) — เว้นว่างเพื่อลบ', t.discount ? t.discount.value + (t.discount.type === 'pct' ? '%' : '') : '');
    if (v === null) return;
    const n = parseFloat(v);
    if (v.trim() && !(n > 0)) return alert('ส่วนลดต้องเป็นตัวเลขมากกว่า 0 (เว้นว่างเพื่อลบส่วนลด)');
    act('discount', { table: t.id, type: v.trim() && n > 0 ? (v.includes('%') ? 'pct' : 'amt') : null, value: n || 0 });
  };
  if ($('cash')) {
    const upd = () => {
      cashIn = $('cash').value;
      const v = Number(cashIn);
      $('change').value = cashIn ? (v >= c.total ? baht(v - c.total) : 'เงินไม่พอ') : '';
    };
    $('cash').oninput = upd;
    b.querySelectorAll('[data-cash]').forEach(x => x.onclick = () => { $('cash').value = x.dataset.cash; upd(); });
    upd();
  }
  $('preview').onclick = async () => {
    if (pendingQty && !confirm('มีรายการยังไม่ส่งครัว — เช็คบิลต่อเลย?')) return;
    if (!await act('check_bill', { table: t.id })) return;
    toast(`เช็คบิลโต๊ะ ${t.name} ฿${baht(c.total)}`);
    printBill({ no: null, table: t.name, date: new Date(), items: t.order, ...c,
    servicePct: S.settings.service, vatPct: S.settings.vat, cash: null }, true);
  };
  $('pay').onclick = async () => {
    const cash = $('cash') && $('cash').value ? Number($('cash').value) : null;
    if (cash !== null && cash < c.total) return alert('รับเงินไม่พอ');
    if (pendingQty && !confirm('มีรายการยังไม่ส่งครัว — ชำระต่อเลย?')) return;
    if (!confirm(`ยืนยันชำระ ${METHODS[payMethod]} ฿${baht(c.total)} และปิดโต๊ะ?`)) return;
    const d = await act('pay', { table: t.id, method: payMethod, cash });
    if (d) { closeModal(); toast(`ชำระเงินแล้ว · ปิดโต๊ะ ${t.name}`); printBill(d.bill); }
  };
  if ($('cancelOpen')) $('cancelOpen').onclick = async () => { if (await act('cancel_open', { table: t.id })) { closeModal(); toast(`ยกเลิกเปิดโต๊ะ ${t.name} แล้ว`); } };
  if ($('voidTable')) $('voidTable').onclick = async () => {
    if (!confirm(`ยกเลิกบิลโต๊ะ ${t.name} ฿${baht(c.total)} และปิดโต๊ะโดยไม่เก็บเงิน?\nรายการจะถูกบันทึกเป็น "บิลยกเลิก" ในยอดขาย`)) return;
    if (await act('table_void', { table: t.id })) { closeModal(); toast(`ยกเลิกบิลและปิดโต๊ะ ${t.name} แล้ว`); }
  };
}

function moveTable(t) {
  const others = S.tables.filter(x => x.id !== t.id && x.status !== 'resv');
  const name = prompt(`ย้าย/รวมโต๊ะ ${t.name} ไปโต๊ะไหน?\nว่าง: ${others.filter(x => x.status === 'free').map(x => x.name).join(', ') || '-'}\nมีลูกค้า (รวมบิล): ${others.filter(x => x.status === 'busy').map(x => x.name).join(', ') || '-'}`);
  if (!name) return;
  const to = others.find(x => x.name === name.trim());
  if (!to) return alert('ไม่พบโต๊ะ หรือโต๊ะนั้นถูกจองไว้');
  if (to.status === 'busy' && !confirm(`รวมรายการโต๊ะ ${t.name} เข้าโต๊ะ ${to.name}?`)) return;
  act('move', { from: t.id, to: to.id }).then(d => { if (d) { cur = to.id; renderModal(); } });
}
