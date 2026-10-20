/* ---------- inline SVG icons (stroke style, inherit currentColor) ---------- */
const ICON_PATHS = {
  table: '<path d="M3 8h18"/><path d="M4 8c0-1.7 3.6-3 8-3s8 1.3 8 3"/><path d="M6 8v11M18 8v11M9 8v7M15 8v7"/>',
  menu: '<path d="M7 3v7a2 2 0 0 0 2 2v9"/><path d="M5 3v5M9 3v5M5 8a2 2 0 0 0 4 0"/><path d="M17 3c-2 1.5-3 4-3 7h3v11"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  coins: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v4c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 10v4c0 1.7 3.1 3 7 3s7-1.3 7-3v-4"/><path d="M5 14v4c0 1.7 3.1 3 7 3s7-1.3 7-3v-4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  crown: '<path d="M2 18h20"/><path d="M3 7l4 5 5-7 5 7 4-5-2 11H5z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.3 3.1-6 7-6s7 2.7 7 6"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14c2.4.6 4 2.6 4 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  cash: '<path d="M9 3h6l-1.5 3h-3z"/><path d="M10.5 6C6 8 4 12 4 15a6 6 0 0 0 6 6h4a6 6 0 0 0 6-6c0-3-2-7-6.5-9"/><path d="M12 11v7M14 12.5c-.4-.6-1.1-1-2-1-1.1 0-2 .7-2 1.5s.9 1.3 2 1.5 2 .7 2 1.5-.9 1.5-2 1.5c-.9 0-1.6-.4-2-1"/>',
  chair: '<path d="M7 3h10v7H7z"/><path d="M5 13h14"/><path d="M7 13v8M17 13v8M7 10v3M17 10v3"/>',
  receipt: '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
};
const icon = (name, cls = '') =>
  `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;
document.querySelectorAll('[data-ic]').forEach(el => { el.outerHTML = icon(el.dataset.ic); });
