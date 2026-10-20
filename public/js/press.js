// iOS Safari only applies :active (the press animation in css/press.css) when the page listens for touches
document.addEventListener('touchstart', () => {}, { passive: true });

// ripple from the touch point on every button (css/press.css .rpl); the wrapper clips it to the button's
// rounded shape without setting overflow:hidden on the button itself, so badges sticking out stay visible
document.addEventListener('pointerdown', e => {
  const b = e.target.closest('button:not(:disabled), [role="button"]:not([aria-disabled="true"])');
  if (!b || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (getComputedStyle(b).position === 'static') b.style.position = 'relative';
  const r = b.getBoundingClientRect(), size = Math.max(r.width, r.height) * 2.2;
  const wrap = document.createElement('span'), dot = document.createElement('span');
  wrap.className = 'rpl'; dot.className = 'rpl-dot';
  dot.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
  wrap.appendChild(dot); b.appendChild(wrap);
  setTimeout(() => wrap.remove(), 550);
}, { passive: true });
