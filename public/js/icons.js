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
  // order sheet
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  next: '<path d="M9 18l6-6-6-6"/>',
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
  swap: '<path d="M4 8h14l-3-3M20 16H6l3 3"/>',
  cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.7 12.4a1.5 1.5 0 0 0 1.5 1.1h8.9a1.5 1.5 0 0 0 1.4-1.1L22 7H6"/>',
  wallet: '<path d="M3 7a2 2 0 0 1 2-2h12v4"/><path d="M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2z"/><circle cx="16" cy="14.5" r="1.2"/>',
  printer: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  percent: '<circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/><path d="M19 5L5 19"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  bill: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  qr: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3z"/><path d="M14 14h3v3h-3zM18 18h3v3h-3zM14 20h2M20 14v2"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
  // food categories
  cloche: '<path d="M3 18h18"/><path d="M5 18a7 7 0 0 1 14 0"/><path d="M12 9V7M10 7h4"/>',
  drink: '<path d="M6 7h12l-1.5 13a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1z"/><path d="M14 7l2-5h2"/><path d="M7 11h10"/>',
  steak: '<path d="M4 13c0-4.5 4-8 9-8 4.4 0 7 2.5 7 6 0 4.8-4.3 8-9.5 8C6.4 19 4 16.6 4 13z"/><path d="M8.5 13.5c0-1.8 1.6-3.2 3.5-3.2 1.7 0 2.8 1 2.8 2.4"/><circle cx="16" cy="11" r="1"/>',
  cow: '<path d="M4 9l-2-2M20 9l2-2"/><path d="M5 8h14v5a5 5 0 0 1-5 5h-4a5 5 0 0 1-5-5z"/><path d="M8 18v3M16 18v3"/><circle cx="9.5" cy="12" r=".8"/><circle cx="14.5" cy="12" r=".8"/><path d="M10 15h4"/>',
  pig: '<path d="M4 12c0-4 3.6-7 8-7s8 3 8 7-3.6 7-8 7-8-3-8-7z"/><path d="M6 6L4 3M18 6l2-3"/><ellipse cx="12" cy="14" rx="3" ry="2"/><path d="M11 14h.01M13 14h.01"/><circle cx="9" cy="10" r=".8"/><circle cx="15" cy="10" r=".8"/>',
  leaf: '<path d="M5 20c0-8 5-14 15-15-1 10-7 15-15 15z"/><path d="M5 20l9-9"/>',
  fish: '<path d="M2 12c3-4 7-6 11-6 4 0 7 3 9 6-2 3-5 6-9 6-4 0-8-2-11-6z"/><path d="M2 12l-0 0M6 9l-3-3v12l3-3"/><circle cx="16" cy="11" r=".9"/>',
  sweet: '<path d="M7 11a5 5 0 0 1 10 0"/><path d="M5 11h14l-5 10h-4z"/>',
  dots: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
};
// best icon for a menu category name (categories are free text typed by the owner)
const catIcon = cat => {
  const c = String(cat || '');
  if (!c.trim()) return 'cloche';
  if (/เครื่องดื่ม|น้ำ|เบียร์|ชา|กาแฟ|โซดา/.test(c)) return 'drink';
  if (/วัว|โคขุน/.test(c)) return 'cow';
  if (/หมู|สามชั้น|เบคอน/.test(c)) return 'pig';
  if (/ผัก|ยำ|ส้มตำ|อีสาน/.test(c)) return 'leaf';
  if (/ทะเล|กุ้ง|ปลา|หมึก/.test(c)) return 'fish';
  if (/หวาน|ไอศกรีม/.test(c)) return 'sweet';
  if (/เนื้อ|ย่าง|ปิ้ง|steak|ริบอาย|ใบพาย|น่อง|สัน|เสือ|เต้า|ลิ้น/i.test(c)) return 'steak';
  if (/ชุด|เซ็ต|set|รวม/i.test(c)) return 'cloche';
  return 'dots';
};
const icon = (name, cls = '') =>
  `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;
document.querySelectorAll('[data-ic]').forEach(el => { el.outerHTML = icon(el.dataset.ic); });
