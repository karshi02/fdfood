/* ---------- boot ---------- */
// opening animation: shown at least 1.3 s so it plays through, gone as soon as the first data is in (or after 4 s anyway)
const splashStart = Date.now();
(() => {
  const box = $('splash');
  for (let i = 0; i < 14; i++) {
    const e = document.createElement('span');
    e.className = 'sp-ember';
    e.style.left = Math.random() * 100 + '%';
    e.style.setProperty('--dx', (Math.random() * 80 - 40) + 'px');
    e.style.animationDelay = (Math.random() * 3).toFixed(2) + 's';
    box.appendChild(e);
  }
})();
function hideSplash() {
  const box = $('splash');
  if (!box || box.classList.contains('done')) return;
  setTimeout(() => { box.classList.add('done'); setTimeout(() => box.remove(), 600); }, Math.max(0, 1300 - (Date.now() - splashStart)));
}
setTimeout(hideSplash, 4000);
(async () => {
  try {
    const d = await (await fetch('api.php?a=me')).json();
    setStatus(true);
    if (d.me) { apply(d); nagWeak(); } else showLogin();
  } catch { setStatus(false); showLogin(); }
  hideSplash();
  setInterval(poll, 3000);
  setInterval(() => { if (ME && !cur) renderTables(); }, 60000);
})();
