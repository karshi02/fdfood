/* ---------- settings (admin) ---------- */
function renderSettings() {
  const s = S.settings;
  // don't overwrite a form the admin is editing when another device saves
  if (!$('tab-settings').contains(document.activeElement)) {
    $('sName').value = s.name; $('sAddr').value = s.addr; $('sPhone').value = s.phone;
    $('sService').value = s.service; $('sVat').value = s.vat; $('sPP').value = s.promptpay; $('sFooter').value = s.footer;
    $('sBank').value = s.bank_name || ''; $('sAcct').value = s.bank_acct || ''; $('sOwner').value = s.bank_owner || '';
  }
  $('sPin').checked = s.qr_pin === '1';
  const qr = (S.files || []).find(f => f.k === 'shop_qr');
  $('sQrPrev').innerHTML = qr ? `<img src="${esc(qr.url)}" alt="QR ร้าน">` : '<small class="muted">ยังไม่มีรูป</small>';
  $('sQrDel').classList.toggle('hidden', !qr);
  if (document.activeElement !== $('qrTable')) {
    const keep = $('qrTable').value;
    $('qrTable').innerHTML = S.tables.map(t => `<option value="${t.id}">โต๊ะ ${esc(t.name)}</option>`).join('');
    if (keep) $('qrTable').value = keep;
  }
  if (document.activeElement !== $('sSound')) {
    $('sSound').innerHTML = soundOptions(S.files).map(([v, label]) => `<option value="${esc(v)}">${esc(label)}</option>`).join('');
    $('sSound').value = s.sound || 'b:ding';
  }
  // listening room: play any sound, pick one; the current one is marked
  $('sndRoom').innerHTML = soundOptions(S.files).map(([v, label]) => `<div class="sndcard${v === (s.sound || 'b:ding') ? ' on' : ''}">
      <button type="button" class="sndplay" data-play="${esc(v)}" aria-label="ฟัง ${esc(label)}">▶</button><span>${esc(label)}</span>
      ${v === (s.sound || 'b:ding') ? '<b class="sndnow">ใช้อยู่</b>' : `<button type="button" class="btn ghost sm" data-use="${esc(v)}">ใช้เสียงนี้</button>`}</div>`).join('');
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
  $('tblBody').innerHTML = S.tables.map(t => `<span class="tchip ${t.status}">โต๊ะ ${esc(t.name)}
    <button type="button" data-tdel="${t.id}" aria-label="ลบโต๊ะ ${esc(t.name)}" ${t.status !== 'free' ? 'disabled title="โต๊ะไม่ว่าง"' : ''}>${icon('close')}</button></span>`).join('');
  $('tblBody').querySelectorAll('[data-tdel]').forEach(b => b.onclick = () => { if (confirm('ลบโต๊ะนี้?')) act('table_del', { id: Number(b.dataset.tdel) }).then(d => d && toast('ลบโต๊ะแล้ว')); });
}
$('sSave').onclick = async () => {
  const pp = $('sPP').value.trim();
  if (pp && !promptpayPayload(pp)) return alert('พร้อมเพย์ต้องเป็นเบอร์มือถือ 10 หลัก หรือเลขบัตร 13 หลัก');
  if (await act('settings_save', { name: $('sName').value, addr: $('sAddr').value, phone: $('sPhone').value,
    service: String(Number($('sService').value) || 0), vat: String(Number($('sVat').value) || 0), promptpay: pp, footer: $('sFooter').value })) toast('บันทึกข้อมูลร้านแล้ว');
};
$('tAdd').onclick = async () => {
  const name = $('tName').value.trim(); if (!name) return;
  if (await act('table_add', { name })) { $('tName').value = ''; toast(`เพิ่มโต๊ะ ${name} แล้ว`); }
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

// online = a request in the last 120 s (screens poll every 3 s, the server records it at most once a minute)
function onlineHtml(u) {
  const dot = c => `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${c};margin-right:4px"></span>`;
  if (u.ago !== null && u.ago < 120) return `${dot('var(--ok)')}ออนไลน์`;
  if (u.seen === null) return `${dot('var(--line-strong)')}ออฟไลน์`;
  const d = toDate(u.seen), today = dayKey(d) === dayKey(Date.now());
  return `${dot('var(--line-strong)')}ล่าสุด ${today ? '' : d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) + ' '}${d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}`;
}
// keep the online dots fresh while the staff list is on screen; quiet on errors (no alert from a background poll)
setInterval(async () => {
  if (!ME || !can('users') || $('tab-settings').classList.contains('hidden')) return;
  try {
    const d = await (await fetch('api.php?a=users')).json();
    (d.users || []).forEach(u => { const el = $('userBody').querySelector(`[data-on="${u.id}"]`); if (el) el.innerHTML = onlineHtml(u); });
  } catch {}
}, 30000);

async function loadUsers() {
  const d = await act('users'); if (!d) return;
  users = d.users;
  if (!$('uId').value) renderPermForm(uRole, uRole === 'admin' ? [] : checkedPerms());
  // one card per user: who, online or last seen, role, and what they may do as chips
  $('userBody').innerHTML = users.map(u => `<div class="ucard">
    <span class="uav">${esc((u.name || u.username).replace(/^[เแโใไ]/, '').slice(0, 1))}</span>
    <div class="uinfo"><b>${esc(u.name)}</b> <span class="muted">@${esc(u.username)}</span><span class="role">${u.role === 'admin' ? 'เจ้าของร้าน' : 'พนักงาน'}</span>
      <div class="muted uon" data-on="${u.id}">${onlineHtml(u)}</div>
      <div class="uperms">${(u.role === 'admin' ? ['ทุกสิทธิ์'] : u.perms.map(p => S.permList[p])).map(p => `<span>${esc(p)}</span>`).join('') || '<span class="base">สิทธิ์พื้นฐาน</span>'}</div></div>
    <div class="uact">${manageable(u) ? `<button class="btn ghost sm" data-uedit="${u.id}">แก้ไข</button>` : ''}
    ${u.id !== ME.id && manageable(u) ? `<button class="btn danger sm" data-udel="${u.id}">ลบ</button>` : ''}</div></div>`).join('');
  $('userBody').querySelectorAll('[data-uedit]').forEach(b => b.onclick = () => {
    const u = users.find(x => x.id == b.dataset.uedit);
    $('uId').value = u.id; $('uUser').value = u.username; $('uName').value = u.name; $('uPass').value = '';
    $('uPassLabel').textContent = 'รหัสผ่านใหม่ (เว้นว่าง = ไม่เปลี่ยน)';
    $('uTitle').textContent = `แก้ไขผู้ใช้ — ${u.name}`;
    renderPermForm(u.role, u.perms);
    $('userForm').classList.remove('hidden');
    $('userForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('userBody').querySelectorAll('[data-udel]').forEach(b => b.onclick = async () => {
    if (confirm('ลบผู้ใช้นี้?') && await act('user_del', { id: Number(b.dataset.udel) })) { loadUsers(); toast('ลบผู้ใช้แล้ว'); }
  });
}
function resetUserForm() {
  $('userForm').reset(); $('uId').value = ''; $('uPassLabel').textContent = 'รหัสผ่าน'; $('uTitle').textContent = 'เพิ่มผู้ใช้';
  renderPermForm('staff', []);
  $('userForm').classList.add('hidden');
}
$('uAdd').onclick = () => { resetUserForm(); $('userForm').classList.remove('hidden'); $('uUser').focus(); };
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

/* ---------- payment account + shop QR picture ---------- */
$('sPaySave').onclick = async () => {
  if (await act('settings_save', { bank_name: $('sBank').value, bank_acct: $('sAcct').value, bank_owner: $('sOwner').value })) toast('บันทึกบัญชีร้านแล้ว');
};
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

/* ---------- QR ordering ---------- */
$('sPin').onchange = async () => { if (await act('settings_save', { qr_pin: $('sPin').checked ? '1' : '0' })) toast($('sPin').checked ? 'ลูกค้าต้องใส่รหัสโต๊ะแล้ว' : 'ปิดการใส่รหัสโต๊ะแล้ว'); };
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
$('sSound').onchange = async () => { playSound($('sSound').value, S.files); if (await act('settings_save', { sound: $('sSound').value })) toast('ตั้งเสียงแจ้งเตือนแล้ว'); };
$('sndTest').onclick = () => playAlert($('sSound').value, S.files);
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
