/* ---------- table modal ---------- */
// cashIn survives re-renders, so another device's change doesn't wipe the amount the cashier typed
// resvTime likewise keeps a picked booking time across the 3-second sync re-render
// curQ keeps the menu search across the re-render that follows each tap on a dish
// draft: the order sheet is showing for a table that isn't open yet; the first dish opens it on the server
let cur = null, curCat = '', curQ = '', payMethod = 'cash', cashIn = '', resvTime = '', draft = false;
// datetime-local wants local time; toISOString() alone is UTC, 7 hours behind in Bangkok
const nowLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
function openTable(id, asDraft) { cur = id; draft = !!asDraft; curCat = ''; curQ = ''; payMethod = 'cash'; cashIn = ''; resvTime = ''; $('modal').classList.remove('hidden'); renderModal(); }
function closeModal() {
  // leaving an open table with nothing ordered frees it again; quiet, since another device may have just added a dish
  const t = S.tables.find(x => x.id === cur);
  if (t && t.status === 'busy' && !t.order.length) fetch('api.php?a=cancel_open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ table: t.id }) })
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
    ${icon('table', 'mtico')}<span class="mtt"><b>โต๊ะ ${esc(t.name)}</b><small class="mstat ${stCls}"><i></i>${stLabel}</small></span>`;
  $('mdTools').innerHTML = (t.status === 'busy' ? `<button class="mtool" id="move" type="button">${icon('swap')}<span>ย้าย / รวมโต๊ะ</span></button>` : '')
    + `<button class="mtool close" id="mdClose" type="button">${icon('close')}<span>ปิด</span></button>`;
  $('mdClose').onclick = closeModal;
  $('mdBack').onclick = closeModal;
  if ($('move')) $('move').onclick = () => moveTable(t);
  const b = $('mdBody');

  if (t.status !== 'busy' && !draft) {
    const r = t.resv || { time: '', pax: 2 };
    b.innerHTML = `<div class="card">
      <h2>${t.status === 'resv' ? 'ข้อมูลการจอง' : 'จองโต๊ะ'}</h2>
      <div class="row">
        <div><label>วัน-เวลา</label><input id="rTime" type="datetime-local" value="${esc(resvTime || String(r.time || nowLocal()).replace(' ', 'T'))}"></div>
        <div><label>จำนวนคน</label><input id="rPax" type="number" min="1" value="${esc(r.pax)}"></div>
      </div>
      <div class="actions">
        <button class="btn" id="rSave">${t.status === 'resv' ? 'บันทึกการจอง' : 'จองโต๊ะ'}</button>
        ${t.status === 'resv' ? '<button class="btn danger" id="rCancel">ยกเลิกการจอง</button>' : ''}
        <button class="btn brand" id="open">เปิดโต๊ะ / เริ่มสั่งอาหาร</button>
      </div></div>`;
    $('rTime').oninput = e => { resvTime = e.target.value; };
    $('rSave').onclick = async () => {
      if (await act('resv_save', { table: t.id, time: $('rTime').value.replace('T', ' '), pax: Number($('rPax').value) })) closeModal();
    };
    if ($('rCancel')) $('rCancel').onclick = async () => { if (confirm('ยกเลิกการจอง?') && await act('resv_cancel', { table: t.id })) { closeModal(); toast(`ยกเลิกการจองโต๊ะ ${t.name} แล้ว`); } };
    $('open').onclick = () => { draft = true; renderModal(); };
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
  const MICON = { cash: 'bill', transfer: 'qr', other: 'dots' };
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
        <div class="osec-h">${icon('cart')}<span>รายการที่สั่ง</span>${t.resv && t.resv.name ? `<small>${esc(t.resv.name)}</small>` : ''}</div>
        <div class="osec-b">
          ${t.order.map(i => `<div class="oi">
            ${thumb(null, catOf(i.menuId, i.name), 'oimg')}
            <div class="oinfo">
              <div class="oname">${esc(i.name)}${i.qty > i.sent ? `<span class="tag">ใหม่ ${i.qty - i.sent}</span>` : ''}${ids.has(i.menuId)
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
          <div class="ptiles">${PAY_METHODS.map(k => `<button class="ptile ${k === payMethod ? 'on' : ''}" data-m="${k}" type="button">${icon(MICON[k])}<span>${METHODS[k]}</span></button>`).join('')}</div>
          ${payMethod === 'cash' ? `<div class="row">
              <div><label>รับเงิน (บาท)</label><input id="cash" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0" value="${esc(cashIn)}"></div>
              <div><label>เงินทอน</label><input id="change" readonly placeholder="0.00"></div></div>
            <div class="cashq">${[100, 500, 1000].map(n => `<button class="chip" data-cash="${n}" type="button">${n.toLocaleString('th-TH')}</button>`).join('')}<button class="chip exact" data-cash="${c.total}" type="button">พอดี</button></div>` : ''}
          ${payMethod === 'transfer' ? (S.settings.promptpay ? `<div class="qr">${qrSvg(c.total) || '<p class="muted">สร้าง QR ไม่ได้ (ต้องต่ออินเทอร์เน็ต)</p>'}<div class="muted">พร้อมเพย์ ${esc(S.settings.promptpay)} · ฿${baht(c.total)}</div></div>` : '<p class="muted">โอนเข้าบัญชีร้าน · ตั้งเบอร์พร้อมเพย์ในแท็บ "ตั้งค่า" เพื่อให้ขึ้น QR ให้ลูกค้าสแกน</p>') : ''}
          ${has || t.status !== 'busy' ? '' : `<button class="voidrow" id="cancelOpen" type="button">${icon('close')}<span>ยกเลิกเปิดโต๊ะ</span>${icon('next')}</button>`}
          ${has && can('void') ? `<button class="voidrow" id="voidTable" type="button">${icon('receipt')}<span>ยกเลิกบิล / ปิดโต๊ะ (ไม่เก็บเงิน)</span>${icon('next')}</button>` : ''}
        </div>
      </section>

      <div class="paybar">
        <button class="btn ok lg" id="pay" ${billable ? '' : 'disabled'}>${icon('printer')}<span>ชำระเงิน + พิมพ์บิล · ฿${baht(c.total)}</span></button>
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
  b.querySelectorAll('[data-m]').forEach(x => x.onclick = () => { payMethod = x.dataset.m; renderModal(); });
  b.querySelectorAll('[data-add]').forEach(x => x.onclick = () => act('item_add', { table: t.id, menu: Number(x.dataset.add) }));
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
      act(order ? 'menu_add_order' : 'menu_save', order ? { table: t.id, ...body } : body)
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
    // a failure may mean another device changed the order: reload so the screen shows the new total
    if (!await act('check_bill', { table: t.id, expect: c.total })) return act('state');
    toast(`เช็คบิลโต๊ะ ${t.name} ฿${baht(c.total)}`);
    printBill({ no: null, table: t.name, date: new Date(), items: t.order, ...c,
    servicePct: S.settings.service, vatPct: S.settings.vat, cash: null }, true);
  };
  $('pay').onclick = async () => {
    const cash = $('cash') && $('cash').value ? Number($('cash').value) : null;
    if (cash !== null && cash < c.total) return alert('รับเงินไม่พอ');
    if (pendingQty && !confirm('มีรายการยังไม่ส่งครัว — ชำระต่อเลย?')) return;
    if (!confirm(`ยืนยันชำระ ${METHODS[payMethod]} ฿${baht(c.total)} และปิดโต๊ะ?`)) return;
    const d = await act('pay', { table: t.id, method: payMethod, cash, expect: c.total });
    if (d) { closeModal(); toast(`ชำระเงินแล้ว · ปิดโต๊ะ ${t.name}`); printBill(d.bill); } else act('state');
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
