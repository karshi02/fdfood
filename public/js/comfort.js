/* ---------- โหมดสบายตา: dim, warm colours; remembered on this device (index.html <head> applies it before first paint) ---------- */
$('eyeBtn').onclick = () => {
  const on = document.documentElement.classList.toggle('eye');
  try { localStorage.setItem('eye', on ? '1' : '0'); } catch {}
  toast(on ? 'เปิดโหมดสบายตาแล้ว' : 'ปิดโหมดสบายตาแล้ว');
};
