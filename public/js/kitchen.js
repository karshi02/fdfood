/* ---------- kitchen screen: what was sent to the kitchen and isn't cooked yet, with a sound for every new order ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let K = null, kVer = -1, seen = null, pending = false, muted = false, lastRing = 0;
try { muted = localStorage.getItem('kMute') === '1'; } catch {}

async function call(a, body) {
  const r = await fetch('api.php?a=' + a, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const d = await r.json().catch(() => ({}));
  if (r.status === 401) { location.href = './'; throw new Error('login'); }
  if (!r.ok) throw new Error(d.error || 'ผิดพลาด');
  return d;
}
const mins = s => Math.max(0, Math.floor((Date.now() - new Date(String(s).replace(' ', 'T'))) / 60000));

function load(d) {
  K = d; kVer = d.ver;
  $('kShop').textContent = 'จอครัว · ' + (d.settings.name || 'โคขุน');
  // a dish line counts as new when more of it was sent than we have seen before
  const now = new Map();
  d.tables.forEach(t => t.order.forEach(i => { if (i.sent > i.done) now.set(i.id, i.sent); }));
  if (seen && [...now].some(([id, sent]) => sent > (seen.get(id) || 0))) { pending = true; ring(true); }
  seen = now;
  draw();
}
function draw() {
  const cards = K.tables.map(t => ({ t, items: t.order.filter(i => i.sent > i.done) })).filter(x => x.items.length)
    .map(x => ({ ...x, since: x.items.reduce((m, i) => (i.at && i.at < m ? i.at : m), x.items[0].at || '') }))
    .sort((a, b) => String(a.since).localeCompare(String(b.since)));
  $('kBoard').innerHTML = cards.map(({ t, items, since }) => `<section class="kcard${since && mins(since) >= 15 ? ' late' : ''}">
      <div class="kch"><b>โต๊ะ ${esc(t.name)}</b>${t.takeaway ? '<span class="ktag ta">กลับบ้าน</span>' : ''}<span class="kmin">${since ? mins(since) + ' นาที' : ''}</span></div>
      <ul>${items.map(i => `<li><span class="kq">${i.sent - i.done}</span><span class="kn">${esc(i.name)}${i.guest ? '<span class="ktag">ลูกค้าสั่ง</span>' : ''}${i.note ? `<small>${esc(i.note)}</small>` : ''}</span>
        <button type="button" class="kok" data-item="${i.id}" data-t="${t.id}">เสร็จ</button></li>`).join('')}</ul>
      <button type="button" class="kall" data-t="${t.id}">เสร็จทั้งโต๊ะ</button>
    </section>`).join('') || '<p class="kempty">ยังไม่มีออเดอร์ค้าง 👨‍🍳</p>';
  $('kBoard').querySelectorAll('[data-item]').forEach(b => b.onclick = () => done({ table: +b.dataset.t, item: +b.dataset.item }));
  $('kBoard').querySelectorAll('.kall').forEach(b => b.onclick = () => done({ table: +b.dataset.t }));
  $('kAlert').classList.toggle('hidden', !pending);
}
async function done(body) {
  try { load(await call('k_done', body)); } catch (e) { alert(e.message); }
}
// play now, then again every 20 s until someone taps "รับทราบ"
function ring(force) {
  if (muted || !pending) return;
  if (!force && Date.now() - lastRing < 20000) return;
  lastRing = Date.now();
  playAlert(K.settings.sound, K.files);
}
function ack() { pending = false; draw(); }
$('kAlert').onclick = ack;
$('kAlert').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') ack(); };
const muteLabel = () => { $('kMute').textContent = muted ? '🔕 เสียงปิด' : '🔔 เสียงเปิด'; };
$('kMute').onclick = () => { muted = !muted; try { localStorage.setItem('kMute', muted ? '1' : '0'); } catch {} muteLabel(); if (!muted) playSound(K && K.settings.sound, K && K.files); };
muteLabel();
$('kGo').onclick = () => { $('kStart').classList.add('hidden'); playSound(K && K.settings.sound, K && K.files); };

async function poll() {
  try {
    const v = await call('ver');
    $('kSync').textContent = '● ออนไลน์'; $('kSync').className = 'ksync ok';
    if (v.ver !== kVer) load(await call('state'));
    else { draw(); ring(false); }
  } catch (e) { if (e.message !== 'login') { $('kSync').textContent = '● ออฟไลน์'; $('kSync').className = 'ksync off'; } }
}
setInterval(() => { $('kClock').textContent = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }); }, 1000);
(async () => {
  try { const d = await call('me'); if (!d.me) return (location.href = './'); load(d); } catch {}
  setInterval(poll, 3000);
})();
