/* ---------- render ---------- */
const cats = () => [...new Set(S.menu.map(m => m.cat).filter(Boolean))];
// dishes added by staff whose price someone with "menu" still has to approve; the table can't be billed until then
const waitIds = () => new Set(S.menu.filter(m => m.pending).map(m => m.id));
const hasWait = (t, ids = waitIds()) => t.order.some(i => ids.has(i.menuId));
function render() {
  if (!ME) return;
  $('shopTitle').textContent = $('loginTitle').textContent = S.settings.name || 'โคขุน';
  $('meName').innerHTML = `${esc(ME.name)} <span class="role">${isOwner() ? 'เจ้าของร้าน' : 'พนักงาน'}</span>`;
  document.querySelectorAll('[data-perm]').forEach(el => el.classList.toggle('hidden', !canAny(el.dataset.perm)));
  $('catList').innerHTML = cats().map(c => `<option value="${esc(c)}">`).join('');
  const waitN = S.menu.filter(m => m.pending).length;
  document.querySelector('nav [data-tab="menu"]').innerHTML = 'เมนูอาหาร' + (waitN && can('menu') ? `<span class="navbadge" title="รออนุมัติราคา">${waitN}</span>` : '');
  renderTables(); renderMenu();
  if (can('settings')) renderSettings();
}

function renderTables() {
  const busy = S.tables.filter(t => t.status === 'busy');
  $('liveStats').innerHTML = `
    <div class="stat"><span class="muted">โต๊ะว่าง</span><b>${S.tables.filter(t => t.status === 'free').length} / ${S.tables.length}</b></div>
    <div class="stat"><span class="muted">กำลังทาน</span><b>${busy.length} โต๊ะ</b></div>
    <div class="stat"><span class="muted">จองไว้</span><b>${S.tables.filter(t => t.status === 'resv').length} โต๊ะ</b></div>
    <div class="stat"><span class="muted">ยอดค้างชำระ</span><b>฿${baht(busy.reduce((a, t) => a + calc(t.order, t.discount).total, 0))}</b></div>`;
  const ids = waitIds();
  $('tableGrid').innerHTML = S.tables.map(t => {
    let st = 'ว่าง', info = '';
    const wait = t.status === 'busy' && hasWait(t, ids);
    if (t.status === 'resv') { st = 'จองแล้ว'; info = [t.resv.name, t.resv.time, t.resv.pax + ' คน'].filter(Boolean).map(esc).join(' · '); }
    if (t.status === 'busy') {
      const mins = Math.max(0, Math.floor((Date.now() - toDate(t.openedAt)) / 60000));
      st = wait ? 'รออนุมัติราคาเมนูใหม่'
        : t.checked ? (sameTotal(t) ? 'เช็คบิลแล้ว · รอชำระ' : 'ยอดเปลี่ยนหลังเช็คบิล')
        : 'มีลูกค้า' + (t.order.some(i => i.qty > i.sent) ? ' · ยังไม่ส่งครัว' : '');
      info = `${t.order.reduce((a, i) => a + i.qty, 0)} รายการ · ฿${baht(calc(t.order, t.discount).total)} · ${mins} นาที`;
    }
    return `<button class="tbl ${t.status}${t.checked ? ' checked' : ''}${wait ? ' wait' : ''}" data-id="${t.id}"><b>โต๊ะ ${esc(t.name)}</b><span class="st">${st}</span><small>${info}</small></button>`;
  }).join('');
  $('tableGrid').querySelectorAll('.tbl').forEach(el => el.onclick = () => openTable(Number(el.dataset.id)));
}

// has the bill changed since it was printed for the customer?
const sameTotal = t => Math.abs(calc(t.order, t.discount).total - t.checked.total) < 0.005;

