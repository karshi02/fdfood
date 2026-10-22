/* ---------- guest ordering from the table QR: pick dishes, send them straight to the kitchen ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const baht = n => Number(n).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const TOKEN = new URLSearchParams(location.search).get('t') || '';
const CART_KEY = 'gcart_' + TOKEN;
let G = null, cat = '', cart = [], pin = '', sending = false;
try { cart = JSON.parse(localStorage.getItem(CART_KEY) || '[]'); } catch {}
const saveCart = () => { try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch {} };
const dish = id => G.menu.find(m => m.id === id);

function toast(msg) {
  $('gToast').textContent = msg; $('gToast').classList.remove('hidden');
  clearTimeout(toast.t); toast.t = setTimeout(() => $('gToast').classList.add('hidden'), 3000);
}
async function load() {
  try {
    const r = await fetch('api.php?a=g_menu&t=' + encodeURIComponent(TOKEN));
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'โหลดเมนูไม่ได้');
    G = d;
    // a dish removed or sold out since it went in the cart drops out
    cart = cart.filter(l => dish(l.menu) && !dish(l.menu).out);
    draw();
  } catch (e) {
    $('gShop').textContent = 'สั่งอาหาร';
    $('gMain').innerHTML = `<div class="gmsg"><b>${esc(e.message)}</b><button type="button" onclick="location.reload()">ลองใหม่</button></div>`;
  }
}
function draw() {
  $('gShop').textContent = G.shop || 'สั่งอาหาร';
  $('gTable').textContent = 'โต๊ะ ' + G.table;
  if (!G.open) {
    $('gMain').innerHTML = `<div class="gmsg"><b>โต๊ะนี้ยังไม่เปิด</b><p>เรียกพนักงานเพื่อเปิดโต๊ะก่อน แล้วกดรีเฟรช</p><button type="button" onclick="location.reload()">รีเฟรช</button></div>`;
    $('gCartBar').classList.add('hidden');
    return;
  }
  const cats = [...new Set(G.menu.map(m => m.cat).filter(Boolean))];
  const list = G.menu.filter(m => !cat || m.cat === cat);
  $('gMain').innerHTML = `
    <div class="gcats">${['', ...cats].map(k => `<button type="button" class="gchip ${k === cat ? 'on' : ''}" data-cat="${esc(k)}">${esc(k || 'ทั้งหมด')}</button>`).join('')}</div>
    <div class="ggrid">${list.map(m => {
      const n = cart.filter(l => l.menu === m.id).reduce((a, l) => a + l.qty, 0);
      return `<button type="button" class="gdish${m.out ? ' out' : ''}" data-add="${m.id}" ${m.out ? 'disabled' : ''}>
        <span class="gimg">${m.image ? `<img src="${esc(m.image)}" alt="" loading="lazy">` : '🍽️'}</span>
        <span class="gname">${esc(m.name)}</span>
        <span class="gprice">${m.out ? 'หมด' : '฿' + baht(m.price)}</span>
        ${n ? `<span class="gn">${n}</span>` : '<span class="gplus">+</span>'}</button>`;
    }).join('') || '<p class="gnone">ไม่มีเมนู</p>'}</div>
    ${G.order.length ? `<section class="gdone"><h3>สั่งแล้ว</h3>${G.order.map(i => `<div><span>${i.qty} × ${esc(i.name)}</span>${i.note ? `<small>${esc(i.note)}</small>` : ''}</div>`).join('')}</section>` : ''}`;
  $('gMain').querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { cat = b.dataset.cat; draw(); });
  $('gMain').querySelectorAll('[data-add]').forEach(b => b.onclick = () => add(+b.dataset.add));
  bar();
}
function add(id) {
  const l = cart.find(x => x.menu === id && !x.note);
  if (l) l.qty = Math.min(20, l.qty + 1); else cart.push({ menu: id, qty: 1, note: '' });
  saveCart(); draw();
}
function bar() {
  const n = cart.reduce((a, l) => a + l.qty, 0), sum = cart.reduce((a, l) => a + l.qty * dish(l.menu).price, 0);
  $('gCartBar').classList.toggle('hidden', !n);
  $('gCartBar').innerHTML = `<span class="gbn">${n}</span><span>ดูตะกร้า / ส่งออเดอร์</span><b>฿${baht(sum)}</b>`;
}
$('gCartBar').onclick = () => { $('gCart').classList.remove('hidden'); drawCart(); };
$('gCart').onclick = e => { if (e.target.id === 'gCart') $('gCart').classList.add('hidden'); };
function drawCart() {
  const sum = cart.reduce((a, l) => a + l.qty * dish(l.menu).price, 0);
  $('gCartIn').innerHTML = `<div class="gsh"><b>ตะกร้า</b><button type="button" id="gClose" aria-label="ปิด">✕</button></div>
    ${cart.map((l, i) => `<div class="gline"><div><b>${esc(dish(l.menu).name)}</b><span>฿${baht(dish(l.menu).price * l.qty)}</span>
      <input data-note="${i}" placeholder="หมายเหตุ เช่น ไม่เผ็ด" maxlength="100" value="${esc(l.note)}"></div>
      <div class="gqty"><button type="button" data-q="${i}" data-d="-1" aria-label="ลด">−</button><span>${l.qty}</span><button type="button" data-q="${i}" data-d="1" aria-label="เพิ่ม">+</button></div></div>`).join('')
      || '<p class="gnone">ตะกร้าว่าง</p>'}
    ${G.pinNeeded ? `<label class="gpin">รหัสโต๊ะ 4 หลัก (ถามพนักงาน)<input id="gPin" inputmode="numeric" maxlength="4" pattern="[0-9]*" value="${esc(pin)}"></label>` : ''}
    <div class="gsum"><span>รวม</span><b>฿${baht(sum)}</b></div>
    <button type="button" id="gSend" class="gsend" ${cart.length ? '' : 'disabled'}>ส่งออเดอร์เข้าครัว</button>
    <p class="ghint">ชำระเงินกับพนักงานตอนเช็คบิล</p>`;
  $('gClose').onclick = () => $('gCart').classList.add('hidden');
  $('gCartIn').querySelectorAll('[data-q]').forEach(b => b.onclick = () => {
    const l = cart[+b.dataset.q]; l.qty += +b.dataset.d;
    if (l.qty <= 0) cart.splice(+b.dataset.q, 1); else l.qty = Math.min(20, l.qty);
    saveCart(); drawCart(); draw();
  });
  $('gCartIn').querySelectorAll('[data-note]').forEach(x => x.oninput = () => { cart[+x.dataset.note].note = x.value; saveCart(); });
  if ($('gPin')) $('gPin').oninput = e => { pin = e.target.value.replace(/\D/g, ''); };
  $('gSend').onclick = send;
}
async function send() {
  if (sending || !cart.length) return;
  if (G.pinNeeded && !/^\d{4}$/.test(pin)) return toast('ใส่รหัสโต๊ะ 4 หลัก');
  sending = true; $('gSend').disabled = true; $('gSend').textContent = 'กำลังส่ง…';
  try {
    const r = await fetch('api.php?a=g_order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: TOKEN, pin, items: cart }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'ส่งไม่สำเร็จ');
    cart = []; saveCart();
    $('gCart').classList.add('hidden');
    toast('ส่งเข้าครัวแล้ว ✓ รอสักครู่นะคะ');
    await load();
  } catch (e) { toast(e.message); }
  finally { sending = false; if ($('gSend')) { $('gSend').disabled = !cart.length; $('gSend').textContent = 'ส่งออเดอร์เข้าครัว'; } }
}
load();
setInterval(() => { if (G && $('gCart').classList.contains('hidden')) load(); }, 20000);
