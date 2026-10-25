/* ---------- settings (admin): five sub-tabs, typed fields save together from one bar, switches save at once ---------- */
const STABS = ['shop', 'pay', 'qr', 'tables', 'users'];
let sTab = null;
try { sTab = localStorage.getItem('stab'); } catch {}
function showSTab(k) {
  const ok = STABS.filter(x => !$('sTabs').querySelector(`[data-stab="${x}"]`).classList.contains('hidden'));
  if (!ok.includes(k)) k = ok[0];
  sTab = k;
  try { localStorage.setItem('stab', k); } catch {}
  $('sTabs').querySelectorAll('[data-stab]').forEach(b => { b.classList.toggle('on', b.dataset.stab === k); b.setAttribute('aria-pressed', b.dataset.stab === k); });
  $('tab-settings').querySelectorAll('[data-pane]').forEach(el => el.classList.toggle('poff', el.dataset.pane !== k));
}
$('sTabs').querySelectorAll('[data-stab]').forEach(b => b.onclick = () => showSTab(b.dataset.stab));

// the typed fields of ร้าน + ชำระเงิน: what the server has, so the bar knows what changed and ยกเลิก can put it back
const FIELDS = { sName: 'name', sAddr: 'addr', sPhone: 'phone', sService: 'service', sVat: 'vat', sFooter: 'footer', sPP: 'promptpay', sBank: 'bank_name', sAcct: 'bank_acct', sOwner: 'bank_owner' };
let saved = null;
const shopQr = () => (S.files || []).find(f => f.k === 'shop_qr');
const payMode = () => (document.querySelector('input[name=payMode]:checked') || {}).value || 'pp';
function fieldsFromServer() {
  const s = S.settings, v = {};
  for (const [id, k] of Object.entries(FIELDS)) v[id] = String(s[k] ?? '');
  v.payMode = s.promptpay || !shopQr() ? 'pp' : 'img';
  return v;
}
function fillFields(v) {
  for (const id of Object.keys(FIELDS)) $(id).value = v[id];
  document.querySelectorAll('input[name=payMode]').forEach(r => r.checked = r.value === v.payMode);
}
function dirtyList() {
  if (!saved) return [];
  const d = Object.keys(FIELDS).filter(id => $(id).value !== saved[id]);
  if (payMode() !== saved.payMode) d.push('payMode');
  return d;
}
function refreshDirty() {
  const d = dirtyList();
  Object.keys(FIELDS).forEach(id => $(id).classList.toggle('dirty', d.includes(id)));
  $('saveBar').classList.toggle('hidden', !d.length);
  $('saveText').textContent = `แก้ ${d.length} ช่อง ยังไม่บันทึก`;
  $('ppBox').classList.toggle('hidden', payMode() !== 'pp');
  $('imgBox').classList.toggle('hidden', payMode() !== 'img');
  drawPpTest();
}
$('tab-settings').querySelectorAll('[data-dirty]').forEach(el => el.addEventListener('input', refreshDirty));
$('saveUndo').onclick = () => { fillFields(saved); refreshDirty(); };
$('saveGo').onclick = async () => {
  const pp = $('sPP').value.trim(), mode = payMode();
  if (mode === 'pp' && pp && !promptpayPayload(pp)) { showSTab('pay'); $('sPP').focus(); return alert('พร้อมเพย์ต้องเป็นเบอร์มือถือ 10 หลัก หรือเลขบัตร 13 หลัก'); }
  if (mode === 'img' && !shopQr()) { showSTab('pay'); return alert('อัปโหลดรูป QR ร้านก่อน หรือเลือกพร้อมเพย์'); }
  const body = {};
  for (const [id, k] of Object.entries(FIELDS)) body[k] = $(id).value.trim();
  body.service = String(Number(body.service) || 0); body.vat = String(Number(body.vat) || 0);
  if (mode === 'img') body.promptpay = ''; // the shop QR picture is used when there is no PromptPay number
  saved = null; // take the server's values back after the save
  if (await act('settings_save', body)) toast('บันทึกแล้ว');
  renderSettings();
};

