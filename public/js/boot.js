/* ---------- boot ---------- */
(async () => {
  try {
    const d = await (await fetch('api.php?a=me')).json();
    setStatus(true);
    if (d.me) { apply(d); nagWeak(); } else showLogin();
  } catch { setStatus(false); showLogin(); }
  setInterval(poll, 3000);
  setInterval(() => { if (ME && !cur) renderTables(); }, 60000);
})();
