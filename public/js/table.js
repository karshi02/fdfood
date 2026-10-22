/* ---------- table modal ---------- */
// cashIn / xferIn survive re-renders, so another device's change doesn't wipe the amount the cashier typed
// resvTime likewise keeps a picked booking time across the 3-second sync re-render
// curQ keeps the menu search across the re-render that follows each tap on a dish
// draft: the order sheet is showing for a table that isn't open yet; the first dish opens it on the server
// opening: guests, dine-in/takeaway and (owner only) the open time, sent along with the first dish
// orderAt / payAt: the owner's back-dated order and payment times; '' means now
// slip: photo of the customer's transfer slip (data: URL), optional; mixQr: the mixed amounts were confirmed, show the QR
let cur = null, curCat = '', curQ = '', payMethod = 'cash', cashIn = '', xferIn = '', resvTime = '', draft = false, slip = '', mixQr = false;
let opening = { pax: '', takeaway: false, opened: '' }, orderAt = '', payAt = '';
// datetime-local wants local time; toISOString() alone is UTC, 7 hours behind in Bangkok
const nowLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
// what every dish carries: it opens the table if it's the first one (the server ignores the opening fields otherwise)
const dishExtra = () => ({ pax: Number(opening.pax) || null, takeaway: opening.takeaway ? 1 : 0, opened: isOwner() ? opening.opened : '', at: isOwner() ? orderAt : '' });
function openTable(id, asDraft) {
  cur = id; draft = !!asDraft; curCat = ''; curQ = ''; payMethod = 'cash'; cashIn = ''; xferIn = ''; resvTime = ''; orderAt = ''; payAt = ''; slip = ''; mixQr = false;
  const t = S.tables.find(x => x.id === id);
  opening = { pax: t && t.resv ? String(t.resv.pax || '') : '', takeaway: false, opened: '' };
  $('modal').classList.remove('hidden'); renderModal();
}
function closeModal() {
  // leaving an open table with nothing ordered frees it again; quiet, since another device may have just added a dish
  const t = S.tables.find(x => x.id === cur);
  if (t && t.status === 'busy' && !t.order.length && !t.guestOpen) fetch('api.php?a=cancel_open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ table: t.id }) })
    .then(r => r.json()).then(d => d.tables && apply(d)).catch(() => {});
  cur = null; draft = false; $('modal').classList.add('hidden');
}
$('modal').onclick = e => { if (e.target.id === 'modal') closeModal(); };
document.addEventListener('keydown', e => { if (e.key === 'Escape' && cur) closeModal(); });

function renderModal() {
  const t = S.tables.find(x => x.id === cur);
  if (!t) return closeModal();
  const stLabel = t.status === 'free' ? 'ว่าง' : t.status === 'resv' ? 'จองไว้' : t.checked ? 'รอชำระ' : 'กำลังทาน';
  const stCls = t.status === 'busy' && t.checked ? 'checked' : t.status;
  $('mdTitle').innerHTML = `<button class="mback" id="mdBack" type="button" title="กลับ">${icon('back')}</button>
    ${icon('table', 'mtico')}<span class="mtt"><b>โต๊ะ ${esc(t.name)}</b><small class="mstat ${stCls}"><i></i>${stLabel}</small></span>
    ${t.status === 'busy' && S.settings.qr_pin === '1' && t.pin ? `<span class="mpin" title="ให้ลูกค้าใส่ตอนสั่งผ่าน QR">รหัสโต๊ะ <b>${esc(t.pin)}</b></span>` : ''}`;
  $('mdTools').innerHTML = (t.status === 'busy' ? `<button class="mtool" id="move" type="button">${icon('swap')}<span>ย้าย / รวมโต๊ะ</span></button>` : '')
    + `<button class="mtool close" id="mdClose" type="button">${icon('close')}<span>ปิด</span></button>`;
  $('mdClose').onclick = closeModal;
  $('mdBack').onclick = closeModal;
  if ($('move')) $('move').onclick = () => moveTable(t);
  const b = $('mdBody');

  if (t.status !== 'busy' && !draft) {
    const r = t.resv || { time: '', pax: 2 };
    b.innerHTML = `<div class="card openform">
      <h2>เปิดโต๊ะ</h2>
      <div class="row">
        <div><label>จำนวนลูกค้า (คน)</label><input id="oPax" type="number" min="1" inputmode="numeric" placeholder="เช่น 4" value="${esc(opening.pax)}"></div>
        ${isOwner() ? `<div><label>วัน-เวลาเปิดโต๊ะ <small class="muted">(เว้นว่าง = ตอนนี้)</small></label>${calField('oOpened', opening.opened, { time: true, empty: 'เวลาตอนนี้' })}</div>` : ''}
      </div>
      <div class="chips" role="radiogroup">
        <button class="chip ${opening.takeaway ? '' : 'on'}" data-ta="0" type="button">ทานที่ร้าน</button>
        <button class="chip ${opening.takeaway ? 'on' : ''}" data-ta="1" type="button">สั่งกลับบ้าน</button>
      </div>
      <div class="actions"><button class="btn brand" id="open">เปิดโต๊ะ / เริ่มสั่งอาหาร</button>
        <button class="btn ok" id="openQr" type="button">${icon('qr')}<span>เปิดให้ลูกค้าสแกนสั่ง</span></button></div>
    </div>
    <div class="card">
      <h2>${t.status === 'resv' ? 'ข้อมูลการจอง' : 'จองโต๊ะ'}</h2>
      <div class="row">
        <div><label>วัน-เวลา</label>${calField('rTime', resvTime || String(r.time || nowLocal()).replace(' ', 'T').slice(0, 16), { time: true, future: true })}</div>
        <div><label>จำนวนคน</label><input id="rPax" type="number" min="1" value="${esc(r.pax)}"></div>
      </div>
      <div class="actions">
        <button class="btn" id="rSave">${t.status === 'resv' ? 'บันทึกการจอง' : 'จองโต๊ะ'}</button>
        ${t.status === 'resv' ? '<button class="btn danger" id="rCancel">ยกเลิกการจอง</button>' : ''}
      </div></div>`;
    $('oPax').oninput = e => { opening.pax = e.target.value; };
    if ($('oOpened')) $('oOpened').oninput = e => { opening.opened = e.target.value; };
    b.querySelectorAll('[data-ta]').forEach(x => x.onclick = () => { opening.takeaway = x.dataset.ta === '1'; renderModal(); });
    $('rTime').oninput = e => { resvTime = e.target.value; };
    $('rSave').onclick = async () => {
      if (await act('resv_save', { table: t.id, time: $('rTime').value.replace('T', ' '), pax: Number($('rPax').value) })) closeModal();
    };
    if ($('rCancel')) $('rCancel').onclick = async () => { if (confirm('ยกเลิกการจอง?') && await act('resv_cancel', { table: t.id })) { closeModal(); toast(`ยกเลิกการจองโต๊ะ ${t.name} แล้ว`); } };
    // guests will order from the table QR: open the table right away (no dish needed)
    $('openQr').onclick = async () => {
      if (!(Number(opening.pax) >= 1)) { alert('ใส่จำนวนลูกค้า'); return $('oPax').focus(); }
      if (await act('open_qr', { table: t.id, ...dishExtra() })) {
        const nt = S.tables.find(x => x.id === t.id);
        toast(`เปิดโต๊ะ ${t.name} แล้ว — ลูกค้าสแกน QR บนโต๊ะสั่งได้เลย` + (S.settings.qr_pin === '1' && nt && nt.pin ? ` · รหัสโต๊ะ ${nt.pin}` : ''));
      }
    };
    $('open').onclick = () => {
      if (!(Number(opening.pax) >= 1)) { alert('ใส่จำนวนลูกค้า'); return $('oPax').focus(); }
      draft = true; renderModal();
    };
    return;
  }

  const list = S.menu.filter(m => !curCat || m.cat === curCat);
  const c = calc(t.order, t.discount);
  const pendingQty = t.order.reduce((a, i) => a + Math.max(0, i.qty - i.sent), 0);
  const has = t.order.length > 0;
  const ids = waitIds(), wait = hasWait(t, ids), billable = has && !wait;
  const itemsN = t.order.reduce((a, i) => a + i.qty, 0);
  const catOf = (id, name) => { const m = S.menu.find(x => x.id === id); return (m ? m.cat : '') + ' ' + name; };
  // menu photo when the dish has one, else a big category icon on a dark plate
  const thumb = (img, cat, cls) => img
    ? `<span class="${cls} photo"><img src="${esc(img)}" alt="" loading="lazy"></span>`
    : `<span class="${cls}">${icon(catIcon(cat))}</span>`;
  const MICON = { cash: 'bill', transfer: 'qr', other: 'dots', mixed: 'coins' };
  // guests / dine-in or takeaway: the table's own once open, the open form's while still a draft
  const g = t.status === 'busy' ? { pax: t.pax, takeaway: t.takeaway } : { pax: Number(opening.pax) || null, takeaway: opening.takeaway };
  const guests = [g.pax ? g.pax + ' คน' : '', g.takeaway ? 'สั่งกลับบ้าน' : 'ทานที่ร้าน'].filter(Boolean).join(' · ');
  b.innerHTML = `<div class="split osheet">
    <div class="mpane">
      <div class="msearch">
        <label class="sbox">${icon('search')}<input id="search" placeholder="ค้นหาเมนู..." autocomplete="off" value="${esc(curQ)}"></label>
        <button class="btn gold" id="qaToggle" type="button">${icon('plus')}<span>เมนูใหม่</span></button>
      </div>
      <div id="qa" class="qa hidden">
        <div class="row">
          <div><label>ชื่อเมนู</label><input id="qaName"></div>
          <div style="flex:0 1 100px"><label>ราคา</label><input id="qaPrice" type="number" min="0" step="0.01"></div>
          <div style="flex:0 1 130px"><label>หมวด</label><input id="qaCat" list="catList" value="${esc(curCat)}"></div>
        </div>
        <div class="actions"><button class="btn brand sm" id="qaOrder">บันทึก + สั่งเลย</button><button class="btn ghost sm" id="qaOnly">บันทึกเมนูอย่างเดียว</button></div>
      </div>
      <div class="ctiles">${['', ...cats()].map(k => `<button class="ctile ${k === curCat ? 'on' : ''}" data-cat="${esc(k)}" type="button">${icon(k ? catIcon(k) : 'cloche')}<span>${esc(k || 'ทั้งหมด')}</span></button>`).join('')}</div>
      <div class="menu-grid photo" id="mGrid">${list.map(m => `<button class="mi${m.out ? ' out' : ''}${curQ && !m.name.toLowerCase().includes(curQ) ? ' hidden' : ''}" data-add="${m.id}" data-n="${esc(m.name.toLowerCase())}" type="button" ${m.out ? 'disabled' : ''}>
          ${thumb(m.image, m.cat + ' ' + m.name, 'mimg')}
          <span class="mtext"><span class="mname">${esc(m.name)}</span><b>${m.out ? 'หมด' : '฿' + baht(m.price)}</b></span>
          <span class="madd">${icon('plus')}</span>
        </button>`).join('') || '<p class="mempty">ไม่มีเมนู</p>'}</div>
    </div>
    <div class="opane" id="orderCard">
      <section class="osec">
        <div class="osec-h">${icon('cart')}<span>รายการที่สั่ง</span><small>${esc([t.resv && t.resv.name, guests].filter(Boolean).join(' · '))}</small></div>
        ${isOwner() ? `<div class="ownat"><label>เวลาสั่ง <small class="muted">(เว้นว่าง = ตอนนี้)</small></label>${calField('orderAt', orderAt, { time: true, empty: 'เวลาตอนนี้' })}</div>` : ''}
        <div class="osec-b">
          ${t.order.map(i => `<div class="oi">
            ${thumb((S.menu.find(m => m.id === i.menuId) || {}).image, catOf(i.menuId, i.name), 'oimg')}
            <div class="oinfo">
              <div class="oname">${esc(i.name)}${i.guest ? '<span class="tag guest">ลูกค้าสั่ง</span>' : ''}${i.qty > i.sent ? `<span class="tag">ใหม่ ${i.qty - i.sent}</span>` : ''}${ids.has(i.menuId)
                ? `<span class="tag wait">รออนุมัติราคา</span>${can('menu') ? ` <button class="note" data-ok="${i.menuId}">อนุมัติ</button>` : ''}` : ''}</div>
              <div class="oprice">฿${baht(i.price)}</div>
              <button class="note" data-note="${i.id}">${icon('edit')}${i.note ? esc(i.note) : '+ หมายเหตุ'}</button>
            </div>
            <div class="oqty"><button data-q="${i.id}" data-d="-1" aria-label="ลด">${icon('minus')}</button><span>${i.qty}</span><button data-q="${i.id}" data-d="1" aria-label="เพิ่ม">${icon('plus')}</button></div>
            <b class="osum">฿${baht(i.price * i.qty)}</b>
          </div>`).join('') || '<p class="oempty">ยังไม่มีรายการ — กดเมนูเพื่อสั่ง</p>'}
          <div class="oacts">
            <button class="btn ok" id="kitchen" ${pendingQty ? '' : 'disabled'}>${icon('cloche')}<span>ส่งครัว (${pendingQty})</span></button>
            ${can('discount') ? `<button class="btn soft" id="disc" ${has ? '' : 'disabled'}>${icon('percent')}<span>${t.discount ? 'แก้ส่วนลด' : 'ส่วนลด'}</span></button>` : ''}
          </div>
          <div class="osubs">
            <div class="line"><span>รวมรายการ (${itemsN})</span><span>฿${baht(c.sub)}</span></div>
            ${c.disc ? `<div class="line"><span>ส่วนลด${t.discount.type === 'pct' ? ' ' + t.discount.value + '%' : ''}</span><span>-฿${baht(c.disc)}</span></div>` : ''}
            ${c.service ? `<div class="line"><span>Service ${S.settings.service}%</span><span>฿${baht(c.service)}</span></div>` : ''}
            ${c.vat ? `<div class="line"><span>VAT ${S.settings.vat}%</span><span>฿${baht(c.vat)}</span></div>` : ''}
          </div>
          ${wait ? `<p class="onote">มีเมนูใหม่รออนุมัติราคา — ${can('menu') ? 'กด "อนุมัติ" ที่รายการ' : 'ให้คนที่มีสิทธิ์แก้เมนูอนุมัติ'} ก่อนเช็คบิล/ชำระเงิน</p>` : ''}
          ${t.checked ? `<p class="onote">${sameTotal(t)
            ? `เช็คบิลแล้ว ${toDate(t.checked.at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} · รอชำระ`
            : `ยอดเปลี่ยนจากตอนเช็คบิล (฿${baht(t.checked.total)}) — กดเช็คบิลพิมพ์ใหม่`}</p>` : ''}
        </div>
      </section>

      <div class="ototal">${icon('coins')}<span>ยอดสุทธิ</span><b>฿${baht(c.total)}</b></div>

      <section class="osec">
        <div class="osec-h">${icon('wallet')}<span>ช่องทางการชำระเงิน</span></div>
        <div class="osec-b">
          ${isOwner() ? `<div class="ownat"><label>วัน-เวลาชำระ <small class="muted">(เว้นว่าง = ตอนนี้)</small></label>${calField('payAt', payAt, { time: true, empty: 'เวลาตอนนี้' })}</div>` : ''}
          <div class="ptiles">${[...PAY_METHODS, 'mixed'].map(k => `<button class="ptile ${k === payMethod ? 'on' : ''}" data-m="${k}" type="button">${icon(MICON[k])}<span>${METHODS[k]}</span></button>`).join('')}</div>
          ${payMethod === 'mixed' ? `<div class="row">
              <div><label>ยอดโอน (บาท)</label><input id="xfer" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0" value="${esc(xferIn)}"></div>
              <div><label>เงินสดที่ต้องรับ</label><input id="cashDue" readonly placeholder="0.00"></div></div>` : ''}
          ${payMethod === 'cash' || payMethod === 'mixed' ? `<div class="row">
              <div><label>รับเงิน (บาท)</label><input id="cash" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0" value="${esc(cashIn)}"></div>
              <div><label>เงินทอน</label><input id="change" readonly placeholder="0.00"></div></div>
            <div class="cashq">${[100, 500, 1000].map(n => `<button class="chip" data-cash="${n}" type="button">${n.toLocaleString('th-TH')}</button>`).join('')}<button class="chip exact" data-cash="${payMethod === 'cash' ? c.total : ''}" type="button">พอดี</button></div>` : ''}
          ${payMethod === 'mixed' && !mixQr ? `<button class="btn brand mixok" id="mixOk" type="button">ยืนยันยอด แล้วแสดง QR ให้ลูกค้าโอน</button>` : ''}
          ${payMethod === 'transfer' || (payMethod === 'mixed' && mixQr) ? payPanel(payMethod === 'mixed' ? r2(Number(xferIn) || 0) : c.total) : ''}
          ${has || t.status !== 'busy' ? '' : `<button class="voidrow" id="cancelOpen" type="button">${icon('close')}<span>ยกเลิกเปิดโต๊ะ</span>${icon('next')}</button>`}
          ${has && can('void') ? `<button class="voidrow" id="voidTable" type="button">${icon('receipt')}<span>ยกเลิกบิล / ปิดโต๊ะ (ไม่เก็บเงิน)</span>${icon('next')}</button>` : ''}
        </div>
      </section>

      <div class="paybar">
        <button class="btn ok lg" id="pay" ${billable && (payMethod !== 'mixed' || mixQr) ? '' : 'disabled'}>${icon('printer')}<span>ชำระเงิน + พิมพ์บิล · ฿${baht(c.total)}</span></button>
        <button class="btn ghost lg" id="payNoPrint" ${billable && (payMethod !== 'mixed' || mixQr) ? '' : 'disabled'}>${icon('check')}<span>ชำระ + ปิดโต๊ะ (ไม่พิมพ์บิล)</span></button>
        <button class="btn gold lg" id="preview" ${billable ? '' : 'disabled'}>${icon('printer')}<span>${t.checked ? 'เช็คบิล + พิมพ์อีกครั้ง' : 'เช็คบิล + พิมพ์'}</span></button>
      </div>
    </div></div>
    <button class="jump" id="jump" type="button">${icon('cart')}<span class="jl">ดูรายการ / ชำระเงิน (${itemsN})</span><b>฿${baht(c.total)}</b><span class="jgo">${icon('next')}</span></button>`;
  $('jump').onclick = () => $('orderCard').scrollIntoView({ behavior: 'smooth' });
  // phone: hide the floating "view order" bar once the order card (with its own floating pay bar) is on screen
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => $('jump') && $('jump').classList.toggle('off', e.isIntersecting), { threshold: 0 }).observe($('orderCard'));
  }

  b.querySelectorAll('[data-cat]').forEach(x => x.onclick = () => { curCat = x.dataset.cat; renderModal(); });
  b.querySelectorAll('[data-m]').forEach(x => x.onclick = () => { payMethod = x.dataset.m; mixQr = false; renderModal(); });
  if ($('mixOk')) $('mixOk').onclick = () => {
    const x = Number($('xfer').value) || 0;
    if (!(x > 0 && x < c.total)) return alert('ใส่ยอดโอนมากกว่า 0 และน้อยกว่ายอดสุทธิ (ถ้าโอนทั้งหมด เลือก "โอน")');
    xferIn = $('xfer').value; mixQr = true; renderModal();
  };
  if ($('slipBtn')) $('slipBtn').onclick = async () => {
    const f = await pickFile('image/*'); if (!f) return;
    try { slip = await shrinkImage(f, 1000); renderModal(); } catch { alert('เปิดรูปนี้ไม่ได้'); }
  };
  if ($('slipDel')) $('slipDel').onclick = () => { slip = ''; renderModal(); };
  b.querySelectorAll('[data-add]').forEach(x => x.onclick = () => act('item_add', { table: t.id, menu: Number(x.dataset.add), ...dishExtra() }));
  if ($('orderAt')) $('orderAt').oninput = e => { orderAt = e.target.value; };
  if ($('payAt')) $('payAt').oninput = e => { payAt = e.target.value; };
  b.querySelectorAll('[data-q]').forEach(x => x.onclick = () => {
    const i = t.order.find(o => o.id == x.dataset.q), d = Number(x.dataset.d);
    if (d < 0 && i.qty <= i.sent && !confirm(`"${i.name}" ส่งครัวไปแล้ว ยืนยันลด?`)) return;
    act('item_qty', { item: i.id, delta: d });
  });
  b.querySelectorAll('[data-ok]').forEach(x => x.onclick = () => approveDish(Number(x.dataset.ok)));
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
      if (S.menu.some(m => m.name === name)) return alert(`มีเมนู "${name}" อยู่แล้ว — กดสั่งจากรายการเมนู`);
      act(order ? 'menu_add_order' : 'menu_save', order ? { table: t.id, ...body, ...dishExtra() } : body)
        .then(d => d && toast((order ? `สั่ง "${name}" ฿${baht(body.price)} แล้ว` : `เพิ่มเมนู "${name}" แล้ว`) + (can('menu') ? '' : ' · รออนุมัติราคา')));
    };
    $('qaOrder').onclick = () => qaSave(true);
    $('qaOnly').onclick = () => qaSave(false);
    $('qaPrice').onkeydown = e => { if (e.key === 'Enter') qaSave(true); };
  }
  $('search').oninput = e => {
    const q = curQ = e.target.value.trim().toLowerCase();
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
  // cash still owed: the whole bill, or for mixed what's left after the transfer
  const cashDue = () => payMethod === 'mixed' ? r2(c.total - (Number($('xfer').value) || 0)) : c.total;
  if ($('cash')) {
    const upd = () => {
      cashIn = $('cash').value;
      if ($('xfer')) { xferIn = $('xfer').value; $('cashDue').value = xferIn ? (cashDue() > 0 ? baht(cashDue()) : 'ยอดโอนเกิน') : ''; }
      const v = Number(cashIn), due = cashDue();
      $('change').value = cashIn ? (v >= due ? baht(v - due) : 'เงินไม่พอ') : '';
    };
    $('cash').oninput = upd;
    if ($('xfer')) $('xfer').oninput = () => { if (mixQr) { mixQr = false; xferIn = $('xfer').value; return renderModal(); } upd(); };
    b.querySelectorAll('[data-cash]').forEach(x => x.onclick = () => { $('cash').value = x.dataset.cash || Math.max(0, cashDue()); upd(); });
    upd();
  }
  $('preview').onclick = async () => {
    if (pendingQty && !confirm('มีรายการยังไม่ส่งครัว — เช็คบิลต่อเลย?')) return;
    // a failure may mean another device changed the order: reload so the screen shows the new total
    if (!await act('check_bill', { table: t.id, expect: c.total })) return act('state');
    toast(`เช็คบิลโต๊ะ ${t.name} ฿${baht(c.total)}`);
    printBill({ no: null, table: t.name, date: new Date(), items: t.order, ...c,
    servicePct: S.settings.service, vatPct: S.settings.vat, cash: null }, true);
  };
  const pay = async print => {
    const cash = $('cash') && $('cash').value ? Number($('cash').value) : null;
    const transfer = payMethod === 'mixed' ? Number($('xfer').value) || 0 : null;
    if (transfer !== null && !(transfer > 0 && transfer < c.total)) return alert('ใส่ยอดโอนมากกว่า 0 และน้อยกว่ายอดสุทธิ (ถ้าโอนทั้งหมด เลือก "โอน")');
    if (cash !== null && cash < cashDue()) return alert('รับเงินไม่พอ');
    if (pendingQty && !confirm('มีรายการยังไม่ส่งครัว — ชำระต่อเลย?')) return;
    if (!confirm(`ยืนยันชำระ ${transfer !== null ? `เงินสด ฿${baht(cashDue())} + โอน ฿${baht(transfer)} รวม` : METHODS[payMethod]} ฿${baht(c.total)}${payAt ? ' ลงวันที่ ' + payAt.replace('T', ' ') : ''} และปิดโต๊ะ?`)) return;
    const d = await act('pay', { table: t.id, method: payMethod, cash, transfer, expect: c.total, date: isOwner() ? payAt : '', slip: payMethod === 'cash' ? '' : slip });
    if (d) { closeModal(); toast(`ชำระเงินแล้ว · ปิดโต๊ะ ${t.name}`); if (print) printBill(d.bill); } else act('state');
  };
  $('pay').onclick = () => pay(true);
  $('payNoPrint').onclick = () => pay(false);
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

// what the customer scans to pay `amount`: PromptPay with the amount filled in when the shop set a number, otherwise the
// shop's own QR picture; the account below it; then an optional photo of their slip
function payPanel(amount) {
  const st = S.settings, img = (S.files || []).find(f => f.k === 'shop_qr');
  const pp = st.promptpay ? qrSvg(amount) : '';
  const acct = [st.bank_name, st.bank_acct, st.bank_owner].filter(Boolean).map(esc).join(' · ');
  return `<div class="paypanel">
    <div class="pp-amt">ให้ลูกค้าโอน <b>฿${baht(amount)}</b></div>
    ${pp ? `<div class="qr">${pp}<div class="muted">พร้อมเพย์ ${esc(st.promptpay)}</div></div>`
      : img ? `<div class="qr"><img src="${esc(img.url)}" alt="QR ร้าน" class="shopqr-img"></div>`
      : '<p class="muted">ยังไม่มี QR ร้าน — ตั้งเบอร์พร้อมเพย์ หรืออัปโหลดรูป QR ในแท็บ "ตั้งค่า"</p>'}
    ${acct ? `<div class="pp-acct">${acct}</div>` : ''}
    <div class="pp-slip">${slip ? `<img src="${slip}" alt="สลิป"><span>แนบสลิปแล้ว</span><button class="btn ghost sm" id="slipDel" type="button">ลบ</button>`
      : `<button class="btn soft" id="slipBtn" type="button">📷 ถ่ายรูปสลิป (ไม่บังคับ)</button>`}</div>
  </div>`;
}
