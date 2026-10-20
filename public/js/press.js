// iOS Safari only applies :active (the press animation in css/press.css) when the page listens for touches
document.addEventListener('touchstart', () => {}, { passive: true });
