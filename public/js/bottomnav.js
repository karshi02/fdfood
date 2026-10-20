/* ---------- phone bottom navbar ----------
   A copy of the header tabs, shown on phones only (css/bottomnav.css).
   It is a <nav>, so showTab()'s "nav button" handling, the click binding in
   core.js and the [data-perm] gating in render() all apply to it unchanged.
   Hides while scrolling down, comes back on scroll up / near the top / at the end. */
(() => {
  const top = document.querySelector('header nav');
  const bar = document.createElement('nav');
  bar.className = 'bnav';
  bar.id = 'bnav';
  bar.setAttribute('aria-label', 'เมนูหลัก');
  bar.innerHTML = top.innerHTML.replace('id="menuBadge"', 'id="menuBadge2"');
  document.body.appendChild(bar);

  // keep the second badge in step with the header one (render() updates #menuBadge)
  const src = document.getElementById('menuBadge'), dst = document.getElementById('menuBadge2');
  new MutationObserver(() => { dst.textContent = src.textContent; dst.className = src.className; })
    .observe(src, { childList: true, characterData: true, subtree: true, attributes: true });

  let lastY = window.scrollY, ticking = false;
  const show = on => bar.classList.toggle('away', !on);
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY, atEnd = window.innerHeight + y >= document.documentElement.scrollHeight - 4;
      if (y < 60 || atEnd || y < lastY - 6) show(true);
      else if (y > lastY + 6) show(false);
      lastY = y; ticking = false;
    });
  }, { passive: true });

  // switching tab: start the new page at the top with the bar visible
  bar.addEventListener('click', e => { if (e.target.closest('button')) { window.scrollTo(0, 0); show(true); } });
})();
