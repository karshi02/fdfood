<?php
declare(strict_types=1);
date_default_timezone_set('Asia/Bangkok');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
// behind the production nginx the browser talks https: keep the session cookie off plain http
$https = !empty($_SERVER['HTTPS']) || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
// stay signed in for 30 days of inactivity (matches session.gc_maxlifetime in the Dockerfile)
const SESSION_TTL = 2592000;
session_set_cookie_params(['lifetime' => SESSION_TTL, 'httponly' => true, 'samesite' => 'Strict', 'secure' => $https]);
session_start();
// sliding expiry: push the cookie's expiry forward on use (at most hourly, to keep responses small)
if (isset($_SESSION['uid']) && ($_SESSION['cookie_at'] ?? 0) < time() - 3600) {
    $_SESSION['cookie_at'] = time();
    setcookie(session_name(), session_id(), ['expires' => time() + SESSION_TTL, 'path' => '/', 'httponly' => true, 'samesite' => 'Strict', 'secure' => $https]);
}

class AppError extends Exception {}
function out(array $d, int $code = 200): never { http_response_code($code); echo json_encode($d, JSON_UNESCAPED_UNICODE); exit; }
function fail(string $msg, int $code = 400): never { throw new AppError($msg, $code); }

try {
    $pdo = new PDO(
        sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4', getenv('DB_HOST') ?: 'db', getenv('DB_NAME') ?: 'fdfood'),
        getenv('DB_USER') ?: 'fdfood', getenv('DB_PASS') ?: '',
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
    );
} catch (PDOException) { out(['error' => 'ต่อฐานข้อมูลไม่ได้ (MySQL ยังไม่พร้อม?)'], 503); }

function q(string $sql, array $p = []): PDOStatement { global $pdo; $s = $pdo->prepare($sql); $s->execute($p); return $s; }
function now(): string { return date('Y-m-d H:i:s'); }
// next running bill number for the Thai year of $when: 69 + 00001 -> 6900001
function next_bill_no(string $when): int {
    $base = ((int)substr($when, 0, 4) + 543) % 100 * 100000;
    return (int)q('SELECT COALESCE(MAX(bill_no), ?) + 1 FROM bills WHERE bill_no > ? AND bill_no < ? FOR UPDATE', [$base, $base, $base + 100000])->fetchColumn();
}

// run a write inside a transaction and bump the change counter clients poll
function tx(callable $f): mixed {
    global $pdo;
    $pdo->beginTransaction();
    try { $r = $f(); q("UPDATE meta SET v = v + 1 WHERE k = 'ver'"); $pdo->commit(); return $r; }
    catch (Throwable $e) { $pdo->rollBack(); throw $e; }
}

