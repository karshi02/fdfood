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

let users = [], uRole = 'staff';
// one-click starting points; the owner can still tick or untick single permissions afterwards
const PRESETS = [
  { key: 'owner', label: 'เจ้าของร้าน', role: 'admin', perms: null },
  { key: 'manager', label: 'แอดมิน', role: 'staff', perms: ['menu', 'discount', 'reduce', 'report', 'void'] },
  { key: 'staff', label: 'พนักงาน', role: 'staff', perms: [] },
];
// non-owners may only touch accounts that hold nothing they don't (same rule as api.php user_save/user_del)
const manageable = u => isOwner() || (u.role !== 'admin' && u.perms.every(can));
const permNames = u => u.role === 'admin' ? 'ทุกสิทธิ์' : u.perms.map(p => S.permList[p]).join(', ') || 'สิทธิ์พื้นฐาน';

function renderPermForm(role, perms) {
  uRole = role;
  const all = Object.keys(S.permList);
  // only the owner can make owners; anyone else can only hand out what they have
  $('uPresets').innerHTML = PRESETS.filter(x => x.role !== 'admin' || isOwner()).map(x => {
    const on = x.role === role && (x.perms === null || (x.perms.length === perms.length && x.perms.every(p => perms.includes(p))));
    return `<button type="button" class="chip ${on ? 'on' : ''}" data-preset="${x.key}">${x.label}</button>`;
  }).join('');
  $('uPerms').innerHTML = all.map(p => {
    const owner = role === 'admin', mine = can(p);
    return `<label class="perm ${owner || !mine ? 'off' : ''}"><input type="checkbox" value="${p}" ${owner || perms.includes(p) ? 'checked' : ''} ${owner || !mine ? 'disabled' : ''}>
      <span>${esc(S.permList[p])}</span></label>`;
  }).join('') + (role === 'admin' ? '<p class="muted" style="grid-column:1/-1;margin:0">เจ้าของร้านได้ทุกสิทธิ์เสมอ</p>' : '');
  $('uPresets').querySelectorAll('[data-preset]').forEach(b => b.onclick = () => {
    const x = PRESETS.find(y => y.key === b.dataset.preset);
    renderPermForm(x.role, x.perms || all);
  });
  $('uPerms').querySelectorAll('input').forEach(c => c.onchange = () => renderPermForm('staff', checkedPerms()));
}
const checkedPerms = () => [...$('uPerms').querySelectorAll('input:checked')].map(c => c.value);

async function loadUsers() {
  const d = await act('users'); if (!d) return;
  users = d.users;
  if (!$('uId').value) renderPermForm(uRole, uRole === 'admin' ? [] : checkedPerms());
  $('userBody').innerHTML = users.map(u => `<tr><td>${esc(u.name)} <span class="muted">@${esc(u.username)}</span></td>
    <td><span class="role">${u.role === 'admin' ? 'เจ้าของร้าน' : 'พนักงาน'}</span><div class="muted">${esc(permNames(u))}</div></td>
    <td class="num" style="white-space:nowrap">${manageable(u) ? `<button class="btn ghost sm" data-uedit="${u.id}">แก้ไข</button>` : ''}
    ${u.id !== ME.id && manageable(u) ? `<button class="btn ghost sm" data-udel="${u.id}">ลบ</button>` : ''}</td></tr>`).join('');
  $('userBody').querySelectorAll('[data-uedit]').forEach(b => b.onclick = () => {
    const u = users.find(x => x.id == b.dataset.uedit);
    $('uId').value = u.id; $('uUser').value = u.username; $('uName').value = u.name; $('uPass').value = '';
    $('uPassLabel').textContent = 'รหัสผ่านใหม่ (เว้นว่าง = ไม่เปลี่ยน)';
    $('uTitle').textContent = `แก้ไขผู้ใช้ — ${u.name}`;
    renderPermForm(u.role, u.perms);
    $('userForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  $('userBody').querySelectorAll('[data-udel]').forEach(b => b.onclick = async () => {
    if (confirm('ลบผู้ใช้นี้?') && await act('user_del', { id: Number(b.dataset.udel) })) { loadUsers(); toast('ลบผู้ใช้แล้ว'); }
  });
}
function resetUserForm() {
  $('userForm').reset(); $('uId').value = ''; $('uPassLabel').textContent = 'รหัสผ่าน'; $('uTitle').textContent = 'เพิ่มผู้ใช้';
  renderPermForm('staff', []);
}
$('userForm').onsubmit = async e => {
  e.preventDefault();
  const edit = $('uId').value;
  if (await act('user_save', { id: Number(edit) || null, username: $('uUser').value, name: $('uName').value, role: uRole,
    perms: uRole === 'admin' ? [] : checkedPerms(), password: $('uPass').value })) {
    toast(edit ? 'บันทึกสิทธิ์แล้ว' : `เพิ่มผู้ใช้ ${$('uName').value} แล้ว`);
    resetUserForm(); loadUsers();
  }
};
$('uCancel').onclick = resetUserForm;