let menuCat = '';
function renderMenu() {
  const q = $('menuSearch').value.trim().toLowerCase(), outOnly = $('menuOutOnly').checked, edit = Number($('mId').value);
  const all = cats();
  if (menuCat && !all.includes(menuCat)) menuCat = '';
  $('menuCats').innerHTML = ['', ...all].map(k => `<button class="chip ${k === menuCat ? 'on' : ''}" data-mcat="${esc(k)}">${esc(k || 'ทั้งหมด')}</button>`).join('');
  $('menuCats').querySelectorAll('[data-mcat]').forEach(x => x.onclick = () => { menuCat = x.dataset.mcat; renderMenu(); });
  const list = S.menu.filter(m => (!menuCat || m.cat === menuCat) && (!outOnly || m.out)
    && (!q || m.name.toLowerCase().includes(q) || m.cat.toLowerCase().includes(q)));
  const outN = S.menu.filter(m => m.out).length;
  $('menuCount').textContent = `แสดง ${list.length} จาก ${S.menu.length} รายการ` + (outN ? ` · หมด ${outN}` : '');
  // group by category in the order categories first appear; uncategorised last
  // dishes waiting for price approval come first, in their own group
  const WAIT = '\u0000wait', groups = new Map([[WAIT, []]]);
  [...all, ''].forEach(k => groups.set(k, []));
  list.forEach(m => groups.get(m.pending ? WAIT : m.cat).push(m));
  const editable = can('menu');
  $('menuClear').classList.toggle('hidden', !isOwner() || !S.menu.length);
  $('menuList').innerHTML = [...groups].filter(([, ms]) => ms.length).map(([k, ms]) => `
    <div class="mgroup">${k === WAIT ? 'รออนุมัติราคา' + (editable ? '' : ' (ให้คนที่มีสิทธิ์แก้เมนูอนุมัติ)') : esc(k || 'ไม่มีหมวด')} <span class="muted">${ms.length}</span></div>
    ${ms.map(m => `<div class="mrow${m.out ? ' out' : ''}${m.id === edit ? ' editing' : ''}${m.pending ? ' wait' : ''}">
      <div class="mname">${esc(m.name)}${m.pending ? `<span class="tag wait">รออนุมัติ</span><div class="muted">${esc(m.cat || 'ไม่มีหมวด')}${m.by ? ' · เพิ่มโดย ' + esc(m.by) : ''}</div>` : ''}</div>
      <div class="mprice">฿${baht(m.price)}</div>
      <button class="stock${m.out ? ' off' : ''}" data-out="${m.id}" aria-pressed="${m.out}">${m.out ? 'หมด' : 'มีขาย'}</button>
      ${!editable ? '' : m.pending
        ? `<div class="mact"><button class="btn brand sm" data-ok="${m.id}">อนุมัติ</button><button class="btn ghost sm" data-no="${m.id}">ไม่อนุมัติ</button></div>`
        : `<div class="mact"><button class="btn ghost sm" data-edit="${m.id}">แก้ไข</button><button class="btn danger sm" data-del="${m.id}">ลบ</button></div>`}
    </div>`).join('')}`).join('')
    || `<p class="muted">${S.menu.length ? 'ไม่พบเมนูที่ค้นหา' : 'ยังไม่มีเมนู — เพิ่มด้านบน'}</p>`;
  $('menuList').querySelectorAll('[data-ok]').forEach(b => b.onclick = () => approveDish(Number(b.dataset.ok)));
  $('menuList').querySelectorAll('[data-no]').forEach(b => b.onclick = () => rejectDish(Number(b.dataset.no)));
  $('menuList').querySelectorAll('[data-out]').forEach(b => b.onclick = async () => {
    const m = S.menu.find(x => x.id == b.dataset.out);
    if (await act('menu_out', { id: m.id })) toast(`${m.name}: ${m.out ? 'มีขายแล้ว' : 'หมดแล้ว'}`);
  });
  $('menuList').querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
    const m = S.menu.find(x => x.id == b.dataset.edit);
    $('mId').value = m.id; $('mName').value = m.name; $('mPrice').value = m.price; $('mCat').value = m.cat;
    $('menuFormTitle').textContent = 'แก้ไข: ' + m.name; $('mSubmit').textContent = 'บันทึกการแก้ไข'; $('mCancel').textContent = 'ยกเลิกแก้ไข';
    $('menuFormCard').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('mName').focus({ preventScroll: true });
    renderMenu();
  });
  $('menuList').querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    const m = S.menu.find(x => x.id == b.dataset.del);
    if (!confirm(`ลบเมนู "${m.name}"?\nบิลเก่าที่มีเมนูนี้ไม่เปลี่ยน`)) return;
    if (await act('menu_del', { id: m.id })) { if (Number($('mId').value) === m.id) resetMenuForm(); toast(`ลบ "${m.name}" แล้ว`); }
  });
}
// approve at the asked price or a corrected one; open orders with the dish follow the approved price
async function approveDish(id) {
  const m = S.menu.find(x => x.id === id); if (!m) return;
  const v = prompt(`อนุมัติราคา "${m.name}"${m.by ? ` (เพิ่มโดย ${m.by})` : ''}\nแก้ราคาได้ถ้าไม่ถูก — โต๊ะที่สั่งไปแล้วจะใช้ราคานี้`, m.price);
  if (v === null) return;
  const price = Number(v);
  if (v.trim() === '' || !(price >= 0)) return alert('ราคาไม่ถูกต้อง');
  if (await act('menu_approve', { id, price })) toast(`อนุมัติ "${m.name}" ฿${baht(price)} แล้ว`);
}
async function rejectDish(id) {
  const m = S.menu.find(x => x.id === id); if (!m) return;
  const n = S.tables.reduce((a, t) => a + t.order.filter(i => i.menuId === id).reduce((s, i) => s + i.qty, 0), 0);
  if (!confirm(`ไม่อนุมัติ "${m.name}"?\nเมนูนี้จะถูกลบ${n ? ` และเอาออกจากโต๊ะที่สั่งไว้ ${n} จาน` : ''}`)) return;
  const d = await act('menu_reject', { id });
  if (d) toast(`ไม่อนุมัติ "${m.name}"` + (d.removed ? ` · เอาออกจากโต๊ะแล้ว` : ''));
}
function resetMenuForm() {
  $('menuForm').reset(); $('mId').value = '';
  $('menuFormTitle').textContent = 'เพิ่มเมนู'; $('mSubmit').textContent = 'เพิ่มเมนู'; $('mCancel').textContent = 'ล้าง';
  renderMenu();
}
$('menuForm').onsubmit = async e => {
  e.preventDefault();
  const id = Number($('mId').value) || null, name = $('mName').value.trim(), cat = $('mCat').value.trim();
  if (!name) return alert('ใส่ชื่อเมนู');
  if (S.menu.some(m => m.name === name && m.id !== id)) return alert(`มีเมนู "${name}" อยู่แล้ว`);
  if (await act('menu_save', { id, name, price: Number($('mPrice').value), cat })) {
    toast(id ? `บันทึก "${name}" แล้ว` : can('menu') ? `เพิ่ม "${name}" แล้ว` : `เพิ่ม "${name}" แล้ว · รอคนที่มีสิทธิ์แก้เมนูอนุมัติราคา`);
    resetMenuForm(); if (!id) $('mName').focus();
  }
};
$('mCancel').onclick = resetMenuForm;
$('menuSearch').oninput = renderMenu;
$('menuOutOnly').onchange = renderMenu;
$('menuClear').onclick = async () => {
  const n = S.menu.length;
  if (prompt(`ลบเมนูทั้งหมด ${n} รายการ?\nบิลเก่าและโต๊ะที่เปิดอยู่ไม่เปลี่ยน\nพิมพ์คำว่า ลบ เพื่อยืนยัน`) !== 'ลบ') return;
  const d = await act('menu_clear', {});
  if (d) { resetMenuForm(); toast(`ลบเมนูแล้ว ${d.cleared} รายการ`); }
};
$('bulkBtn').onclick = () => { $('bulkBox').classList.toggle('hidden'); if (!$('bulkBox').classList.contains('hidden')) $('bulkText').focus(); };
// "name price cat": the LAST number is the price, so names may contain numbers ("เบียร์ 2 ขวด 150")
function parseMenuLine(l) {
  const w = l.split(/\s+/);
  // manual loop: Array.findLastIndex is missing on older shop tablets (iOS < 15.4)
  let i = w.length - 1;
  while (i >= 0 && !/^\d+(\.\d+)?$/.test(w[i].replace(/,/g, ''))) i--;
  if (i < 1) return null;
  return { name: w.slice(0, i).join(' '), price: Number(w[i].replace(/,/g, '')), cat: w.slice(i + 1).join(' ') };
}
$('bulkSave').onclick = async () => {
  const bad = [], items = [];
  $('bulkText').value.split('\n').map(l => l.trim()).filter(Boolean).forEach(l => { const m = parseMenuLine(l); if (m) items.push(m); else bad.push(l); });
  if (!items.length) return alert('ไม่พบรายการ — รูปแบบ: ชื่อ ราคา หมวด');
  const d = await act('menu_bulk', { items });
  if (!d) return;
  $('bulkText').value = bad.join('\n');
  toast(`เพิ่มแล้ว ${d.added} รายการ`);
  if (items.length > d.added || bad.length) alert(`เพิ่มแล้ว ${d.added} รายการ` + (items.length > d.added ? ` (ข้ามชื่อซ้ำ/ราคาผิด ${items.length - d.added})` : '') + (bad.length ? `\nอ่านไม่ได้ ${bad.length} บรรทัด (เหลือในกล่อง)` : ''));
};
