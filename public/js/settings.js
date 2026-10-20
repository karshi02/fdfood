/* ---------- settings (admin) ---------- */
function renderSettings() {
  const s = S.settings;
  // don't overwrite a form the admin is editing when another device saves
  if (!$('tab-settings').contains(document.activeElement)) {
    $('sName').value = s.name; $('sAddr').value = s.addr; $('sPhone').value = s.phone;
    $('sService').value = s.service; $('sVat').value = s.vat; $('sPP').value = s.promptpay; $('sFooter').value = s.footer;
  }
  $('tblBody').innerHTML = S.tables.map(t => `<tr><td>โต๊ะ ${esc(t.name)}</td><td class="num">
    <button class="btn ghost sm" data-tdel="${t.id}" ${t.status !== 'free' ? 'disabled title="โต๊ะไม่ว่าง"' : ''}>ลบ</button></td></tr>`).join('');
  $('tblBody').querySelectorAll('[data-tdel]').forEach(b => b.onclick = () => { if (confirm('ลบโต๊ะนี้?')) act('table_del', { id: Number(b.dataset.tdel) }).then(d => d && toast('ลบโต๊ะแล้ว')); });
}
$('sSave').onclick = async () => {
  const pp = $('sPP').value.trim();
  if (pp && !promptpayPayload(pp)) return alert('พร้อมเพย์ต้องเป็นเบอร์มือถือ 10 หลัก หรือเลขบัตร 13 หลัก');
  if (await act('settings_save', { name: $('sName').value, addr: $('sAddr').value, phone: $('sPhone').value,
    service: String(Number($('sService').value) || 0), vat: String(Number($('sVat').value) || 0), promptpay: pp, footer: $('sFooter').value })) alert('บันทึกแล้ว');
};
$('tAdd').onclick = async () => {
  const name = $('tName').value.trim(); if (!name) return;
  if (await act('table_add', { name })) $('tName').value = '';
};

let users = [];
async function loadUsers() {
  const d = await act('users'); if (!d) return;
  users = d.users;
  $('userBody').innerHTML = users.map(u => `<tr><td>${esc(u.name)} <span class="muted">@${esc(u.username)}</span></td>
    <td>${u.role === 'admin' ? 'เจ้าของร้าน/แอดมิน' : 'พนักงาน'}</td>
    <td class="num"><button class="btn ghost sm" data-uedit="${u.id}">แก้ไข</button>
    ${u.id !== ME.id ? `<button class="btn ghost sm" data-udel="${u.id}">ลบ</button>` : ''}</td></tr>`).join('');
  $('userBody').querySelectorAll('[data-uedit]').forEach(b => b.onclick = () => {
    const u = users.find(x => x.id == b.dataset.uedit);
    $('uId').value = u.id; $('uUser').value = u.username; $('uName').value = u.name; $('uRole').value = u.role; $('uPass').value = '';
    $('uPassLabel').textContent = 'รหัสผ่านใหม่ (เว้นว่าง = ไม่เปลี่ยน)';
  });
  $('userBody').querySelectorAll('[data-udel]').forEach(b => b.onclick = async () => {
    if (confirm('ลบผู้ใช้นี้?') && await act('user_del', { id: Number(b.dataset.udel) })) { loadUsers(); toast('ลบผู้ใช้แล้ว'); }
  });
}
function resetUserForm() { $('userForm').reset(); $('uId').value = ''; $('uPassLabel').textContent = 'รหัสผ่าน'; }
$('userForm').onsubmit = async e => {
  e.preventDefault();
  if (await act('user_save', { id: Number($('uId').value) || null, username: $('uUser').value, name: $('uName').value, role: $('uRole').value, password: $('uPass').value })) {
    resetUserForm(); loadUsers();
  }
};
$('uCancel').onclick = resetUserForm;