// a ฿1 PromptPay QR to scan with your own banking app before customers do
let ppDrawn = null;
function drawPpTest() {
  const pp = $('sPP').value.trim(), load = pp && promptpayPayload(pp, 1);
  if (load === ppDrawn) return;
  ppDrawn = load;
  if (!load) { $('ppTestQr').textContent = pp ? 'เลขไม่ถูกต้อง' : 'ใส่เลขก่อน'; return; }
  const q = qrcode(0, 'M'); q.addData(load); q.make();
  $('ppTestQr').innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

// setup checklist: what a new shop still has to do; a chip jumps to where it is done
function renderChecklist() {
  const items = [
    ['ชื่อร้าน', !!S.settings.name, 'shop'],
    ['โต๊ะ', S.tables.length > 0, 'tables'],
    ['เมนู', S.menu.length > 0, null],
    ['พร้อมเพย์ / QR ร้าน', !!S.settings.promptpay || !!shopQr(), 'pay'],
    ['เครื่องพิมพ์', typeof BT !== 'undefined' && BT.active(), 'printer'],
  ];
  const n = items.filter(x => x[1]).length;
  $('ckCount').textContent = `${n} จาก ${items.length}`;
  $('ckBar').style.width = (n / items.length * 100) + '%';
  $('ckChips').innerHTML = items.map(([label, done, go]) => done ? `<span class="done">✓ ${label}</span>`
    : go ? `<button type="button" data-go="${go}">ตั้ง${label} ›</button>` : `<span class="done" style="background:#fdecd3;color:#8a3b00">ยังไม่มี${label}</span>`).join('');
  $('ckChips').querySelectorAll('[data-go]').forEach(b => b.onclick = () => b.dataset.go === 'printer' ? $('printerBtn').click() : showSTab(b.dataset.go));
}
if (typeof BT !== 'undefined') BT.onChange(st => {
  const on = BT.active();
  $('sPrnDot').classList.toggle('ready', on);
  $('sPrnText').textContent = on ? (st.via === 'rawbt' ? 'ต่อผ่านแอป RawBT' : `ต่อแล้ว: ${st.name}`) + ` · กระดาษ ${st.paper} มม.` : 'ยังไม่ได้ต่อ · พิมพ์ผ่านเบราว์เซอร์';
  if (S.settings && S.tables) renderChecklist();
});
$('sPrnOpen').onclick = () => $('printerBtn').click();

function renderSettings() {
  const s = S.settings;
  if (!sTab || $('sTabs').querySelector('.on') === null) showSTab(sTab);
  // keep what the admin is typing; a save from another device shows once nothing here is changed
  if (!saved || !dirtyList().length) { saved = fieldsFromServer(); fillFields(saved); }
  refreshDirty();
  renderChecklist();

  const sw = (el, on) => el.setAttribute('aria-checked', on ? 'true' : 'false');
  sw($('sPin'), s.qr_pin === '1'); sw($('sOpenOnly'), s.qr_open_only === '1');
  const qr = shopQr();
  $('sQrPrev').innerHTML = qr ? `<img src="${esc(qr.url)}" alt="QR ร้าน">` : '<small class="muted">ยังไม่มีรูป</small>';
  $('sQrDel').classList.toggle('hidden', !qr);
  if (document.activeElement !== $('qrTable')) {
    const keep = $('qrTable').value;
    $('qrTable').innerHTML = S.tables.map(t => `<option value="${t.id}">โต๊ะ ${esc(t.name)}</option>`).join('');
    if (keep) $('qrTable').value = keep;
  }

  // kitchen sound: the one in use up front, every other one in the listening room behind "เลือกเสียงอื่น"
  const cur = s.sound || 'b:ding', opts = soundOptions(S.files), curLabel = (opts.find(o => o[0] === cur) || opts[0])[1];
  $('sndCur').innerHTML = `<button type="button" class="sndplay2" id="sndTest" aria-label="ฟังแบบจอครัว (3 ครั้ง)">▶</button><span><b>${esc(curLabel)}</b><small>ใช้อยู่ · กด ▶ ฟังแบบจอครัว</small></span>`;
  $('sndTest').onclick = () => playAlert(cur, S.files);
  $('sndMore').textContent = $('sndRoom').classList.contains('hidden') ? `เลือกเสียงอื่น (${opts.length})` : 'ซ่อนรายการเสียง';
  $('sndRoom').innerHTML = opts.map(([v, label]) => `<div class="sndcard${v === cur ? ' on' : ''}">
      <button type="button" class="sndplay" data-play="${esc(v)}" aria-label="ฟัง ${esc(label)}">▶</button><span>${esc(label)}</span>
      ${v === cur ? '<b class="sndnow">ใช้อยู่</b>' : `<button type="button" class="btn ghost sm" data-use="${esc(v)}">ใช้เสียงนี้</button>`}</div>`).join('');
  $('sndRoom').querySelectorAll('[data-play]').forEach(b => b.onclick = () => playSound(b.dataset.play, S.files));
  $('sndRoom').querySelectorAll('[data-use]').forEach(b => b.onclick = async () => {
    playSound(b.dataset.use, S.files);
    if (await act('settings_save', { sound: b.dataset.use })) toast('ตั้งเสียงแจ้งเตือนแล้ว');
  });
  const snds = (S.files || []).filter(f => f.k.startsWith('snd_'));
  $('sndList').innerHTML = snds.map(f => `<span class="tchip">🎵 ${esc(f.name || 'เสียง')}<button type="button" data-snddel="${esc(f.k)}" aria-label="ลบเสียง ${esc(f.name)}">${icon('close')}</button></span>`).join('');
  $('sndList').querySelectorAll('[data-snddel]').forEach(b => b.onclick = async () => {
    if (confirm('ลบเสียงนี้?') && await act('file_del', { k: b.dataset.snddel })) {
      if (S.settings.sound === 'f:' + b.dataset.snddel) await act('settings_save', { sound: 'b:ding' });
      toast('ลบเสียงแล้ว');
    }
  });

  renderTableRows();
}
$('sndMore').onclick = () => {
  const open = $('sndRoom').classList.toggle('hidden') === false;
  $('sndMore').setAttribute('aria-expanded', open);
  renderSettings();
};
// switches: flip, save, and flip back if the save failed
async function flipSwitch(el, key, onMsg, offMsg) {
  const on = el.getAttribute('aria-checked') !== 'true';
  el.setAttribute('aria-checked', on); el.disabled = true;
  const d = await act('settings_save', { [key]: on ? '1' : '0' });
  el.disabled = false;
  if (d) toast(on ? onMsg : offMsg); else el.setAttribute('aria-checked', !on);
}
$('sPin').onclick = () => flipSwitch($('sPin'), 'qr_pin', 'ลูกค้าต้องใส่ PIN แล้ว', 'ปิดการใส่ PIN แล้ว');
$('sOpenOnly').onclick = () => flipSwitch($('sOpenOnly'), 'qr_open_only', 'สั่งเองได้เฉพาะโต๊ะที่เปิด QR ให้', 'ทุกโต๊ะที่มีลูกค้าสั่งเองได้');

/* ---------- tables: add one or a run (26-30), rename in place, delete free ones ---------- */
let tEdit = null;
const T_STATUS = { free: 'ว่าง', busy: 'มีลูกค้า', resv: 'จองไว้' };
function renderTableRows() {
  if (tEdit && $('tblBody').contains(document.activeElement)) return; // typing a new name
  $('tCount').textContent = `โต๊ะทั้งหมด ${S.tables.length}`;
  $('tblBody').innerHTML = S.tables.map(t => tEdit === t.id
    ? `<div class="trow"><label class="sr" for="tRen">ชื่อโต๊ะ ${esc(t.name)}</label><input id="tRen" value="${esc(t.name)}"><button class="btn ok" type="button" id="tRenOk">ตกลง</button><button class="btn ghost" type="button" id="tRenNo">ยกเลิก</button></div>`
    : `<div class="trow"><b>โต๊ะ ${esc(t.name)}</b><span class="tpill ${t.status}">${T_STATUS[t.status] || t.status}</span>
      <button type="button" class="ticon" data-tren="${t.id}" aria-label="แก้ชื่อ โต๊ะ ${esc(t.name)}">${icon('edit')}</button>
      ${t.status === 'free' ? `<button type="button" class="ticon del" data-tdel="${t.id}" aria-label="ลบ โต๊ะ ${esc(t.name)}">${icon('trash')}</button>` : '<span class="tnodel">ลบไม่ได้ ตอนมีคน</span>'}</div>`).join('');
  $('tblBody').querySelectorAll('[data-tren]').forEach(b => b.onclick = () => { tEdit = Number(b.dataset.tren); renderTableRows(); $('tRen').focus(); $('tRen').select(); });
  $('tblBody').querySelectorAll('[data-tdel]').forEach(b => b.onclick = async () => {
    const t = S.tables.find(x => x.id == b.dataset.tdel);
    if (confirm(`ลบโต๊ะ ${t.name}?`) && await act('table_del', { id: t.id })) toast(`ลบโต๊ะ ${t.name} แล้ว`);
  });
  if ($('tRen')) {
    const done = async ok => {
      const t = S.tables.find(x => x.id === tEdit), name = $('tRen').value.trim();
      tEdit = null;
      if (ok && name && name !== t.name && await act('table_rename', { id: t.id, name })) toast(`เปลี่ยนชื่อเป็น โต๊ะ ${name} แล้ว`);
      renderTableRows();
    };
    $('tRenOk').onclick = () => done(true);
    $('tRenNo').onclick = () => done(false);
    $('tRen').onkeydown = e => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
  }
}
$('tAdd').onclick = async () => {
  const name = $('tName').value.trim(); if (!name) return $('tName').focus();
  const run = name.match(/^(\d+)\s*-\s*(\d+)$/);
  const names = run && +run[2] >= +run[1] && +run[2] - +run[1] < 50 ? Array.from({ length: run[2] - run[1] + 1 }, (_, i) => String(+run[1] + i)) : [name];
  if (names.length > 1 && !confirm(`เพิ่มโต๊ะ ${names[0]} ถึง ${names[names.length - 1]} (${names.length} โต๊ะ)?`)) return;
  let n = 0;
  for (const x of names) { if (await act('table_add', { name: x })) n++; else break; }
  if (n) { $('tName').value = ''; toast(n > 1 ? `เพิ่ม ${n} โต๊ะแล้ว` : `เพิ่มโต๊ะ ${names[0]} แล้ว`); }
};
$('tName').onkeydown = e => { if (e.key === 'Enter') $('tAdd').click(); };

/* ---------- users ---------- */
let users = [], uRole = 'staff';
// one-click starting points; the owner can still tick or untick single permissions afterwards
const PRESETS = [
  { key: 'staff', label: 'พนักงาน', role: 'staff', perms: [] },
  { key: 'manager', label: 'ผู้จัดการ', role: 'staff', perms: ['menu', 'discount', 'reduce', 'report', 'void'] },
  { key: 'owner', label: 'เจ้าของร้าน', role: 'admin', perms: null },
];
// non-owners may only touch accounts that hold nothing they don't (same rule as api.php user_save/user_del)
const manageable = u => isOwner() || (u.role !== 'admin' && u.perms.every(can));

function renderPermForm(role, perms) {
  uRole = role;
  const all = Object.keys(S.permList), self = Number($('uId').value) === ME.id;
  // only the owner can make owners; anyone else can only hand out what they have; nobody changes their own role here
  $('uPresets').innerHTML = PRESETS.filter(x => x.role !== 'admin' || isOwner()).map(x => {
    const on = x.role === role && (x.perms === null || (x.perms.length === perms.length && x.perms.every(p => perms.includes(p))));
    return `<button type="button" class="${on ? 'on' : ''}" data-preset="${x.key}" ${self ? 'disabled title="เปลี่ยนตำแหน่งตัวเองไม่ได้"' : ''}>${x.label}</button>`;
  }).join('');
  $('uPerms').innerHTML = all.map(p => {
    const owner = role === 'admin', mine = can(p);
    return `<label class="${owner || !mine || self ? 'off' : ''}"><input type="checkbox" value="${p}" ${owner || perms.includes(p) ? 'checked' : ''} ${owner || !mine || self ? 'disabled' : ''}>
      <span>${esc(S.permList[p])}</span></label>`;
  }).join('') + (role === 'admin' ? '<small class="muted">เจ้าของร้านได้ทุกสิทธิ์เสมอ</small>' : '');
  $('uPresets').querySelectorAll('[data-preset]').forEach(b => b.onclick = () => {
    const x = PRESETS.find(y => y.key === b.dataset.preset);
    renderPermForm(x.role, x.perms || all);
  });
  $('uPerms').querySelectorAll('input').forEach(c => c.onchange = () => renderPermForm('staff', checkedPerms()));
}
const checkedPerms = () => [...$('uPerms').querySelectorAll('input:checked')].map(c => c.value);

// online = a request in the last 120 s (screens poll every 3 s, the server records it at most once a minute)
function onlineText(u) {
  if (u.ago !== null && u.ago < 120) return 'ออนไลน์อยู่';
  if (u.seen === null) return 'ยังไม่เคยเข้า';
  const d = toDate(u.seen), today = dayKey(d) === dayKey(Date.now());
  return `ล่าสุด ${today ? '' : d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) + ' '}${d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}`;
}
const roleName = u => u.role === 'admin' ? 'เจ้าของร้าน' : (PRESETS.find(x => x.role === 'staff' && x.perms.length === u.perms.length && x.perms.every(p => u.perms.includes(p))) || { label: 'พนักงาน (กำหนดเอง)' }).label;
// keep the online dots fresh while the staff list is on screen; quiet on errors (no alert from a background poll)
setInterval(async () => {
  if (!ME || !can('users') || $('tab-settings').classList.contains('hidden') || sTab !== 'users') return;
  try {
    const d = await (await fetch('api.php?a=users')).json();
    (d.users || []).forEach(u => {
      const card = $('userBody').querySelector(`[data-on="${u.id}"]`); if (!card) return;
      card.querySelector('.uav2').classList.toggle('on', u.ago !== null && u.ago < 120);
      card.querySelector('.uonl').textContent = onlineText(u);
    });
  } catch {}
}, 30000);

async function loadUsers() {
  const d = await act('users'); if (!d) return;
  users = d.users;
  if (!$('uId').value && $('userForm').classList.contains('hidden')) renderPermForm('staff', []);
  // one card per person: who, online or last seen, role; tap แก้ไข to open the form for them
  $('userBody').innerHTML = users.map(u => `<div class="ucard2" data-on="${u.id}">
    <span class="uav2${u.role === 'admin' ? ' owner' : ''}${u.ago !== null && u.ago < 120 ? ' on' : ''}">${esc((u.name || u.username).replace(/^[เแโใไ]/, '').slice(0, 1))}</span>
    <div class="uinfo2"><b>${esc(u.name)}${u.id === ME.id ? ' (คุณ)' : ''}</b><small>${esc(u.username)} · <span class="uonl">${onlineText(u)}</span></small><small>${esc(roleName(u))}</small></div>
    ${u.role === 'admin' ? '<span class="urole">เจ้าของ</span>' : ''}
    ${manageable(u) ? `<button type="button" class="uedit2" data-uedit="${u.id}">แก้ไข ›</button>` : ''}</div>`).join('');
  $('userBody').querySelectorAll('[data-uedit]').forEach(b => b.onclick = () => {
    const u = users.find(x => x.id == b.dataset.uedit);
    $('uId').value = u.id; $('uUser').value = u.username; $('uName').value = u.name; $('uPass').value = '';
    $('uPassLabel').textContent = 'ตั้งรหัสใหม่ (เว้นว่าง = ใช้รหัสเดิม)';
    $('uTitle').textContent = u.name; $('uSub').textContent = `${u.username} · ${onlineText(u)}`;
    $('uDel').classList.toggle('hidden', u.id === ME.id);
    renderPermForm(u.role, u.perms);
    $('userForm').classList.remove('hidden'); $('uAdd').classList.add('hidden');
    $('userForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}
function resetUserForm() {
  $('userForm').reset(); $('uId').value = ''; $('uPassLabel').textContent = 'รหัสผ่าน (อย่างน้อย 4 ตัว)';
  $('uTitle').textContent = 'เพิ่มพนักงาน'; $('uSub').textContent = ''; $('uDel').classList.add('hidden');
  renderPermForm('staff', []);
  $('userForm').classList.add('hidden'); $('uAdd').classList.remove('hidden');
}
$('uAdd').onclick = () => { resetUserForm(); $('userForm').classList.remove('hidden'); $('uAdd').classList.add('hidden'); $('uName').focus(); };
$('userForm').onsubmit = async e => {
  e.preventDefault();
  const edit = $('uId').value;
  if (await act('user_save', { id: Number(edit) || null, username: $('uUser').value, name: $('uName').value, role: uRole,
    perms: uRole === 'admin' ? [] : checkedPerms(), password: $('uPass').value })) {
    toast(edit ? 'บันทึกแล้ว' : `เพิ่ม ${$('uName').value} แล้ว`);
    resetUserForm(); loadUsers();
  }
};
$('uCancel').onclick = resetUserForm;
$('uDel').onclick = async () => {
  const u = users.find(x => x.id == $('uId').value);
  if (u && confirm(`ลบบัญชี ${u.name}? เข้าระบบด้วยบัญชีนี้ไม่ได้อีก`) && await act('user_del', { id: u.id })) { resetUserForm(); loadUsers(); toast(`ลบบัญชี ${u.name} แล้ว`); }
};

/* ---------- shop QR picture ---------- */
// a file the user picks; pictures are shrunk to at most `max` px as JPEG on a white background
const pickFile = accept => new Promise(ok => {
  const i = Object.assign(document.createElement('input'), { type: 'file', accept });
  i.onchange = () => ok(i.files[0] || null);
  i.click();
});
const readUrl = f => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = bad; r.readAsDataURL(f); });
async function shrinkImage(f, max) {
  const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = URL.createObjectURL(f); });
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(img.naturalWidth * k), height: Math.round(img.naturalHeight * k) });
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(img.src);
  return c.toDataURL('image/jpeg', 0.85);
}
$('sQrUp').onclick = async () => {
  const f = await pickFile('image/*'); if (!f) return;
  try { if (await act('file_save', { kind: 'shop_qr', data: await shrinkImage(f, 900) })) toast('บันทึกรูป QR ร้านแล้ว'); }
  catch { alert('เปิดรูปนี้ไม่ได้'); }
};
$('sQrDel').onclick = async () => { if (confirm('ลบรูป QR ร้าน?') && await act('file_del', { k: 'shop_qr' })) toast('ลบรูป QR แล้ว'); };


