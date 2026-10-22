/* ---------- phone back gesture / back button: close what's open, then go to the tables tab; never leave the app ----------
   The page keeps one spare history entry. Back uses it up (popstate), we undo one step of the UI and add it again.
   Chrome skips entries added without a tap when going back, so the spare entry is also re-added on the next tap. */
let backSpare = false;
const pushSpare = () => { history.pushState({ pos: 'app' }, ''); backSpare = true; };
pushSpare();
addEventListener('pointerdown', () => { if (!backSpare) pushSpare(); }, true);
addEventListener('popstate', () => {
  backSpare = false;
  const shown = id => $(id) && !$(id).classList.contains('hidden');
  if (shown('calSheet')) $('calSheet').classList.add('hidden');
  else if (shown('acctMenu')) $('acctMenu').classList.add('hidden');
  else if (shown('billView')) $('billView').classList.add('hidden');
  else if (shown('printerPanel')) $('printerPanel').classList.add('hidden');
  else if (shown('modal')) closeModal();
  else if (ME && !shown('login') && !shown('tab-tables')) showTab('tables');
  else toast('อยู่หน้าโต๊ะแล้ว — ปิดแอปจากปุ่มของเบราว์เซอร์');
  pushSpare();
});