// upgrade databases created by an older init.sql (it only runs once); the schema number keeps this off the hot path
const SCHEMA = 13;
$fromSchema = (int)q("SELECT COALESCE(MAX(v), 0) FROM meta WHERE k = 'schema'")->fetchColumn();
if ($fromSchema < SCHEMA) {
    // last request time per user, for "who's online" in the staff list
    if (!q("SHOW COLUMNS FROM users LIKE 'last_seen'")->fetch()) {
        try { q('ALTER TABLE users ADD COLUMN last_seen DATETIME NULL'); }
        catch (PDOException) {} // another request added it first
    }
    // payment is now cash / transfer / other; qr and card stay valid so older bills keep their method
    if (!str_contains((string)q("SHOW COLUMNS FROM bills LIKE 'method'")->fetch()['Type'], "'other'")) {
        q("ALTER TABLE bills MODIFY method ENUM('cash','qr','transfer','card','other') NOT NULL");
    }
    // dishes added by someone without the "menu" permission wait for price approval
    if (!q("SHOW COLUMNS FROM menu LIKE 'pending'")->fetch()) {
        try { q('ALTER TABLE menu ADD COLUMN pending TINYINT(1) NOT NULL DEFAULT 0, ADD COLUMN created_by INT NULL'); }
        catch (PDOException) {} // another request added it first
    }
    if (!q("SHOW COLUMNS FROM users LIKE 'perms'")->fetch()) {
        try { q("ALTER TABLE users ADD COLUMN perms VARCHAR(200) NOT NULL DEFAULT ''"); }
        catch (PDOException) {} // another request added it first
    }
    if (!q("SHOW COLUMNS FROM dining_tables LIKE 'checked_at'")->fetch()) {
        try { q('ALTER TABLE dining_tables ADD COLUMN checked_at DATETIME NULL, ADD COLUMN checked_total DECIMAL(10,2) NULL'); }
        catch (PDOException) {} // another request added it first
    }
    q("CREATE TABLE IF NOT EXISTS expenses (
      id INT AUTO_INCREMENT PRIMARY KEY, spent_on DATE NOT NULL, cat VARCHAR(100) NOT NULL DEFAULT '', note VARCHAR(200) NOT NULL DEFAULT '',
      amount DECIMAL(10,2) NOT NULL, created_by INT NULL, created_at DATETIME NOT NULL, INDEX (spent_on)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    // schema 3 keyed this by username only; the rows are short-lived, so just recreate it
    if (q("SHOW TABLES LIKE 'login_fails'")->fetch() && q("SHOW COLUMNS FROM login_fails LIKE 'username'")->fetch()) q('DROP TABLE login_fails');
    q("CREATE TABLE IF NOT EXISTS login_fails (
      k VARCHAR(120) PRIMARY KEY, n INT NOT NULL DEFAULT 0, last_at DATETIME NOT NULL, locked_until DATETIME NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    // bill numbers run per Thai year: yy (พ.ศ.) + 5-digit counter, e.g. 6900001; number older bills in the order they were made
    if (!q("SHOW COLUMNS FROM bills LIKE 'bill_no'")->fetch()) {
        try { q('ALTER TABLE bills ADD COLUMN bill_no INT NULL UNIQUE'); }
        catch (PDOException) {} // another request added it first
    }
    foreach (q('SELECT id, created_at FROM bills WHERE bill_no IS NULL ORDER BY id')->fetchAll() as $b) {
        try { q('UPDATE bills SET bill_no = ? WHERE id = ? AND bill_no IS NULL', [next_bill_no($b['created_at']), $b['id']]); }
        catch (PDOException) {} // another request numbered it first
    }
    // guests per table, dine-in or takeaway, and when each dish was ordered (the owner may back-date it)
    if (!q("SHOW COLUMNS FROM dining_tables LIKE 'pax'")->fetch()) {
        try { q('ALTER TABLE dining_tables ADD COLUMN pax INT NULL, ADD COLUMN takeaway TINYINT(1) NOT NULL DEFAULT 0'); }
        catch (PDOException) {} // another request added it first
    }
    if (!q("SHOW COLUMNS FROM bills LIKE 'pax'")->fetch()) {
        try { q('ALTER TABLE bills ADD COLUMN pax INT NULL, ADD COLUMN takeaway TINYINT(1) NOT NULL DEFAULT 0'); }
        catch (PDOException) {} // another request added it first
    }
    if (!q("SHOW COLUMNS FROM order_items LIKE 'ordered_at'")->fetch()) {
        try { q('ALTER TABLE order_items ADD COLUMN ordered_at DATETIME NULL'); }
        catch (PDOException) {} // another request added it first
    }
    if (!q("SHOW COLUMNS FROM bill_items LIKE 'ordered_at'")->fetch()) {
        try { q('ALTER TABLE bill_items ADD COLUMN ordered_at DATETIME NULL'); }
        catch (PDOException) {} // another request added it first
    }
    // tables opened by mistake back when opening didn't need a dish: free them (a booking stays booked).
    // Only once, when coming from before schema 10: a table opened for QR ordering is now open on purpose with no dish yet
    if ($fromSchema < 10) {
        q("UPDATE dining_tables SET status = IF(resv_name IS NULL, 'free', 'resv'), opened_at = NULL, checked_at = NULL, checked_total = NULL
           WHERE status = 'busy' AND NOT EXISTS (SELECT 1 FROM order_items i WHERE i.table_id = dining_tables.id)");
    }
    q("UPDATE meta SET v = v + 1 WHERE k = 'ver'");
    // one bill paid partly in cash and partly by transfer: method 'mixed', transfer_amt = the transferred part
    if (!str_contains((string)q("SHOW COLUMNS FROM bills LIKE 'method'")->fetch()['Type'], "'mixed'")) {
        q("ALTER TABLE bills MODIFY method ENUM('cash','qr','transfer','card','other','mixed') NOT NULL");
    }
    if (!q("SHOW COLUMNS FROM bills LIKE 'transfer_amt'")->fetch()) {
        try { q('ALTER TABLE bills ADD COLUMN transfer_amt DECIMAL(10,2) NULL'); }
        catch (PDOException) {} // another request added it first
    }
    // dish photos: kept in the database (small JPEGs resized on the phone) so backups include them and deploys never touch them
    q("CREATE TABLE IF NOT EXISTS menu_images (
      menu_id INT PRIMARY KEY, data MEDIUMBLOB NOT NULL, mime VARCHAR(20) NOT NULL, ver INT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    // QR ordering: a fixed token per table (the sticker), a 4-digit PIN per seating, tables opened for guests to order,
    // and guest dishes go straight to the kitchen screen, which marks them done
    if (!q("SHOW COLUMNS FROM dining_tables LIKE 'qr_token'")->fetch()) {
        try { q('ALTER TABLE dining_tables ADD COLUMN qr_token CHAR(16) NULL UNIQUE, ADD COLUMN pin CHAR(4) NULL, ADD COLUMN guest_open TINYINT(1) NOT NULL DEFAULT 0, ADD COLUMN guest_last DATETIME NULL'); }
        catch (PDOException) {} // another request added it first
    }
    foreach (q('SELECT id FROM dining_tables WHERE qr_token IS NULL')->fetchAll() as $t) q('UPDATE dining_tables SET qr_token = ? WHERE id = ? AND qr_token IS NULL', [bin2hex(random_bytes(8)), $t['id']]);
    if (!q("SHOW COLUMNS FROM order_items LIKE 'by_guest'")->fetch()) {
        try { q('ALTER TABLE order_items ADD COLUMN by_guest TINYINT(1) NOT NULL DEFAULT 0, ADD COLUMN done INT NOT NULL DEFAULT 0'); }
        catch (PDOException) {} // another request added it first
    }
    // shop QR picture and kitchen alert sounds; transfer slips kept with their bill for 90 days
    q("CREATE TABLE IF NOT EXISTS files (
      k VARCHAR(40) PRIMARY KEY, name VARCHAR(100) NOT NULL DEFAULT '', data MEDIUMBLOB NOT NULL, mime VARCHAR(40) NOT NULL, ver INT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    q("CREATE TABLE IF NOT EXISTS bill_slips (
      bill_id INT PRIMARY KEY, data MEDIUMBLOB NOT NULL, mime VARCHAR(20) NOT NULL, created_at DATETIME NOT NULL, INDEX (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    q("INSERT INTO meta (k, v) VALUES ('schema', ?) ON DUPLICATE KEY UPDATE v = GREATEST(v, VALUES(v))", [SCHEMA]);
}

const DEFAULT_PASS = 'admin1234';
const MAX_MONEY = 9999999; // DECIMAL(10,2) overflows past 99,999,999.99; anything near this is a typo
function money($v, bool $zeroOk = true): ?float {
    if (!is_numeric($v)) return null;
    $v = round((float)$v, 2);
    return ($zeroOk ? $v >= 0 : $v > 0) && $v <= MAX_MONEY ? $v : null;
}

// first run: create the owner account
if (!q('SELECT COUNT(*) FROM users')->fetchColumn()) {
    q('INSERT INTO users (username, pass_hash, name, role) VALUES (?, ?, ?, ?)',
        ['admin', password_hash(DEFAULT_PASS, PASSWORD_DEFAULT), 'เจ้าของร้าน', 'admin']);
}

// every account can order, take payment and mark dishes out of stock; these are the extras an owner grants per user
const PERMS = [
    'menu' => 'แก้ / ลบเมนูและราคา', 'discount' => 'ให้ส่วนลด', 'reduce' => 'ลดรายการที่ส่งครัวแล้ว',
    'report' => 'ดูยอดขาย / แดชบอร์ด / รายจ่าย', 'void' => 'ยกเลิกบิล', 'settings' => 'ตั้งค่าร้าน / จัดการโต๊ะ', 'users' => 'จัดการผู้ใช้',
];
// role 'admin' is the owner: always every permission, so the shop can't lock itself out
function perms_of(array $u): array {
    if ($u['role'] === 'admin') return array_keys(PERMS);
    return array_values(array_intersect(array_keys(PERMS), explode(',', (string)($u['perms'] ?? ''))));
}

// sessions last 30 days, so a password change must end the user's other sessions:
// each session remembers a fingerprint of the hash it logged in with
function pass_tag(string $hash): string { return substr(hash('sha256', $hash), 0, 16); }
$me = null;
if (isset($_SESSION['uid'])) {
    $me = q('SELECT id, username, name, role, perms, pass_hash FROM users WHERE id = ? AND active = 1', [$_SESSION['uid']])->fetch() ?: null;
    if ($me) {
        $tag = pass_tag($me['pass_hash']);
        unset($me['pass_hash']); // $me goes to the browser in state()
        $_SESSION['ph'] ??= $tag; // sessions from before this check: adopt, don't log everyone out
        if ($_SESSION['ph'] !== $tag) { $_SESSION = []; $me = null; }
    }
    if ($me) { $me['id'] = (int)$me['id']; $me['perms'] = perms_of($me); $me['weak'] = !empty($_SESSION['weak']); }
    // every open screen polls every 3 s; write at most once a minute per user
    if ($me) q('UPDATE users SET last_seen = NOW() WHERE id = ? AND (last_seen IS NULL OR last_seen < NOW() - INTERVAL 60 SECOND)', [$me['id']]);
}
function can(string $perm): bool { global $me; return $me && in_array($perm, $me['perms'], true); }
function need(string $perm = ''): void {
    global $me;
    if (!$me) fail('กรุณาเข้าสู่ระบบ', 401);
    // the default password is public: nothing works until it is changed
    if ($me['weak']) fail('ต้องเปลี่ยนรหัสผ่านเริ่มต้นก่อนใช้งาน (ปุ่ม "เปลี่ยนรหัส")', 403);
    if ($perm !== '' && !can($perm)) fail('ไม่มีสิทธิ์: ' . PERMS[$perm] . ' — ให้เจ้าของร้านเปิดสิทธิ์ให้', 403);
}

function settings(): array {
    $s = [];
    foreach (q('SELECT k, v FROM settings') as $r) $s[$r['k']] = $r['v'];
    return $s;
}

function calc(array $items, ?string $dtype, $dval, array $s): array {
    $sub = 0.0;
    foreach ($items as $i) $sub += (float)$i['price'] * (int)$i['qty'];
    $disc = $dtype === 'pct' ? $sub * (float)$dval / 100 : ($dtype === 'amt' ? (float)$dval : 0.0);
    $disc = round(min($sub, max(0, $disc)), 2);
    $service = round(($sub - $disc) * (float)($s['service'] ?? 0) / 100, 2);
    $vat = round(($sub - $disc + $service) * (float)($s['vat'] ?? 0) / 100, 2);
    return ['sub' => round($sub, 2), 'disc' => $disc, 'service' => $service, 'vat' => $vat, 'total' => round($sub - $disc + $service + $vat, 2)];
}

function ver(): int { return (int)q("SELECT v FROM meta WHERE k = 'ver'")->fetchColumn(); }

function state(): array {
    global $me;
    $byTable = [];
    foreach (q('SELECT * FROM order_items ORDER BY id') as $i) {
        $byTable[$i['table_id']][] = ['id' => (int)$i['id'], 'menuId' => $i['menu_id'] === null ? null : (int)$i['menu_id'],
            'name' => $i['name'], 'price' => (float)$i['price'], 'qty' => (int)$i['qty'], 'sent' => (int)$i['sent'], 'note' => $i['note'], 'at' => $i['ordered_at'], 'guest' => (bool)$i['by_guest'], 'done' => (int)$i['done']];
    }
    $tables = [];
    foreach (q('SELECT * FROM dining_tables ORDER BY sort, id') as $t) {
        $tables[] = ['id' => (int)$t['id'], 'name' => $t['name'], 'status' => $t['status'],
            'resv' => $t['resv_name'] === null ? null : ['name' => $t['resv_name'], 'phone' => $t['resv_phone'], 'time' => $t['resv_time'], 'pax' => $t['resv_pax']],
            'openedAt' => $t['opened_at'], 'pax' => $t['pax'] === null ? null : (int)$t['pax'], 'takeaway' => (bool)$t['takeaway'],
            'discount' => $t['disc_type'] ? ['type' => $t['disc_type'], 'value' => (float)$t['disc_value']] : null,
            'checked' => $t['checked_at'] === null ? null : ['at' => $t['checked_at'], 'total' => (float)$t['checked_total']],
            'qr' => $t['qr_token'], 'pin' => $t['pin'], 'guestOpen' => (bool)$t['guest_open'],
            'order' => $byTable[$t['id']] ?? []];
    }
    $menu = [];
    // the photo URL carries its version, so browsers cache it forever and fetch again only after a change
    foreach (q('SELECT m.*, u.name AS by_name, i.ver AS img_ver FROM menu m LEFT JOIN users u ON u.id = m.created_by LEFT JOIN menu_images i ON i.menu_id = m.id WHERE m.active = 1 ORDER BY m.id') as $m) {
        $menu[] = ['id' => (int)$m['id'], 'name' => $m['name'], 'price' => (float)$m['price'], 'cat' => $m['cat'], 'out' => (bool)$m['out_of_stock'],
            'pending' => (bool)$m['pending'], 'by' => $m['pending'] ? (string)$m['by_name'] : '',
            'image' => $m['img_ver'] === null ? null : "api.php?a=img&id={$m['id']}&v={$m['img_ver']}"];
    }
    $files = array_map(fn($f) => ['k' => $f['k'], 'name' => $f['name'], 'url' => "api.php?a=file&k={$f['k']}&v={$f['ver']}"],
        q('SELECT k, name, ver FROM files ORDER BY k')->fetchAll());
    return ['ver' => ver(), 'me' => $me, 'permList' => PERMS, 'settings' => settings(), 'menu' => $menu, 'tables' => $tables, 'files' => $files];
}

function bill_out(array $b): array {
    $items = q('SELECT name, price, qty, note FROM bill_items WHERE bill_id = ? ORDER BY id', [$b['id']])->fetchAll();
    return ['no' => (int)$b['id'], 'bno' => (int)($b['bill_no'] ?? 0), 'table' => $b['table_name'], 'date' => $b['created_at'],
        'items' => array_map(fn($i) => ['name' => $i['name'], 'price' => (float)$i['price'], 'qty' => (int)$i['qty'], 'note' => $i['note']], $items),
        'sub' => (float)$b['sub'], 'disc' => (float)$b['disc'], 'service' => (float)$b['service'], 'vat' => (float)$b['vat'], 'total' => (float)$b['total'],
        'servicePct' => (float)$b['service_pct'], 'vatPct' => (float)$b['vat_pct'], 'method' => $b['method'],
        'transfer' => $b['transfer_amt'] === null ? null : (float)$b['transfer_amt'],
        'cash' => $b['cash'] === null ? null : (float)$b['cash'], 'change' => $b['change_amt'] === null ? null : (float)$b['change_amt'],
        'slip' => q('SELECT 1 FROM bill_slips WHERE bill_id = ?', [$b['id']])->fetchColumn() ? "api.php?a=slip&no={$b['id']}" : null,
        'void' => (bool)$b['void'], 'cashier' => $b['cashier'] ?? '', 'pax' => $b['pax'] === null ? null : (int)$b['pax'], 'takeaway' => (bool)$b['takeaway']];
}

function lock_table(int $id): array {
    return q('SELECT * FROM dining_tables WHERE id = ? FOR UPDATE', [$id])->fetch() ?: fail('ไม่พบโต๊ะ');
}
// staff always get the current time; only the owner may key in another date-time (e.g. sales written down on paper)
function when(array $in, string $k): string {
    global $me;
    $v = str_replace('T', ' ', str($in, $k, 16));
    if ($v === '' || $me['role'] !== 'admin') return now();
    if (!preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/', $v) || !strtotime($v)) fail('วันเวลาไม่ถูกต้อง (เช่น 2026-10-20 18:30)');
    return $v . ':00';
}
// a table only counts as open once a dish goes on it: the first dish opens a free or booked table
// with the guest count and dine-in/takeaway picked on the open-table form
function open_on_first_dish(array $t, array $in): void {
    if ($t['status'] === 'busy') return;
    $pax = (int)($in['pax'] ?? $t['resv_pax'] ?? 0);
    q("UPDATE dining_tables SET status = 'busy', opened_at = ?, pax = ?, takeaway = ?, pin = ? WHERE id = ?",
        [when($in, 'opened'), $pax > 0 ? min(999, $pax) : null, empty($in['takeaway']) ? 0 : 1, new_pin(), $t['id']]);
}
function new_pin(): string { return str_pad((string)random_int(0, 9999), 4, '0', STR_PAD_LEFT); }
// a data: URL from the browser -> [bytes, mime]; images are checked by their content, not by what the browser claims
function data_url(string $raw, array $types, int $max): array {
    if (!preg_match('#^data:([a-z]+/[a-z0-9.+-]+);base64,#', $raw, $m) || !in_array($m[1], $types, true)) fail('ชนิดไฟล์ไม่รองรับ');
    $bin = base64_decode(substr($raw, strlen($m[0])), true);
    if ($bin === false || $bin === '') fail('ไฟล์เสีย');
    if (strlen($bin) > $max) fail('ไฟล์ใหญ่เกินไป (ไม่เกิน ' . round($max / 1000) . ' KB)');
    if (str_starts_with($m[1], 'image/')) {
        $info = @getimagesizefromstring($bin);
        if (!$info || !in_array($info['mime'], $types, true)) fail('ไฟล์รูปไม่ถูกต้อง');
        return [$bin, $info['mime']];
    }
    return [$bin, $m[1]];
}
const IMG_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const SOUND_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/webm'];
// lock the table first, then the item: same order as pay/kitchen, so no deadlock
function lock_item(int $id): array {
    $gone = 'ไม่พบรายการ (อาจถูกแก้จากเครื่องอื่น)';
    $tid = q('SELECT table_id FROM order_items WHERE id = ?', [$id])->fetchColumn() ?: fail($gone);
    lock_table((int)$tid);
    $i = q('SELECT * FROM order_items WHERE id = ? FOR UPDATE', [$id])->fetch() ?: fail($gone);
    if ((int)$i['table_id'] !== (int)$tid) fail($gone);
    return $i;
}
// a table with a dish whose price nobody has approved yet can't be billed
function no_pending(int $tableId): void {
    $n = q('SELECT DISTINCT m.name FROM order_items i JOIN menu m ON m.id = i.menu_id WHERE i.table_id = ? AND m.pending = 1', [$tableId])->fetchAll(PDO::FETCH_COLUMN);
    if ($n) fail('รออนุมัติราคา: ' . implode(', ', $n) . ' — ให้คนที่มีสิทธิ์ "แก้เมนู" อนุมัติในแท็บเมนูก่อน');
}
// the cashier confirmed the total on screen; if another device changed the order since, stop instead of billing a different amount.
// 5 satang slack: JS and PHP can round a half-satang differently, which must never block a payment
function same_total(array $in, float $total): void {
    if (isset($in['expect']) && abs((float)$in['expect'] - $total) > 0.05) {
        fail('ยอดเปลี่ยนเป็น ฿' . number_format($total, 2) . ' (มีการแก้รายการจากเครื่องอื่น) — ตรวจรายการแล้วกดอีกครั้ง', 409);
    }
}
// approving fixes the price on the menu and on every open order that already has the dish
function approve_menu(int $id, float $price): void {
    q('UPDATE menu SET price = ?, pending = 0 WHERE id = ?', [$price, $id]);
    q('UPDATE order_items SET price = ? WHERE menu_id = ?', [$price, $id]);
}
const CLEAR_TABLE ="status = 'free', resv_name = NULL, resv_phone = NULL, resv_time = NULL, resv_pax = NULL, opened_at = NULL, pax = NULL, takeaway = 0, pin = NULL, guest_open = 0, disc_type = NULL, disc_value = NULL, checked_at = NULL, checked_total = NULL";
// in production only nginx can reach the app (it listens on 127.0.0.1), so trust its X-Real-IP when the peer is a private address
function client_ip(): string {
    $peer = $_SERVER['REMOTE_ADDR'] ?? '';
    $real = $_SERVER['HTTP_X_REAL_IP'] ?? '';
    $public = filter_var($peer, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE);
    return !$public && filter_var($real, FILTER_VALIDATE_IP) ? $real : $peer;
}
function str(array $in, string $k, int $max = 150): string { return mb_substr(trim((string)($in[$k] ?? '')), 0, $max); }
// the table behind a QR sticker (?t= or "t" in the body)
function guest_table(): array {
    global $in;
    $tok = (string)($_GET['t'] ?? $in['t'] ?? '');
    if (!preg_match('/^[0-9a-f]{16}$/', $tok)) fail('QR ไม่ถูกต้อง', 404);
    return q('SELECT * FROM dining_tables WHERE qr_token = ?', [$tok])->fetch() ?: fail('QR นี้ใช้ไม่ได้แล้ว — สแกน QR บนโต๊ะใหม่', 404);
}

$a = $_GET['a'] ?? '';
$in = [];
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!str_starts_with($_SERVER['CONTENT_TYPE'] ?? '', 'application/json')) out(['error' => 'bad request'], 400);
    $in = json_decode(file_get_contents('php://input'), true);
    if (!is_array($in)) $in = [];
} elseif (!in_array($a, ['state', 'ver', 'bills', 'dash', 'users', 'me', 'img', 'file', 'slip', 'g_menu'], true)) {
    out(['error' => 'ต้องใช้ POST'], 405);
}

try {
    $extra = [];
    switch ($a) {
    /* ---------- auth ---------- */
    case 'me':
        out($me ? state() : ['me' => null]);
    case 'login':
        $username = str($in, 'username', 50);
        $pass = (string)($in['password'] ?? '');
        // the site is on the internet: lock this user from this IP after 5 misses, and the whole IP after 30.
        // keying by IP too means an outsider can't lock the owner out of the shop's own devices
        $ip = client_ip();
        $limits = ["u:$username|$ip" => 5, "ip:$ip" => 30];
        $lock = q('SELECT MAX(locked_until) FROM login_fails WHERE k IN (?, ?) AND locked_until > ?', [...array_keys($limits), now()])->fetchColumn();
        if ($lock) fail('ใส่รหัสผิดหลายครั้ง — ลองใหม่หลัง ' . substr($lock, 11, 5) . ' น.', 429);
        $u = q('SELECT * FROM users WHERE username = ? AND active = 1', [$username])->fetch();
        if (!$u || !password_verify($pass, $u['pass_hash'])) {
            $t = now();
            foreach ($limits as $k => $max) {
                // misses more than 15 minutes apart don't add up
                q('INSERT INTO login_fails (k, n, last_at) VALUES (?, 1, ?)
                   ON DUPLICATE KEY UPDATE n = IF(last_at < ? - INTERVAL 15 MINUTE, 1, n + 1), last_at = VALUES(last_at)', [$k, $t, $t]);
                q('UPDATE login_fails SET n = 0, locked_until = ? + INTERVAL 5 MINUTE WHERE k = ? AND n >= ?', [$t, $k, $max]);
            }
            q('DELETE FROM login_fails WHERE last_at < ? - INTERVAL 1 DAY AND (locked_until IS NULL OR locked_until < ?)', [$t, $t]);
            fail('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', 401);
        }
        q('DELETE FROM login_fails WHERE k = ?', ["u:$username|$ip"]);
        session_regenerate_id(true);
        $_SESSION['uid'] = (int)$u['id'];
        $_SESSION['ph'] = pass_tag($u['pass_hash']);
        $_SESSION['weak'] = $pass === DEFAULT_PASS;
        $me = ['id' => (int)$u['id'], 'username' => $u['username'], 'name' => $u['name'], 'role' => $u['role'], 'perms' => perms_of($u), 'weak' => $_SESSION['weak']];
        out(state());
    case 'logout':
        if ($me) q('UPDATE users SET last_seen = NULL WHERE id = ?', [$me['id']]); // show offline right away
        session_destroy();
        out(['me' => null]);
    case 'password':
        if (!$me) fail('กรุณาเข้าสู่ระบบ', 401);
        $u = q('SELECT pass_hash FROM users WHERE id = ?', [$me['id']])->fetch();
        if (!password_verify((string)($in['old'] ?? ''), $u['pass_hash'])) fail('รหัสเดิมไม่ถูกต้อง');
        $new = (string)($in['new'] ?? '');
        if (mb_strlen($new) < 4) fail('รหัสใหม่ต้องยาวอย่างน้อย 4 ตัว');
        if ($new === DEFAULT_PASS) fail('ห้ามใช้รหัสเริ่มต้น');
        $hash = password_hash($new, PASSWORD_DEFAULT);
        q('UPDATE users SET pass_hash = ? WHERE id = ?', [$hash, $me['id']]);
        // this session stays signed in; the user's other devices are signed out
        $_SESSION['ph'] = pass_tag($hash);
        $_SESSION['weak'] = false;
        out(['ok' => true]);

    case 'state': need(); out(state());
    // build: the live release folder (releases/<git hash> on prod), so open screens notice a deploy and reload
    case 'ver': need(); out(['ver' => ver(), 'build' => basename(realpath(__DIR__))]);

    /* ---------- tables (staff) ---------- */
    case 'resv_save':
        need();
        tx(function () use ($in) {
            $t = lock_table((int)($in['table'] ?? 0));
            if ($t['status'] === 'busy') fail('โต๊ะมีลูกค้าอยู่');
            // the form no longer asks for name/phone; '' (not NULL) still marks the table as reserved
            q("UPDATE dining_tables SET status = 'resv', resv_name = ?, resv_phone = ?, resv_time = ?, resv_pax = ? WHERE id = ?",
                [str($in, 'name', 100), str($in, 'phone', 30), str($in, 'time', 20), min(999, max(1, (int)($in['pax'] ?? 1))), $t['id']]);
        });
        break;
    case 'resv_cancel':
        need();
        tx(fn() => q("UPDATE dining_tables SET " . CLEAR_TABLE . " WHERE id = ? AND status = 'resv'", [(int)($in['table'] ?? 0)]));
        break;
    case 'open':
        need();
        tx(function () use ($in) {
            $t = lock_table((int)($in['table'] ?? 0));
            if ($t['status'] !== 'busy') q("UPDATE dining_tables SET status = 'busy', opened_at = ? WHERE id = ?", [now(), $t['id']]);
        });
        break;
    case 'open_qr':
        // seat guests who will order by scanning the table's QR: the table opens now, without a dish
        need();
        tx(function () use ($in) {
            $t = lock_table((int)($in['table'] ?? 0));
            if ($t['status'] === 'busy') fail('โต๊ะเปิดอยู่แล้ว');
            open_on_first_dish($t, $in);
            q('UPDATE dining_tables SET guest_open = 1 WHERE id = ?', [$t['id']]);
        });
        break;
    case 'cancel_open':
        need();
        tx(function () use ($in) {
            $t = lock_table((int)($in['table'] ?? 0));
            if (q('SELECT COUNT(*) FROM order_items WHERE table_id = ?', [$t['id']])->fetchColumn()) fail('โต๊ะมีรายการอาหารแล้ว');
            q('UPDATE dining_tables SET status = ?, opened_at = NULL, pax = NULL, takeaway = 0, pin = NULL, guest_open = 0 WHERE id = ?', [$t['resv_name'] === null ? 'free' : 'resv', $t['id']]);
        });
        break;
    case 'move':
        need();
        tx(function () use ($in) {
            $from = (int)($in['from'] ?? 0); $to = (int)($in['to'] ?? 0);
            if ($from === $to) fail('เลือกโต๊ะอื่น');
            // lock in id order so two simultaneous moves can't deadlock
            $rows = [];
            foreach ([min($from, $to), max($from, $to)] as $id) $rows[$id] = lock_table($id);
            [$f, $t] = [$rows[$from], $rows[$to]];
            if ($f['status'] !== 'busy') fail('โต๊ะต้นทางไม่มีลูกค้า');
            if ($t['status'] === 'resv') fail('โต๊ะปลายทางถูกจองไว้');
            // a merged bill keeps only the target's discount: don't let the source's discount vanish silently
            if ($t['status'] === 'busy' && $f['disc_type']) fail("โต๊ะ {$f['name']} มีส่วนลดอยู่ — ลบส่วนลดก่อนรวมโต๊ะ แล้วค่อยให้ส่วนลดที่โต๊ะ {$t['name']}");
            q('UPDATE order_items SET table_id = ? WHERE table_id = ?', [$to, $from]);
            if ($t['status'] === 'busy') {
                q('UPDATE dining_tables SET opened_at = LEAST(opened_at, ?), pax = NULLIF(IFNULL(pax, 0) + ?, 0) WHERE id = ?', [$f['opened_at'], (int)$f['pax'], $to]);
            } else {
                q("UPDATE dining_tables SET status = 'busy', resv_name = ?, resv_phone = ?, resv_time = ?, resv_pax = ?, opened_at = ?, disc_type = ?, disc_value = ?, checked_at = ?, checked_total = ?, pax = ?, takeaway = ?, pin = ?, guest_open = ? WHERE id = ?",
                    [$f['resv_name'], $f['resv_phone'], $f['resv_time'], $f['resv_pax'], $f['opened_at'], $f['disc_type'], $f['disc_value'], $f['checked_at'], $f['checked_total'], $f['pax'], $f['takeaway'], $f['pin'], $f['guest_open'], $to]);
            }
            q('UPDATE dining_tables SET ' . CLEAR_TABLE . ' WHERE id = ?', [$from]);
        });
        break;

    /* ---------- order items (staff) ---------- */
    case 'item_add':
        need();
        tx(function () use ($in, $me) {
            $t = lock_table((int)($in['table'] ?? 0));
            open_on_first_dish($t, $in);
            $m = q('SELECT * FROM menu WHERE id = ? AND active = 1', [(int)($in['menu'] ?? 0)])->fetch() ?: fail('ไม่พบเมนู');
            if ($m['out_of_stock']) fail('เมนูนี้หมด');
            // a back-dated dish keeps a line of its own so its time isn't folded into another
            $at = when($in, 'at');
            $ex = str($in, 'at') === '' ? q("SELECT id FROM order_items WHERE table_id = ? AND menu_id = ? AND price = ? AND note = '' ORDER BY id DESC LIMIT 1", [$t['id'], $m['id'], $m['price']])->fetchColumn() : false;
            if ($ex) q('UPDATE order_items SET qty = qty + 1 WHERE id = ?', [$ex]);
            else q('INSERT INTO order_items (table_id, menu_id, name, price, qty, created_by, ordered_at) VALUES (?, ?, ?, ?, 1, ?, ?)', [$t['id'], $m['id'], $m['name'], $m['price'], $me['id'], $at]);
        });
        break;
    case 'item_qty':
        need();
        tx(function () use ($in, $me) {
            $i = lock_item((int)($in['item'] ?? 0));
            $d = (int)($in['delta'] ?? 0) < 0 ? -1 : 1;
            if ($d < 0 && $i['qty'] <= $i['sent'] && !can('reduce')) fail('รายการนี้ส่งครัวแล้ว — ต้องมีสิทธิ์ "ลดรายการที่ส่งครัวแล้ว"');
            $qty = $i['qty'] + $d;
            if ($qty <= 0) q('DELETE FROM order_items WHERE id = ?', [$i['id']]);
            else q('UPDATE order_items SET qty = ?, sent = LEAST(sent, ?), done = LEAST(done, ?) WHERE id = ?', [$qty, $qty, $qty, $i['id']]);
        });
        break;
    case 'item_note':
        need();
        tx(function () use ($in) {
            $i = lock_item((int)($in['item'] ?? 0));
            $note = str($in, 'note', 200);
            // a note on a multi-portion line applies to one portion: split it off
            if ($i['qty'] > 1 && $i['note'] === '' && $note !== '') {
                $qty = $i['qty'] - 1;
                // take an unsent portion if there is one; if every portion already went to the kitchen, the split-off one counts as sent too
                $splitSent = $i['sent'] >= $i['qty'] ? 1 : 0;
                // the kitchen's "cooked" count stays the same in total, so the split doesn't look like a new order there
                $splitDone = min($splitSent, max(0, (int)$i['done'] - $qty));
                q('UPDATE order_items SET qty = ?, sent = LEAST(sent, ?), done = LEAST(done, ?) WHERE id = ?', [$qty, $qty, $qty, $i['id']]);
                q('INSERT INTO order_items (table_id, menu_id, name, price, qty, sent, note, created_by, ordered_at, by_guest, done) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)',
                    [$i['table_id'], $i['menu_id'], $i['name'], $i['price'], $splitSent, $note, $i['created_by'], $i['ordered_at'], $i['by_guest'], $splitDone]);
            } else {
                q('UPDATE order_items SET note = ? WHERE id = ?', [$note, $i['id']]);
            }
        });
        break;
    case 'kitchen':
        need();
        $extra['pending'] = tx(function () use ($in) {
            $t = lock_table((int)($in['table'] ?? 0));
            $p = q('SELECT name, qty - sent AS qty, note FROM order_items WHERE table_id = ? AND qty > sent ORDER BY id', [$t['id']])->fetchAll();
            q('UPDATE order_items SET sent = qty WHERE table_id = ?', [$t['id']]);
            return $p;
        });
        break;
    case 'k_done':
        // kitchen screen: everything sent for this table (or one dish) is cooked
        need();
        tx(function () use ($in) {
            $t = lock_table((int)($in['table'] ?? 0));
            if (!empty($in['item'])) q('UPDATE order_items SET done = sent WHERE id = ? AND table_id = ?', [(int)$in['item'], $t['id']]);
            else q('UPDATE order_items SET done = sent WHERE table_id = ?', [$t['id']]);
        });
        break;
    case 'check_bill':
        // customer asked for the bill: remember the total so staff see if it changes before payment
        need();
        tx(function () use ($in) {
            $t = lock_table((int)($in['table'] ?? 0));
            if ($t['status'] !== 'busy') fail('โต๊ะไม่มีลูกค้า');
            $items = q('SELECT price, qty FROM order_items WHERE table_id = ?', [$t['id']])->fetchAll();
            if (!$items) fail('ไม่มีรายการ');
            no_pending((int)$t['id']);
            $c = calc($items, $t['disc_type'], $t['disc_value'], settings());
            same_total($in, $c['total']);
            q('UPDATE dining_tables SET checked_at = ?, checked_total = ? WHERE id = ?', [now(), $c['total'], $t['id']]);
        });
        break;
    case 'pay':
        need();
        $extra['bill'] = tx(function () use ($in, $me) {
            $t = lock_table((int)($in['table'] ?? 0));
            $items = q('SELECT * FROM order_items WHERE table_id = ? ORDER BY id', [$t['id']])->fetchAll();
            if (!$items) fail('ไม่มีรายการ');
            no_pending((int)$t['id']);
            $method = in_array($in['method'] ?? '', ['cash', 'transfer', 'other', 'mixed'], true) ? $in['method'] : fail('วิธีชำระไม่ถูกต้อง');
            $s = settings();
            $c = calc($items, $t['disc_type'], $t['disc_value'], $s);
            same_total($in, $c['total']);
            // mixed: part by transfer, the rest in cash
            $xfer = $method === 'mixed' ? (money($in['transfer'] ?? null, false) ?? fail('ยอดโอนไม่ถูกต้อง')) : null;
            if ($xfer !== null && $xfer >= $c['total']) fail('ยอดโอนต้องน้อยกว่ายอดสุทธิ (ถ้าโอนทั้งหมด เลือก "โอน")');
            $due = round($c['total'] - (float)$xfer, 2);
            $cash = isset($in['cash']) && in_array($method, ['cash', 'mixed'], true) ? (money($in['cash']) ?? fail('จำนวนเงินที่รับไม่ถูกต้อง')) : null;
            if ($cash !== null && $cash < $due) fail('รับเงินไม่พอ');
            $when = when($in, 'date');
            q('INSERT INTO bills (bill_no, table_name, created_at, sub, disc, service, vat, total, service_pct, vat_pct, method, transfer_amt, cash, change_amt, cashier_id, pax, takeaway) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                [next_bill_no($when), $t['name'], $when, $c['sub'], $c['disc'], $c['service'], $c['vat'], $c['total'], (float)$s['service'], (float)$s['vat'],
                 $method, $xfer, $cash, $cash === null ? null : round($cash - $due, 2), $me['id'], $t['pax'], $t['takeaway']]);
            global $pdo;
            $no = (int)$pdo->lastInsertId();
            foreach ($items as $i) q('INSERT INTO bill_items (bill_id, name, price, qty, note, ordered_at) VALUES (?, ?, ?, ?, ?, ?)', [$no, $i['name'], $i['price'], $i['qty'], $i['note'], $i['ordered_at']]);
            if (!empty($in['slip']) && $method !== 'cash') {
                [$bin, $mime] = data_url((string)$in['slip'], IMG_TYPES, 600000);
                q('INSERT INTO bill_slips (bill_id, data, mime, created_at) VALUES (?, ?, ?, ?)', [$no, $bin, $mime, now()]);
            }
            q('DELETE FROM bill_slips WHERE created_at < NOW() - INTERVAL 90 DAY');
            q('DELETE FROM order_items WHERE table_id = ?', [$t['id']]);
            q('UPDATE dining_tables SET ' . CLEAR_TABLE . ' WHERE id = ?', [$t['id']]);
            return bill_out(q('SELECT b.*, u.name AS cashier FROM bills b LEFT JOIN users u ON u.id = b.cashier_id WHERE b.id = ?', [$no])->fetch());
        });
        break;
    case 'menu_out':
        need();
        tx(fn() => q('UPDATE menu SET out_of_stock = 1 - out_of_stock WHERE id = ?', [(int)($in['id'] ?? 0)]));
        break;

    /* ---------- admin ---------- */
    case 'discount':
        need('discount');
        tx(function () use ($in) {
            $t = lock_table((int)($in['table'] ?? 0));
            $type = in_array($in['type'] ?? '', ['amt', 'pct'], true) ? $in['type'] : null;
            $val = money($in['value'] ?? 0) ?? fail('ส่วนลดไม่ถูกต้อง');
            if ($type === null || $val <= 0) q('UPDATE dining_tables SET disc_type = NULL, disc_value = NULL WHERE id = ?', [$t['id']]);
            else q('UPDATE dining_tables SET disc_type = ?, disc_value = ? WHERE id = ?', [$type, $type === 'pct' ? min(100, $val) : $val, $t['id']]);
        });
        break;
    case 'table_void':
        // admin closes a table without payment: keep a voided bill so the report still shows what was cancelled
        need('void');
        tx(function () use ($in, $me) {
            global $pdo;
            $t = lock_table((int)($in['table'] ?? 0));
            if ($t['status'] !== 'busy') fail('โต๊ะไม่มีลูกค้า');
            $items = q('SELECT * FROM order_items WHERE table_id = ? ORDER BY id', [$t['id']])->fetchAll();
            if ($items) {
                $s = settings();
                $c = calc($items, $t['disc_type'], $t['disc_value'], $s);
                $when = now();
                q("INSERT INTO bills (bill_no, table_name, created_at, sub, disc, service, vat, total, service_pct, vat_pct, method, cashier_id, void, void_by) VALUES (?,?,?,?,?,?,?,?,?,?,'cash',?,1,?)",
                    [next_bill_no($when), $t['name'], $when, $c['sub'], $c['disc'], $c['service'], $c['vat'], $c['total'], (float)$s['service'], (float)$s['vat'], $me['id'], $me['id']]);
                $no = (int)$pdo->lastInsertId();
                foreach ($items as $i) q('INSERT INTO bill_items (bill_id, name, price, qty, note, ordered_at) VALUES (?, ?, ?, ?, ?, ?)', [$no, $i['name'], $i['price'], $i['qty'], $i['note'], $i['ordered_at']]);
                q('DELETE FROM order_items WHERE table_id = ?', [$t['id']]);
            }
            q('UPDATE dining_tables SET ' . CLEAR_TABLE . ' WHERE id = ?', [$t['id']]);
        });
        break;
    case 'menu_save':
        need(empty($in['id']) ? '' : 'menu');
        tx(function () use ($in, $me) {
            $name = str($in, 'name');
            $price = money($in['price'] ?? null);
            if ($name === '' || $price === null) fail('ใส่ชื่อและราคาให้ถูกต้อง');
            $id = (int)($in['id'] ?? 0);
            $old = $id ? (q('SELECT * FROM menu WHERE id = ? AND active = 1 FOR UPDATE', [$id])->fetch() ?: fail('เมนูนี้ถูกลบไปแล้ว (อาจลบจากเครื่องอื่น)')) : null;
            if (q('SELECT id FROM menu WHERE name = ? AND active = 1 AND id <> ?', [$name, $id])->fetch()) fail('มีเมนูชื่อนี้อยู่แล้ว');
            if ($old) {
                q('UPDATE menu SET name = ?, price = ?, cat = ? WHERE id = ?', [$name, $price, str($in, 'cat', 100), $id]);
                // saving a pending dish (only "menu" can edit) is an approval at the saved price
                if ($old['pending']) { approve_menu($id, $price); q('UPDATE order_items SET name = ? WHERE menu_id = ?', [$name, $id]); }
            } else {
                q('INSERT INTO menu (name, price, cat, pending, created_by) VALUES (?, ?, ?, ?, ?)', [$name, $price, str($in, 'cat', 100), can('menu') ? 0 : 1, $me['id']]);
            }
            global $pdo;
            return (int)($in['id'] ?? 0) ?: (int)$pdo->lastInsertId();
        });
        break;
    case 'menu_add_order':
        // staff add a dish that isn't on the menu yet from the table screen and order it at once
        need();
        tx(function () use ($in, $me) {
            global $pdo;
            $t = lock_table((int)($in['table'] ?? 0));
            open_on_first_dish($t, $in);
            $name = str($in, 'name');
            $price = money($in['price'] ?? null);
            if ($name === '' || $price === null) fail('ใส่ชื่อและราคาให้ถูกต้อง');
            if (q('SELECT id FROM menu WHERE name = ? AND active = 1', [$name])->fetch()) fail('มีเมนูชื่อนี้อยู่แล้ว — กดสั่งจากรายการเมนู');
            // the kitchen can start right away; the bill waits until someone with "menu" approves the price
            q('INSERT INTO menu (name, price, cat, pending, created_by) VALUES (?, ?, ?, ?, ?)', [$name, $price, str($in, 'cat', 100), can('menu') ? 0 : 1, $me['id']]);
            q('INSERT INTO order_items (table_id, menu_id, name, price, qty, created_by, ordered_at) VALUES (?, ?, ?, ?, 1, ?, ?)', [$t['id'], (int)$pdo->lastInsertId(), $name, $price, $me['id'], when($in, 'at')]);
        });
        break;
    case 'menu_approve':
        need('menu');
        tx(function () use ($in) {
            $id = (int)($in['id'] ?? 0);
            $m = q('SELECT * FROM menu WHERE id = ? AND active = 1 FOR UPDATE', [$id])->fetch() ?: fail('ไม่พบเมนู (อาจถูกลบจากเครื่องอื่น)');
            if (!$m['pending']) fail('เมนูนี้อนุมัติไปแล้ว');
            approve_menu($id, money($in['price'] ?? $m['price']) ?? fail('ราคาไม่ถูกต้อง'));
        });
        break;
    case 'menu_reject':
        // not approved: the dish leaves the menu and every open order (nothing pending was ever billed)
        need('menu');
        $extra['removed'] = tx(function () use ($in) {
            $id = (int)($in['id'] ?? 0);
            $m = q('SELECT * FROM menu WHERE id = ? AND active = 1 FOR UPDATE', [$id])->fetch() ?: fail('ไม่พบเมนู (อาจถูกลบจากเครื่องอื่น)');
            if (!$m['pending']) fail('เมนูนี้อนุมัติไปแล้ว — ใช้ปุ่มลบแทน');
            foreach (q('SELECT DISTINCT table_id FROM order_items WHERE menu_id = ? ORDER BY table_id', [$id])->fetchAll(PDO::FETCH_COLUMN) as $tid) lock_table((int)$tid);
            $n = q('DELETE FROM order_items WHERE menu_id = ?', [$id])->rowCount();
            q('UPDATE menu SET active = 0 WHERE id = ?', [$id]);
            return $n;
        });
        break;
    case 'menu_bulk':
        need('menu');
        $extra['added'] = tx(function () use ($in) {
            $have = array_flip(q('SELECT name FROM menu WHERE active = 1')->fetchAll(PDO::FETCH_COLUMN));
            $n = 0;
            foreach (array_slice((array)($in['items'] ?? []), 0, 500) as $m) {
                $m = (array)$m;
                $name = str($m, 'name');
                $price = money($m['price'] ?? null);
                if ($name === '' || isset($have[$name]) || $price === null) continue;
                q('INSERT INTO menu (name, price, cat) VALUES (?, ?, ?)', [$name, $price, str($m, 'cat', 100)]);
                $have[$name] = 1; $n++;
            }
            return $n;
        });
        break;
    case 'menu_clear':
        // owner wipes the whole menu (e.g. replacing the sample menu); soft delete, so old bills and open orders are untouched
        need('menu');
        if ($me['role'] !== 'admin') fail('เฉพาะเจ้าของร้านเท่านั้น', 403);
        // dishes waiting for approval stay: they sit on open orders and must be approved or rejected
        $extra['cleared'] = tx(fn() => q('UPDATE menu SET active = 0 WHERE active = 1 AND pending = 0')->rowCount());
        break;
    case 'cat_rename':
        // rename a category on every dish in it; renaming to an existing category merges them, to '' drops the category
        need('menu');
        $from = str($in, 'from', 100); $to = str($in, 'to', 100);
        if ($from === '') fail('เลือกหมวดก่อน');
        $extra['moved'] = tx(fn() => q('UPDATE menu SET cat = ? WHERE cat = ? AND active = 1', [$to, $from])->rowCount());
        break;
    case 'menu_cat':
        // move one dish to another category from the menu list dropdown (doesn't touch price or approval)
        need('menu');
        tx(function () use ($in) {
            $id = (int)($in['id'] ?? 0);
            q('SELECT id FROM menu WHERE id = ? AND active = 1 FOR UPDATE', [$id])->fetch() ?: fail('ไม่พบเมนู (อาจถูกลบจากเครื่องอื่น)');
            q('UPDATE menu SET cat = ? WHERE id = ?', [str($in, 'cat', 100), $id]);
        });
        break;
    case 'img':
        // a dish photo: public, the guest order page shows them too
        $img = q('SELECT data, mime FROM menu_images WHERE menu_id = ?', [(int)($_GET['id'] ?? 0)])->fetch() ?: fail('ไม่พบรูป', 404);
        header('Content-Type: ' . $img['mime']);
        header('Cache-Control: private, max-age=31536000, immutable');
        echo $img['data'];
        exit;
    case 'menu_img':
        // set (data = data: URL) or remove (data empty) a dish photo
        need('menu');
        $id = (int)($in['id'] ?? 0);
        $raw = (string)($in['data'] ?? '');
        if ($raw === '') { tx(fn() => q('DELETE FROM menu_images WHERE menu_id = ?', [$id])); break; }
        if (!preg_match('#^data:image/(jpeg|png|webp);base64,#', $raw, $m)) fail('ไฟล์รูปไม่ถูกต้อง');
        $bin = base64_decode(substr($raw, strlen($m[0])), true);
        if ($bin === false || strlen($bin) > 600000) fail('รูปใหญ่เกินไป');
        $info = @getimagesizefromstring($bin);
        if (!$info || !in_array($info['mime'], ['image/jpeg', 'image/png', 'image/webp'], true)) fail('ไฟล์รูปไม่ถูกต้อง');
        tx(function () use ($id, $bin, $info) {
            q('SELECT id FROM menu WHERE id = ? AND active = 1', [$id])->fetch() ?: fail('ไม่พบเมนู');
            q('INSERT INTO menu_images (menu_id, data, mime, ver) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data), mime = VALUES(mime), ver = VALUES(ver)',
                [$id, $bin, $info['mime'], time()]);
        });
        break;
    case 'menu_del':
        need('menu');
        tx(function () use ($in) {
            $id = (int)($in['id'] ?? 0);
            if (q('SELECT 1 FROM menu WHERE id = ? AND active = 1 AND pending = 1', [$id])->fetch()) fail('เมนูนี้รออนุมัติ — กด "อนุมัติ" หรือ "ไม่อนุมัติ"');
            q('UPDATE menu SET active = 0 WHERE id = ?', [$id]);
        });
        break;
    case 'settings_save':
        need('settings');
        tx(function () use ($in) {
            // a negative or >100 percentage would make every bill wrong
            foreach (['service', 'vat'] as $k) {
                if (!is_numeric($in[$k] ?? 0) || $in[$k] < 0 || $in[$k] > 100) fail('Service / VAT ต้องอยู่ระหว่าง 0–100%');
            }
            foreach (['name', 'addr', 'phone', 'service', 'vat', 'promptpay', 'footer', 'bank_name', 'bank_acct', 'bank_owner', 'qr_pin', 'qr_open_only', 'sound'] as $k) {
                if (array_key_exists($k, $in)) q('INSERT INTO settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)', [$k, str($in, $k, 500)]);
            }
        });
        break;
    case 'qr_regen':
        // a lost or copied sticker: the table gets a new QR and the old one stops working
        need('settings');
        tx(fn() => q('UPDATE dining_tables SET qr_token = ? WHERE id = ?', [bin2hex(random_bytes(8)), (int)($in['table'] ?? 0)]));
        break;
    case 'file':
        need();
        $f = q('SELECT data, mime FROM files WHERE k = ?', [str($_GET, 'k', 40)])->fetch() ?: fail('ไม่พบไฟล์', 404);
        header('Content-Type: ' . $f['mime']);
        header('Cache-Control: private, max-age=31536000, immutable');
        echo $f['data'];
        exit;
    case 'file_save':
        // the shop's own payment QR picture, or a kitchen alert sound (a new one each time)
        need('settings');
        $kind = $in['kind'] ?? '';
        if ($kind === 'shop_qr') { [$bin, $mime] = data_url((string)($in['data'] ?? ''), IMG_TYPES, 600000); $k = 'shop_qr'; }
        elseif ($kind === 'sound') {
            [$bin, $mime] = data_url((string)($in['data'] ?? ''), SOUND_TYPES, 500000);
            if ((int)q("SELECT COUNT(*) FROM files WHERE k LIKE 'snd\_%'")->fetchColumn() >= 20) fail('เสียงเต็มแล้ว (20 เสียง) — ลบเสียงเก่าก่อน');
            $k = 'snd_' . bin2hex(random_bytes(4));
        } else fail('ชนิดไฟล์ไม่ถูกต้อง');
        $name = str($in, 'name', 100);
        tx(fn() => q('INSERT INTO files (k, name, data, mime, ver) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name), data = VALUES(data), mime = VALUES(mime), ver = VALUES(ver)',
            [$k, $name, $bin, $mime, time()]));
        $extra['key'] = $k;
        break;
    case 'file_del':
        need('settings');
        tx(fn() => q('DELETE FROM files WHERE k = ?', [str($in, 'k', 40)]));
        break;
    case 'slip':
        need('report');
        $f = q('SELECT data, mime FROM bill_slips WHERE bill_id = ?', [(int)($_GET['no'] ?? 0)])->fetch() ?: fail('ไม่พบสลิป', 404);
        header('Content-Type: ' . $f['mime']);
        echo $f['data'];
        exit;

    /* ---------- guests ordering from the table QR (no login) ---------- */
    case 'g_menu':
        $t = guest_table();
        $open = $t['status'] === 'busy';
        $menu = [];
        foreach (q('SELECT m.id, m.name, m.price, m.cat, m.out_of_stock, i.ver FROM menu m LEFT JOIN menu_images i ON i.menu_id = m.id WHERE m.active = 1 AND m.pending = 0 ORDER BY m.id') as $m) {
            $menu[] = ['id' => (int)$m['id'], 'name' => $m['name'], 'price' => (float)$m['price'], 'cat' => $m['cat'], 'out' => (bool)$m['out_of_stock'],
                'image' => $m['ver'] === null ? null : "api.php?a=img&id={$m['id']}&v={$m['ver']}"];
        }
        $s = settings();
        out(['shop' => $s['name'] ?? '', 'table' => $t['name'], 'open' => $open, 'pinNeeded' => ($s['qr_pin'] ?? '') === '1', 'menu' => $menu,
            'order' => $open ? array_map(fn($i) => ['name' => $i['name'], 'qty' => (int)$i['qty'], 'note' => $i['note']],
                q('SELECT name, qty, note FROM order_items WHERE table_id = ? ORDER BY id', [$t['id']])->fetchAll()) : []]);
    case 'g_order':
        // straight to the kitchen; only while staff have the table open, at most one try every few seconds per table
        $t = guest_table();
        $lines = is_array($in['items'] ?? null) ? $in['items'] : [];
        if (!$lines || count($lines) > 30) fail('เลือกเมนูก่อน');
        if ($t['status'] !== 'busy') fail('โต๊ะยังไม่เปิด — เรียกพนักงานเพื่อเปิดโต๊ะ');
        // one try per 8 s per table, wrong PINs included (10,000 PINs would take most of a day); the UPDATE is the lock
        if (!q('UPDATE dining_tables SET guest_last = NOW() WHERE id = ? AND (guest_last IS NULL OR guest_last < NOW() - INTERVAL 8 SECOND)', [$t['id']])->rowCount()) {
            fail('ส่งถี่เกินไป รอสักครู่แล้วลองใหม่', 429);
        }
        // a table staff opened without the QR button: guests can't order there (stops orders from a photo of the sticker)
        if ((settings()['qr_open_only'] ?? '') === '1' && !$t['guest_open']) fail('โต๊ะนี้ยังไม่เปิดให้สั่งเอง — เรียกพนักงาน', 403);
        // a table without a PIN (reopened bill, old open action) must not accept an empty one
        if ((settings()['qr_pin'] ?? '') === '1' && ((string)$t['pin'] === '' || str($in, 'pin', 4) !== (string)$t['pin'])) fail('รหัสโต๊ะไม่ถูกต้อง — ถามรหัส 4 หลักจากพนักงาน', 403);
        tx(function () use ($t, $lines) {
            $t = lock_table((int)$t['id']);
            if ($t['status'] !== 'busy') fail('โต๊ะยังไม่เปิด — เรียกพนักงานเพื่อเปิดโต๊ะ');
            foreach ($lines as $l) {
                if (!is_array($l)) fail('รายการไม่ถูกต้อง');
                $qty = (int)($l['qty'] ?? 0);
                if ($qty < 1 || $qty > 20) fail('จำนวนต้องอยู่ระหว่าง 1–20');
                $m = q('SELECT * FROM menu WHERE id = ? AND active = 1 AND pending = 0', [(int)($l['menu'] ?? 0)])->fetch() ?: fail('ไม่พบเมนู (อาจถูกลบ) — รีเฟรชหน้า');
                if ($m['out_of_stock']) fail("{$m['name']} หมดแล้ว");
                q('INSERT INTO order_items (table_id, menu_id, name, price, qty, sent, note, ordered_at, by_guest) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)',
                    [$t['id'], $m['id'], $m['name'], $m['price'], $qty, $qty, str($l, 'note', 200), now()]);
            }
        });
        out(['ok' => true]);
    case 'table_add':
        need('settings');
        tx(function () use ($in) {
            $name = str($in, 'name', 50);
            if ($name === '') fail('ใส่ชื่อโต๊ะ');
            q('INSERT INTO dining_tables (name, sort, qr_token) SELECT ?, COALESCE(MAX(sort), 0) + 1, ? FROM dining_tables', [$name, bin2hex(random_bytes(8))]);
        });
        break;
    case 'table_rename':
        need('settings');
        tx(function () use ($in) {
            $name = str($in, 'name', 50);
            if ($name === '') fail('ใส่ชื่อโต๊ะ');
            $t = lock_table((int)($in['id'] ?? 0));
            q('UPDATE dining_tables SET name = ? WHERE id = ?', [$name, $t['id']]);
        });
        break;
    case 'table_del':
        need('settings');
        tx(function () use ($in) {
            $t = lock_table((int)($in['id'] ?? 0));
            if ($t['status'] !== 'free') fail('โต๊ะไม่ว่าง');
            q('DELETE FROM dining_tables WHERE id = ?', [$t['id']]);
        });
        break;
    case 'bills':
        need('report');
        // one day (date=) or a from..to range; older open pages still send date=
        $ymd = fn($k) => preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET[$k] ?? '') ? $_GET[$k] : null;
        $from = $ymd('from') ?? $ymd('date') ?? date('Y-m-d');
        $to = $ymd('to') ?? $from;
        if ($from > $to) [$from, $to] = [$to, $from];
        if ((strtotime($to) - strtotime($from)) / 86400 > 400) fail('เลือกช่วงได้ไม่เกิน 400 วัน');
        $rows = q('SELECT b.*, u.name AS cashier FROM bills b LEFT JOIN users u ON u.id = b.cashier_id WHERE b.created_at >= ? AND b.created_at < ? + INTERVAL 1 DAY ORDER BY b.id',
            [$from, $to])->fetchAll();
        out(['bills' => array_map('bill_out', $rows)]);
    case 'dash':
        need('report');
        $ymd = fn($k) => preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET[$k] ?? '') ? $_GET[$k] : date('Y-m-d');
        [$from, $to] = [$ymd('from'), $ymd('to')];
        if ($from > $to) [$from, $to] = [$to, $from];
        if ((strtotime($to) - strtotime($from)) / 86400 > 400) fail('เลือกช่วงได้ไม่เกิน 400 วัน');
        $range = 'created_at >= ? AND created_at < ? + INTERVAL 1 DAY';
        $days = [];
        foreach (q("SELECT DATE(created_at) d, COUNT(*) n, SUM(total) total, SUM(disc) disc FROM bills WHERE void = 0 AND $range GROUP BY d", [$from, $to]) as $r) {
            $days[$r['d']] = ['n' => (int)$r['n'], 'income' => (float)$r['total'], 'disc' => (float)$r['disc'], 'expense' => 0.0];
        }
        foreach (q('SELECT spent_on d, SUM(amount) amt FROM expenses WHERE spent_on BETWEEN ? AND ? GROUP BY d', [$from, $to]) as $r) {
            $days[$r['d']] ??= ['n' => 0, 'income' => 0.0, 'disc' => 0.0, 'expense' => 0.0];
            $days[$r['d']]['expense'] = (float)$r['amt'];
        }
        ksort($days);
        out([
            'from' => $from, 'to' => $to, 'days' => $days,
            'methods' => array_map(fn($r) => ['method' => $r['method'], 'amt' => (float)$r['amt']],
                // a mixed bill counts its cash part under cash and its transfer part under transfer
                q("SELECT method, SUM(amt) amt FROM (
                     SELECT IF(method = 'mixed', 'cash', method) method, total - COALESCE(transfer_amt, 0) amt FROM bills WHERE void = 0 AND $range
                     UNION ALL SELECT 'transfer', transfer_amt FROM bills WHERE void = 0 AND method = 'mixed' AND $range
                   ) x GROUP BY method ORDER BY amt DESC", [$from, $to, $from, $to])->fetchAll()),
            'voids' => (int)q("SELECT COUNT(*) FROM bills WHERE void = 1 AND $range", [$from, $to])->fetchColumn(),
            'top' => array_map(fn($r) => ['name' => $r['name'], 'qty' => (int)$r['qty'], 'amt' => (float)$r['amt']],
                q("SELECT i.name, SUM(i.qty) qty, SUM(i.qty * i.price) amt FROM bill_items i JOIN bills b ON b.id = i.bill_id
                   WHERE b.void = 0 AND b.created_at >= ? AND b.created_at < ? + INTERVAL 1 DAY GROUP BY i.name ORDER BY amt DESC LIMIT 10", [$from, $to])->fetchAll()),
            'expenses' => array_map(fn($r) => ['id' => (int)$r['id'], 'date' => $r['spent_on'], 'cat' => $r['cat'], 'note' => $r['note'], 'amount' => (float)$r['amount'], 'by' => $r['by'] ?? ''],
                q('SELECT e.*, u.name AS `by` FROM expenses e LEFT JOIN users u ON u.id = e.created_by WHERE e.spent_on BETWEEN ? AND ? ORDER BY e.spent_on DESC, e.id DESC', [$from, $to])->fetchAll()),
        ]);
    case 'expense_save':
        need('report');
        $date = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)($in['date'] ?? '')) ? $in['date'] : fail('เลือกวันที่');
        if (!checkdate((int)substr($date, 5, 2), (int)substr($date, 8, 2), (int)substr($date, 0, 4))) fail('วันที่ไม่ถูกต้อง');
        $amount = money($in['amount'] ?? null, false) ?? fail('ใส่จำนวนเงินให้ถูกต้อง');
        $cat = str($in, 'cat', 100);
        if ($cat === '') fail('ใส่หมวดรายจ่าย');
        $id = (int)($in['id'] ?? 0);
        // tx() bumps ver so other open devices notice the change
        tx(fn() => $id
            ? q('UPDATE expenses SET spent_on = ?, cat = ?, note = ?, amount = ? WHERE id = ?', [$date, $cat, str($in, 'note', 200), $amount, $id])
            : q('INSERT INTO expenses (spent_on, cat, note, amount, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)', [$date, $cat, str($in, 'note', 200), $amount, $me['id'], now()]));
        out(['ok' => true]);
    case 'expense_del':
        need('report');
        tx(fn() => q('DELETE FROM expenses WHERE id = ?', [(int)($in['id'] ?? 0)]));
        out(['ok' => true]);
    case 'bill_void':
        need('void');
        tx(fn() => q('UPDATE bills SET void = 1, void_by = ? WHERE id = ?', [$me['id'], (int)($in['no'] ?? 0)]));
        break;
    case 'bill_date':
        // the owner may move a bill to another payment date-time (e.g. a sale keyed in the next morning)
        need();
        if ($me['role'] !== 'admin') fail('เฉพาะเจ้าของร้านเท่านั้น', 403);
        $when = str($in, 'date', 16);
        if (!preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/', $when) || !strtotime($when)) fail('วันเวลาไม่ถูกต้อง (เช่น 2026-10-20 18:30)');
        if (!tx(fn() => q('UPDATE bills SET created_at = ? WHERE id = ?', [$when . ':00', (int)($in['no'] ?? 0)])->rowCount())) fail('ไม่พบบิล หรือวันเวลาเดิม');
        break;
    case 'bill_method':
        // owner fixes how a paid bill was paid (e.g. cashier pressed cash but the guest transferred)
        need();
        if ($me['role'] !== 'admin') fail('เฉพาะเจ้าของร้าน/แอดมินเท่านั้น', 403);
        $method = in_array($in['method'] ?? '', ['cash', 'transfer', 'other'], true) ? $in['method'] : fail('วิธีชำระไม่ถูกต้อง');
        tx(function () use ($in, $method) {
            $b = q('SELECT * FROM bills WHERE id = ? FOR UPDATE', [(int)($in['no'] ?? 0)])->fetch() ?: fail('ไม่พบบิล');
            if ($b['void']) fail('บิลนี้ถูกยกเลิกแล้ว');
            // cash received / change only mean something for cash (a mixed bill's cash was for its cash part only); SET runs left to right, so method changes last
            q('UPDATE bills SET cash = IF(? = \'cash\' AND method = \'cash\', cash, NULL), change_amt = IF(? = \'cash\' AND method = \'cash\', change_amt, NULL), transfer_amt = NULL, method = ? WHERE id = ?',
                [$method, $method, $method, $b['id']]);
        });
        break;
    case 'bill_reopen':
        // owner reopens a paid bill to take payment again: the bill is voided (kept in the report as cancelled)
        // and its dishes go back on the same table, already marked as sent to the kitchen
        need();
        if ($me['role'] !== 'admin') fail('เฉพาะเจ้าของร้าน/แอดมินเท่านั้น', 403);
        $extra['table'] = tx(function () use ($in, $me) {
            $b = q('SELECT * FROM bills WHERE id = ? FOR UPDATE', [(int)($in['no'] ?? 0)])->fetch() ?: fail('ไม่พบบิล');
            if ($b['void']) fail('บิลนี้ถูกยกเลิกแล้ว');
            $tid = q('SELECT id FROM dining_tables WHERE name = ? ORDER BY id LIMIT 1', [$b['table_name']])->fetchColumn()
                ?: fail('ไม่พบโต๊ะ ' . $b['table_name'] . ' (อาจถูกลบไปแล้ว)');
            $t = lock_table((int)$tid);
            if ($t['status'] === 'busy') fail('โต๊ะ ' . $t['name'] . ' มีลูกค้าอยู่ — ชำระหรือย้ายโต๊ะนั้นก่อน');
            if ($t['status'] === 'resv') fail('โต๊ะ ' . $t['name'] . ' ถูกจองไว้ — ยกเลิกการจองก่อน');
            $items = q('SELECT * FROM bill_items WHERE bill_id = ? ORDER BY id', [$b['id']])->fetchAll();
            if (!$items) fail('บิลนี้ไม่มีรายการ');
            q('UPDATE bills SET void = 1, void_by = ? WHERE id = ?', [$me['id'], $b['id']]);
            foreach ($items as $i) {
                $mid = q('SELECT id FROM menu WHERE name = ? AND active = 1 AND pending = 0 ORDER BY id LIMIT 1', [$i['name']])->fetchColumn() ?: null;
                q('INSERT INTO order_items (table_id, menu_id, name, price, qty, sent, note, created_by, ordered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [$t['id'], $mid, $i['name'], $i['price'], $i['qty'], $i['qty'], $i['note'], $me['id'], $i['ordered_at']]);
            }
            // keep the discount the guest got (as a fixed amount, which is what the bill recorded)
            $disc = (float)$b['disc'];
            q("UPDATE dining_tables SET status = 'busy', opened_at = ?, disc_type = ?, disc_value = ?, checked_at = NULL, checked_total = NULL, pax = ?, takeaway = ? WHERE id = ?",
                [now(), $disc > 0 ? 'amt' : null, $disc > 0 ? $disc : null, $b['pax'], $b['takeaway'], $t['id']]);
            return (int)$t['id'];
        });
        break;
    case 'users':
        need('users');
        // ago = seconds since the user's last request (null = signed out / never), measured on the DB clock
        out(['users' => array_map(fn($u) => ['id' => (int)$u['id'], 'username' => $u['username'], 'name' => $u['name'], 'role' => $u['role'], 'perms' => perms_of($u),
                'seen' => $u['last_seen'], 'ago' => $u['ago'] === null ? null : (int)$u['ago']],
            q('SELECT id, username, name, role, perms, last_seen, TIMESTAMPDIFF(SECOND, last_seen, NOW()) AS ago FROM users WHERE active = 1 ORDER BY role, id')->fetchAll())]);
    case 'user_save':
        need('users');
        $id = (int)($in['id'] ?? 0);
        $username = str($in, 'username', 50); $name = str($in, 'name', 100);
        $role = ($in['role'] ?? '') === 'admin' ? 'admin' : 'staff';
        $perms = $role === 'admin' ? [] : array_values(array_intersect(array_keys(PERMS), (array)($in['perms'] ?? [])));
        $pass = (string)($in['password'] ?? '');
        if ($username === '' || $name === '') fail('ใส่ชื่อผู้ใช้และชื่อ');
        // deleted accounts are renamed "name#id" to free the name, so a live "#" name could block a later delete
        if (str_contains($username, '#')) fail('ชื่อผู้ใช้ห้ามมีเครื่องหมาย #');
        if (!$id && mb_strlen($pass) < 4) fail('รหัสผ่านต้องยาวอย่างน้อย 4 ตัว');
        if ($pass !== '' && mb_strlen($pass) < 4) fail('รหัสผ่านต้องยาวอย่างน้อย 4 ตัว');
        $target = $id ? (q('SELECT role, perms FROM users WHERE id = ? AND active = 1', [$id])->fetch() ?: fail('ไม่พบผู้ใช้')) : null;
        if ($me['role'] !== 'admin') {
            // someone given "manage users" must not be able to hand out more than they have
            if ($role === 'admin' || ($target && $target['role'] === 'admin')) fail('เฉพาะเจ้าของร้านเท่านั้นที่ตั้ง/แก้บัญชีเจ้าของร้านได้', 403);
            if (array_diff($perms, $me['perms'])) fail('ให้สิทธิ์ที่ตัวเองไม่มีไม่ได้', 403);
            // resetting the password of someone with more rights would let you log in as them
            if ($target && array_diff(perms_of($target), $me['perms'])) fail('แก้บัญชีที่มีสิทธิ์มากกว่าตัวเองไม่ได้', 403);
            if ($id === $me['id']) $perms = perms_of($target);
        }
        if ($id === $me['id'] && $me['role'] === 'admin' && $role !== 'admin') fail('ลดสิทธิ์ตัวเองไม่ได้');
        if (q('SELECT id FROM users WHERE username = ? AND id <> ?', [$username, $id])->fetch()) fail('ชื่อผู้ใช้นี้มีแล้ว');
        if ($id) {
            q('UPDATE users SET username = ?, name = ?, role = ?, perms = ? WHERE id = ?', [$username, $name, $role, implode(',', $perms), $id]);
            if ($pass !== '') {
                // the user's sessions end (see pass_tag) - except this one when you change your own
                $hash = password_hash($pass, PASSWORD_DEFAULT);
                q('UPDATE users SET pass_hash = ? WHERE id = ?', [$hash, $id]);
                if ($id === $me['id']) { $_SESSION['ph'] = pass_tag($hash); $_SESSION['weak'] = $pass === DEFAULT_PASS; }
            }
        } else {
            q('INSERT INTO users (username, pass_hash, name, role, perms) VALUES (?, ?, ?, ?, ?)', [$username, password_hash($pass, PASSWORD_DEFAULT), $name, $role, implode(',', $perms)]);
        }
        out(['ok' => true]);
    case 'user_del':
        need('users');
        $id = (int)($in['id'] ?? 0);
        if ($id === $me['id']) fail('ลบตัวเองไม่ได้');
        if ($me['role'] !== 'admin') {
            $target = q('SELECT role, perms FROM users WHERE id = ? AND active = 1', [$id])->fetch() ?: fail('ไม่พบผู้ใช้');
            if ($target['role'] === 'admin') fail('เฉพาะเจ้าของร้านเท่านั้นที่ลบบัญชีเจ้าของร้านได้', 403);
            if (array_diff(perms_of($target), $me['perms'])) fail('ลบบัญชีที่มีสิทธิ์มากกว่าตัวเองไม่ได้', 403);
        }
        // free the username so it can be reused
        q("UPDATE users SET active = 0, username = CONCAT(username, '#', id) WHERE id = ?", [$id]);
        out(['ok' => true]);
    default:
        fail('unknown action', 404);
    }
    out(state() + $extra);
} catch (AppError $e) {
    out(['error' => $e->getMessage()], $e->getCode() ?: 400);
} catch (Throwable $e) {
    error_log((string)$e);
    out(['error' => 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์'], 500);
}
