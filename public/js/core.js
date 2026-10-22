const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const baht = n => Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = n => Math.round(n * 100) / 100;
const $ = id => document.getElementById(id);
// labels for every method a bill can carry; qr and card only appear on bills made before the 3-choice payment screen
const METHODS = { cash: 'เงินสด', transfer: 'โอน', other: 'อื่นๆ', mixed: 'เงินสด+โอน', qr: 'พร้อมเพย์/QR', card: 'บัตร' };
const PAY_METHODS = ['cash', 'transfer', 'other'];
// how much of a bill each method took: a mixed bill splits into its cash and transfer parts
const payParts = b => b.method === 'mixed' ? { cash: r2(b.total - b.transfer), transfer: b.transfer } : { [b.method]: b.total };
const pad = n => String(n).padStart(2, '0');
const dayKey = d => { const x = new Date(d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
// bills are stored as yy (พ.ศ.) + 5-digit counter (6900001); people only see the counter: 00001
const billNo = b => String((b.bno || b.no) % 100000).padStart(5, '0');
const toDate = s => new Date(String(s).replace(' ', 'T')); // MySQL DATETIME -> local Date

let S = { settings: {}, menu: [], tables: [], permList: {} }, ME = null, ver = 0;
const isOwner = () => !!ME && ME.role === 'admin';
const can = p => !!ME && (ME.perms || []).includes(p);
// an element marked data-perm="a b" shows when the user has any of those permissions
const canAny = list => list.split(' ').some(can);

/* ---------- server ---------- */
async function api(action, body) {
  const opt = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  let r, d;
  try { r = await fetch('api.php?a=' + action, opt); d = await r.json(); }
  catch { setStatus(false); alert('ต่อเซิร์ฟเวอร์ไม่ได้'); throw new Error('network'); }
  setStatus(true);
  if (r.status === 401 && action !== 'login') { showLogin(); throw new Error(d.error); }
  if (!r.ok) { if (action !== 'login') alert(d.error || 'ผิดพลาด'); throw new Error(d.error); }
  if (d.tables) apply(d);
  return d;
}
// fire-and-forget for button handlers: api() already showed the error
const act = (action, body) => api(action, body).catch(() => null);
// pops in at the top-right, stays 4 s, then slides up and away; several stack, newest on top
function toast(msg) {
  const box = $('toast'), el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  box.prepend(el);
  while (box.children.length > 4) box.lastElementChild.remove();
  void el.offsetWidth; // start from the hidden state so the entry animates
  el.classList.add('show');
  setTimeout(() => { el.classList.replace('show', 'out'); setTimeout(() => el.remove(), 300); }, 4000);
}

function apply(d, fromPoll) {
  ver = d.ver; ME = d.me;
  S = { settings: d.settings, menu: d.menu, tables: d.tables, permList: d.permList || {}, files: d.files || [] };
  render();
  // a sale or expense on another device changes the dashboard numbers
  if (fromPoll && can('report') && !$('tab-dash').classList.contains('hidden')) loadDash();
  if (!cur) return;
  if (!S.tables.some(t => t.id === cur)) return closeModal();
  // don't wipe what someone is typing in the open table when another device changes something
  const typing = $('modal').contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName);
  if (!(fromPoll && typing)) renderModal();
}
function setStatus(ok) {
  $('sync').textContent = ok ? '● ออนไลน์' : '● ออฟไลน์';
  $('sync').className = ok ? 'ok' : 'off';
}
async function poll() {
  if (!ME || document.hidden) return;
  try {
    const r = await fetch('api.php?a=ver');
    if (r.status === 401) return showLogin();
    const d = await r.json(); setStatus(true);
    if (d.ver !== ver) { const s = await (await fetch('api.php?a=state')).json(); if (s.tables) apply(s, true); }
  } catch { setStatus(false); }
}

/* ---------- login ---------- */
function showLogin() { ME = null; closeModal(); $('login').classList.remove('hidden'); $('lPass').value = ''; $('lUser').focus(); }
$('loginForm').onsubmit = async e => {
  e.preventDefault(); $('lErr').textContent = '';
  try {
    await api('login', { username: $('lUser').value.trim(), password: $('lPass').value }); $('login').classList.add('hidden'); showTab('tables');
    nagWeak();
  }
  catch (err) { $('lErr').textContent = err.message; }
};
$('logout').onclick = async () => {
  if (!confirm('ออกจากระบบ?')) return;
  await act('logout', {}); closeModal(); showLogin(); toast('ออกจากระบบแล้ว');
};
$('chPass').onclick = async () => {
  const old = prompt('รหัสผ่านเดิม'); if (old === null) return;
  const nw = prompt('รหัสผ่านใหม่ (อย่างน้อย 4 ตัว)'); if (!nw) return;
  if (await act('password', { old, new: nw })) { alert('เปลี่ยนรหัสแล้ว'); if (ME) ME.weak = false; }
};
// the server blocks everything while the public default password is in use
function nagWeak() {
  if (ME && ME.weak) { alert('ยังใช้รหัสผ่านเริ่มต้นอยู่ — ต้องเปลี่ยนรหัสก่อนใช้งาน'); $('chPass').click(); }
}

/* ---------- tabs ---------- */
function showTab(name) {
  const gate = { dash: 'report', report: 'report', settings: 'settings users' };
  if (gate[name] && !canAny(gate[name])) name = 'tables';
  document.querySelectorAll('nav button').forEach(x => x.classList.toggle('on', x.dataset.tab === name));
  document.querySelectorAll('main > section').forEach(s => s.classList.toggle('hidden', s.id !== 'tab-' + name));
  // the page may have been open since yesterday: re-anchor "today" unless a date was picked by hand
  if (name === 'dash') { if (dashPreset) setPreset(dashPreset); else loadDash(); if (!$('eId').value) $('eDate').value = dayKey(Date.now()); }
  if (name === 'report') { if (!rPicked) setRange(dayKey(Date.now()), dayKey(Date.now())); loadReport(); }
  if (name === 'settings' && can('users')) loadUsers();
}
document.querySelectorAll('nav button').forEach(b => b.onclick = () => showTab(b.dataset.tab));

/* ---------- money ---------- */
function calc(items, discount) {
  const sub = items.reduce((a, i) => a + i.price * i.qty, 0);
  let disc = 0;
  if (discount) disc = discount.type === 'pct' ? sub * discount.value / 100 : discount.value;
  disc = r2(Math.min(sub, Math.max(0, disc)));
  const service = r2((sub - disc) * (Number(S.settings.service) || 0) / 100);
  const vat = r2((sub - disc + service) * (Number(S.settings.vat) || 0) / 100);
  return { sub: r2(sub), disc, service, vat, total: r2(sub - disc + service + vat) };
}

/* ---------- PromptPay (EMVCo QR, Thai QR standard) ---------- */
function crc16(s) {
  let crc = 0xFFFF;
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
  }
  return (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
}
const tlv = (id, v) => id + String(v.length).padStart(2, '0') + v;
function promptpayPayload(target, amount) {
  const d = String(target).replace(/\D/g, '');
  let acc;
  if (d.length === 13) acc = tlv('02', d);
  else if (d.length === 10 && d[0] === '0') acc = tlv('01', '0066' + d.slice(1));
  else return null;
  const p = tlv('00', '01') + tlv('01', amount ? '12' : '11') + tlv('29', tlv('00', 'A000000677010111') + acc)
    + tlv('58', 'TH') + tlv('53', '764') + (amount ? tlv('54', amount.toFixed(2)) : '') + '6304';
  return p + crc16(p);
}
function qrSvg(amount) {
  if (!S.settings.promptpay || typeof qrcode === 'undefined') return '';
  const payload = promptpayPayload(S.settings.promptpay, amount);
  if (!payload) return '';
  const qr = qrcode(0, 'M'); qr.addData(payload); qr.make();
  return qr.createSvgTag(4, 8);
}