/* ---------- QR stickers ---------- */
const orderUrl = t => new URL('order.html?t=' + t.qr, location.href).href;
// a printable sheet of table stickers in a new window: big QR, table name, short instructions
function printQr(tables) {
  const w = window.open('', '_blank');
  if (!w) return alert('เบราว์เซอร์บล็อกหน้าต่างใหม่ — อนุญาต popup แล้วลองอีกครั้ง');
  const qrTag = u => { const q = qrcode(0, 'M'); q.addData(u); q.make(); return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); };
  w.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>QR สั่งอาหาร</title>
    <style>body{font-family:"IBM Plex Sans Thai",Tahoma,sans-serif;margin:0}.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(62mm,1fr));gap:6mm;padding:6mm}
    .s{border:2px dashed #999;border-radius:6mm;padding:5mm;text-align:center;break-inside:avoid}.s svg{width:48mm;height:48mm}
    .n{font-size:20pt;font-weight:700;margin:2mm 0 0}.h{font-size:11pt;color:#444}.shop{font-size:12pt;font-weight:600}</style></head><body><div class="g">
    ${tables.map(t => `<div class="s"><div class="shop">${esc(S.settings.name || '')}</div>${qrTag(orderUrl(t))}<div class="n">โต๊ะ ${esc(t.name)}</div><div class="h">สแกนเพื่อสั่งอาหาร</div></div>`).join('')}
    </div><script>onload=()=>print()<\/script></body></html>`);
  w.document.close();
}
$('qrPrintAll').onclick = () => printQr(S.tables);
$('qrPrintOne').onclick = () => printQr(S.tables.filter(t => t.id == $('qrTable').value));
$('qrRegen').onclick = async () => {
  const t = S.tables.find(x => x.id == $('qrTable').value);
  if (t && confirm(`เปลี่ยน QR โต๊ะ ${t.name}?\nQR เดิมที่ติดโต๊ะ (และที่ใครถ่ายรูปไว้) จะใช้ไม่ได้ ต้องพิมพ์ QR ใหม่ไปติด`) && await act('qr_regen', { table: t.id })) {
    toast(`เปลี่ยน QR โต๊ะ ${t.name} แล้ว — พิมพ์ใหม่ไปติดโต๊ะ`);
  }
};
// any audio or video file (a phone screen recording of a clip works): the browser decodes it, keeps the chosen
// seconds, mixes to mono 16 kHz and saves a small WAV, so big files and video formats are fine
async function clipToWav(f, from, len) {
  const src = await actx().decodeAudioData(await f.arrayBuffer());
  const start = Math.min(Math.max(0, from), Math.max(0, src.duration - 0.1)), dur = Math.min(len, src.duration - start);
  const rate = 16000, off = new OfflineAudioContext(1, Math.ceil(dur * rate), rate), node = off.createBufferSource();
  node.buffer = src; node.connect(off.destination); node.start(0, start, dur);
  const pcm = (await off.startRendering()).getChannelData(0);
  const peak = pcm.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1; // loud enough for a noisy kitchen
  const out = new DataView(new ArrayBuffer(44 + pcm.length * 2)), w = (o, t) => [...t].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); out.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVEfmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, rate, true); out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, pcm.length * 2, true);
  pcm.forEach((v, i) => out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v / peak * 0.95)) * 0x7fff, true));
  return { blob: new Blob([out], { type: 'audio/wav' }), duration: src.duration };
}
$('sndUp').onclick = async () => {
  const f = await pickFile('audio/*,video/*'); if (!f) return;
  const from = Number((prompt('เริ่มที่วินาทีที่เท่าไหร่ของไฟล์? (0 = ตั้งแต่ต้น)', '0') || '').trim());
  if (!(from >= 0)) return;
  const len = Number((prompt('ยาวกี่วินาที? (1–8)', '4') || '').trim());
  if (!(len >= 0.5 && len <= 8)) return alert('ความยาวต้องอยู่ระหว่าง 0.5–8 วินาที');
  let clip;
  try { clip = await clipToWav(f, from, len); } catch { return alert('เปิดเสียงจากไฟล์นี้ไม่ได้ — ลองไฟล์ mp3, m4a หรือคลิป mp4'); }
  if (from >= clip.duration) return alert(`ไฟล์นี้ยาวแค่ ${clip.duration.toFixed(1)} วินาที`);
  const url = URL.createObjectURL(clip.blob), a = new Audio(url);
  a.play().catch(() => {});
  const name = (prompt('ฟังเสียงที่ตัดได้ — ถ้าใช่ ตั้งชื่อเสียงนี้แล้วกด OK (กด Cancel = ไม่เอา)', f.name.replace(/\.[^.]+$/, '')) || '').trim();
  a.pause(); URL.revokeObjectURL(url);
  if (!name) return;
  const d = await act('file_save', { kind: 'sound', name, data: await readUrl(clip.blob) });
  if (d) { await act('settings_save', { sound: 'f:' + d.key }); toast(`เพิ่มเสียง "${name}" และตั้งเป็นเสียงแจ้งเตือนแล้ว`); }
};
