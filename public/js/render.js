/* ---------- render ---------- */
const cats = () => [...new Set(S.menu.map(m => m.cat).filter(Boolean))];
function render() {
  if (!ME) return;
  $('shopTitle').textContent = $('loginTitle').textContent = S.settings.name || 'โคขุน';
  $('meName').innerHTML = `${esc(ME.name)} <span class="role">${isOwner() ? 'เจ้าของร้าน' : 'พนักงาน'}</span>`;
  document.querySelectorAll('[data-perm]').forEach(el => el.classList.toggle('hidden', !canAny(el.dataset.perm)));
  $('catList').innerHTML = cats().map(c => `<option value="${esc(c)}">`).join('');
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
  $('tableGrid').innerHTML = S.tables.map(t => {
    let st = 'ว่าง', info = '';
    if (t.status === 'resv') { st = 'จองแล้ว'; info = [t.resv.name, t.resv.time, t.resv.pax + ' คน'].filter(Boolean).map(esc).join(' · '); }
    if (t.status === 'busy') {
      const mins = Math.max(0, Math.floor((Date.now() - toDate(t.openedAt)) / 60000));
      st = t.checked ? (sameTotal(t) ? 'เช็คบิลแล้ว · รอชำระ' : 'ยอดเปลี่ยนหลังเช็คบิล')
        : 'มีลูกค้า' + (t.order.some(i => i.qty > i.sent) ? ' · ยังไม่ส่งครัว' : '');
      info = `${t.order.reduce((a, i) => a + i.qty, 0)} รายการ · ฿${baht(calc(t.order, t.discount).total)} · ${mins} นาที`;
    }
    return `<button class="tbl ${t.status}${t.checked ? ' checked' : ''}" data-id="${t.id}"><b>โต๊ะ ${esc(t.name)}</b><span class="st">${st}</span><small>${info}</small></button>`;
  }).join('');
  $('tableGrid').querySelectorAll('.tbl').forEach(el => el.onclick = () => openTable(Number(el.dataset.id)));
}

// has the bill changed since it was printed for the customer?
const sameTotal = t => Math.abs(calc(t.order, t.discount).total - t.checked.total) < 0.005;

function renderMenu() {
  const q = $('menuSearch').value.trim().toLowerCase();
  $('menuCount').textContent = `· ${S.menu.length} รายการ`;
  $('menuBody').innerHTML = S.menu.filter(m => !q || (m.name + m.cat).toLowerCase().includes(q)).map(m => `<tr>
    <td>${esc(m.name)}</td><td class="muted">${esc(m.cat)}</td><td class="num">${baht(m.price)}</td>
    <td><button class="btn sm ${m.out ? 'danger' : 'ghost'}" data-out="${m.id}">${m.out ? 'หมด' : 'มีขาย'}</button></td>
    <td class="num">${can('menu') ? `<button class="btn ghost sm" data-edit="${m.id}">แก้ไข</button> <button class="btn ghost sm" data-del="${m.id}">ลบ</button>` : ''}</td></tr>`).join('')
    || '<tr><td colspan="5" class="muted">ไม่พบเมนู</td></tr>';
  $('menuBody').querySelectorAll('[data-out]').forEach(b => b.onclick = () => act('menu_out', { id: Number(b.dataset.out) }));
  $('menuBody').querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
    const m = S.menu.find(x => x.id == b.dataset.edit);
    $('mId').value = m.id; $('mName').value = m.name; $('mPrice').value = m.price; $('mCat').value = m.cat;
    $('menuFormTitle').textContent = 'แก้ไขเมนู'; $('mName').focus(); scrollTo(0, 0);
  });
  $('menuBody').querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    if (confirm('ลบเมนูนี้?')) act('menu_del', { id: Number(b.dataset.del) }).then(d => d && toast('ลบเมนูแล้ว'));
  });
}
function resetMenuForm() { $('menuForm').reset(); $('mId').value = ''; $('menuFormTitle').textContent = 'เพิ่มเมนู'; }
$('menuForm').onsubmit = async e => {
  e.preventDefault();
  if (await act('menu_save', { id: Number($('mId').value) || null, name: $('mName').value, price: Number($('mPrice').value), cat: $('mCat').value })) {
    resetMenuForm(); $('mName').focus();
  }
};
$('mCancel').onclick = resetMenuForm;
$('menuSearch').oninput = renderMenu;
$('bulkBtn').onclick = () => $('bulkBox').classList.toggle('hidden');
$('bulkSave').onclick = async () => {
  const bad = [], items = [];
  $('bulkText').value.split('\n').map(l => l.trim()).filter(Boolean).forEach(l => {
    const m = l.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*(.*)$/);
    if (m) items.push({ name: m[1].trim(), price: Number(m[2]), cat: m[3].trim() }); else bad.push(l);
  });
  if (!items.length) return alert('ไม่พบรายการ — รูปแบบ: ชื่อ ราคา หมวด');
  const d = await act('menu_bulk', { items });
  if (!d) return;
  $('bulkText').value = bad.join('\n');
  alert(`เพิ่มแล้ว ${d.added} รายการ` + (items.length > d.added ? ` (ข้ามชื่อซ้ำ ${items.length - d.added})` : '') + (bad.length ? `\nอ่านไม่ได้ ${bad.length} บรรทัด (เหลือในกล่อง)` : ''));
};
