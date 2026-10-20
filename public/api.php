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

// run a write inside a transaction and bump the change counter clients poll
function tx(callable $f): mixed {
    global $pdo;
    $pdo->beginTransaction();
    try { $r = $f(); q("UPDATE meta SET v = v + 1 WHERE k = 'ver'"); $pdo->commit(); return $r; }
    catch (Throwable $e) { $pdo->rollBack(); throw $e; }
}

// upgrade databases created by an older init.sql (it only runs once); the schema number keeps this off the hot path
const SCHEMA = 5;
if ((int)q("SELECT COALESCE(MAX(v), 0) FROM meta WHERE k = 'schema'")->fetchColumn() < SCHEMA) {
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
    'menu' => 'แก้เมนู / ราคา', 'discount' => 'ให้ส่วนลด', 'reduce' => 'ลดรายการที่ส่งครัวแล้ว',
    'report' => 'ดูยอดขาย / แดชบอร์ด / รายจ่าย', 'void' => 'ยกเลิกบิล', 'settings' => 'ตั้งค่าร้าน / จัดการโต๊ะ', 'users' => 'จัดการผู้ใช้',
];
// role 'admin' is the owner: always every permission, so the shop can't lock itself out
function perms_of(array $u): array {
    if ($u['role'] === 'admin') return array_keys(PERMS);
    return array_values(array_intersect(array_keys(PERMS), explode(',', (string)($u['perms'] ?? ''))));
}

$me = null;
if (isset($_SESSION['uid'])) {
    $me = q('SELECT id, username, name, role, perms FROM users WHERE id = ? AND active = 1', [$_SESSION['uid']])->fetch() ?: null;
    if ($me) { $me['id'] = (int)$me['id']; $me['perms'] = perms_of($me); $me['weak'] = !empty($_SESSION['weak']); }
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
            'name' => $i['name'], 'price' => (float)$i['price'], 'qty' => (int)$i['qty'], 'sent' => (int)$i['sent'], 'note' => $i['note']];
    }
    $tables = [];
    foreach (q('SELECT * FROM dining_tables ORDER BY sort, id') as $t) {
        $tables[] = ['id' => (int)$t['id'], 'name' => $t['name'], 'status' => $t['status'],
            'resv' => $t['resv_name'] === null ? null : ['name' => $t['resv_name'], 'phone' => $t['resv_phone'], 'time' => $t['resv_time'], 'pax' => $t['resv_pax']],
            'openedAt' => $t['opened_at'],
            'discount' => $t['disc_type'] ? ['type' => $t['disc_type'], 'value' => (float)$t['disc_value']] : null,
            'checked' => $t['checked_at'] === null ? null : ['at' => $t['checked_at'], 'total' => (float)$t['checked_total']],
            'order' => $byTable[$t['id']] ?? []];
    }
    $menu = [];
    foreach (q('SELECT * FROM menu WHERE active = 1 ORDER BY id') as $m) {
        $menu[] = ['id' => (int)$m['id'], 'name' => $m['name'], 'price' => (float)$m['price'], 'cat' => $m['cat'], 'out' => (bool)$m['out_of_stock']];
    }
    return ['ver' => ver(), 'me' => $me, 'permList' => PERMS, 'settings' => settings(), 'menu' => $menu, 'tables' => $tables];
}

function bill_out(array $b): array {
    $items = q('SELECT name, price, qty, note FROM bill_items WHERE bill_id = ? ORDER BY id', [$b['id']])->fetchAll();
    return ['no' => (int)$b['id'], 'table' => $b['table_name'], 'date' => $b['created_at'],
        'items' => array_map(fn($i) => ['name' => $i['name'], 'price' => (float)$i['price'], 'qty' => (int)$i['qty'], 'note' => $i['note']], $items),
        'sub' => (float)$b['sub'], 'disc' => (float)$b['disc'], 'service' => (float)$b['service'], 'vat' => (float)$b['vat'], 'total' => (float)$b['total'],
        'servicePct' => (float)$b['service_pct'], 'vatPct' => (float)$b['vat_pct'], 'method' => $b['method'],
        'cash' => $b['cash'] === null ? null : (float)$b['cash'], 'change' => $b['change_amt'] === null ? null : (float)$b['change_amt'],
        'void' => (bool)$b['void'], 'cashier' => $b['cashier'] ?? ''];
}

function lock_table(int $id): array {
    return q('SELECT * FROM dining_tables WHERE id = ? FOR UPDATE', [$id])->fetch() ?: fail('ไม่พบโต๊ะ');
}
// lock the table first, then the item: same order as pay/kitchen, so no deadlock
function lock_item(int $id): array {
    $gone = 'ไม่พบรายการ (อาจถูกแก้จากเครื่องอื่น)';
    $tid = q('SELECT table_id FROM order_items WHERE id = ?', [$id])->fetchColumn() ?: fail($gone);
    lock_table((int)$tid);
    $i = q('SELECT * FROM order_items WHERE id = ? FOR UPDATE', [$id])->fetch() ?: fail($gone);
    if ((int)$i['table_id'] !== (int)$tid) fail($gone);
    return $i;
}
const CLEAR_TABLE = "status = 'free', resv_name = NULL, resv_phone = NULL, resv_time = NULL, resv_pax = NULL, opened_at = NULL, disc_type = NULL, disc_value = NULL, checked_at = NULL, checked_total = NULL";
// in production only nginx can reach the app (it listens on 127.0.0.1), so trust its X-Real-IP when the peer is a private address
function client_ip(): string {
    $peer = $_SERVER['REMOTE_ADDR'] ?? '';
    $real = $_SERVER['HTTP_X_REAL_IP'] ?? '';
    $public = filter_var($peer, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE);
    return !$public && filter_var($real, FILTER_VALIDATE_IP) ? $real : $peer;
}
function str(array $in, string $k, int $max = 150): string { return mb_substr(trim((string)($in[$k] ?? '')), 0, $max); }

$a = $_GET['a'] ?? '';
$in = [];
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!str_starts_with($_SERVER['CONTENT_TYPE'] ?? '', 'application/json')) out(['error' => 'bad request'], 400);
    $in = json_decode(file_get_contents('php://input'), true);
    if (!is_array($in)) $in = [];
} elseif (!in_array($a, ['state', 'ver', 'bills', 'dash', 'users', 'me'], true)) {
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
        $_SESSION['weak'] = $pass === DEFAULT_PASS;
        $me = ['id' => (int)$u['id'], 'username' => $u['username'], 'name' => $u['name'], 'role' => $u['role'], 'perms' => perms_of($u), 'weak' => $_SESSION['weak']];
        out(state());
    case 'logout':
        session_destroy();
        out(['me' => null]);
    case 'password':
        if (!$me) fail('กรุณาเข้าสู่ระบบ', 401);
        $u = q('SELECT pass_hash FROM users WHERE id = ?', [$me['id']])->fetch();
        if (!password_verify((string)($in['old'] ?? ''), $u['pass_hash'])) fail('รหัสเดิมไม่ถูกต้อง');
        $new = (string)($in['new'] ?? '');
        if (mb_strlen($new) < 4) fail('รหัสใหม่ต้องยาวอย่างน้อย 4 ตัว');
        if ($new === DEFAULT_PASS) fail('ห้ามใช้รหัสเริ่มต้น');
        q('UPDATE users SET pass_hash = ? WHERE id = ?', [password_hash($new, PASSWORD_DEFAULT), $me['id']]);
        $_SESSION['weak'] = false;
        out(['ok' => true]);

    case 'state': need(); out(state());
    case 'ver': need(); out(['ver' => ver()]);

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
    case 'cancel_open':
        need();
        tx(function () use ($in) {
            $t = lock_table((int)($in['table'] ?? 0));
            if (q('SELECT COUNT(*) FROM order_items WHERE table_id = ?', [$t['id']])->fetchColumn()) fail('โต๊ะมีรายการอาหารแล้ว');
            q('UPDATE dining_tables SET status = ?, opened_at = NULL WHERE id = ?', [$t['resv_name'] === null ? 'free' : 'resv', $t['id']]);
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
                q('UPDATE dining_tables SET opened_at = LEAST(opened_at, ?) WHERE id = ?', [$f['opened_at'], $to]);
            } else {
                q("UPDATE dining_tables SET status = 'busy', resv_name = ?, resv_phone = ?, resv_time = ?, resv_pax = ?, opened_at = ?, disc_type = ?, disc_value = ?, checked_at = ?, checked_total = ? WHERE id = ?",
                    [$f['resv_name'], $f['resv_phone'], $f['resv_time'], $f['resv_pax'], $f['opened_at'], $f['disc_type'], $f['disc_value'], $f['checked_at'], $f['checked_total'], $to]);
            }
            q('UPDATE dining_tables SET ' . CLEAR_TABLE . ' WHERE id = ?', [$from]);
        });
        break;

    /* ---------- order items (staff) ---------- */
    case 'item_add':
        need();
        tx(function () use ($in, $me) {
            $t = lock_table((int)($in['table'] ?? 0));
            if ($t['status'] !== 'busy') fail('ยังไม่ได้เปิดโต๊ะ');
            $m = q('SELECT * FROM menu WHERE id = ? AND active = 1', [(int)($in['menu'] ?? 0)])->fetch() ?: fail('ไม่พบเมนู');
            if ($m['out_of_stock']) fail('เมนูนี้หมด');
            $ex = q("SELECT id FROM order_items WHERE table_id = ? AND menu_id = ? AND price = ? AND note = ''", [$t['id'], $m['id'], $m['price']])->fetchColumn();
            if ($ex) q('UPDATE order_items SET qty = qty + 1 WHERE id = ?', [$ex]);
            else q('INSERT INTO order_items (table_id, menu_id, name, price, qty, created_by) VALUES (?, ?, ?, ?, 1, ?)', [$t['id'], $m['id'], $m['name'], $m['price'], $me['id']]);
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
            else q('UPDATE order_items SET qty = ?, sent = LEAST(sent, ?) WHERE id = ?', [$qty, $qty, $i['id']]);
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
                q('UPDATE order_items SET qty = ?, sent = LEAST(sent, ?) WHERE id = ?', [$qty, $qty, $i['id']]);
                q('INSERT INTO order_items (table_id, menu_id, name, price, qty, sent, note, created_by) VALUES (?, ?, ?, ?, 1, ?, ?, ?)',
                    [$i['table_id'], $i['menu_id'], $i['name'], $i['price'], $splitSent, $note, $i['created_by']]);
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
    case 'check_bill':
        // customer asked for the bill: remember the total so staff see if it changes before payment
        need();
        tx(function () use ($in) {
            $t = lock_table((int)($in['table'] ?? 0));
            if ($t['status'] !== 'busy') fail('โต๊ะไม่มีลูกค้า');
            $items = q('SELECT price, qty FROM order_items WHERE table_id = ?', [$t['id']])->fetchAll();
            if (!$items) fail('ไม่มีรายการ');
            $c = calc($items, $t['disc_type'], $t['disc_value'], settings());
            q('UPDATE dining_tables SET checked_at = ?, checked_total = ? WHERE id = ?', [now(), $c['total'], $t['id']]);
        });
        break;
    case 'pay':
        need();
        $extra['bill'] = tx(function () use ($in, $me) {
            $t = lock_table((int)($in['table'] ?? 0));
            $items = q('SELECT * FROM order_items WHERE table_id = ? ORDER BY id', [$t['id']])->fetchAll();
            if (!$items) fail('ไม่มีรายการ');
            $method = in_array($in['method'] ?? '', ['cash', 'qr', 'transfer', 'card'], true) ? $in['method'] : fail('วิธีชำระไม่ถูกต้อง');
            $s = settings();
            $c = calc($items, $t['disc_type'], $t['disc_value'], $s);
            $cash = isset($in['cash']) && $method === 'cash' ? (money($in['cash']) ?? fail('จำนวนเงินที่รับไม่ถูกต้อง')) : null;
            if ($cash !== null && $cash < $c['total']) fail('รับเงินไม่พอ');
            q('INSERT INTO bills (table_name, created_at, sub, disc, service, vat, total, service_pct, vat_pct, method, cash, change_amt, cashier_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
                [$t['name'], now(), $c['sub'], $c['disc'], $c['service'], $c['vat'], $c['total'], (float)$s['service'], (float)$s['vat'],
                 $method, $cash, $cash === null ? null : round($cash - $c['total'], 2), $me['id']]);
            global $pdo;
            $no = (int)$pdo->lastInsertId();
            foreach ($items as $i) q('INSERT INTO bill_items (bill_id, name, price, qty, note) VALUES (?, ?, ?, ?, ?)', [$no, $i['name'], $i['price'], $i['qty'], $i['note']]);
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
                q("INSERT INTO bills (table_name, created_at, sub, disc, service, vat, total, service_pct, vat_pct, method, cashier_id, void, void_by) VALUES (?,?,?,?,?,?,?,?,?,'cash',?,1,?)",
                    [$t['name'], now(), $c['sub'], $c['disc'], $c['service'], $c['vat'], $c['total'], (float)$s['service'], (float)$s['vat'], $me['id'], $me['id']]);
                $no = (int)$pdo->lastInsertId();
                foreach ($items as $i) q('INSERT INTO bill_items (bill_id, name, price, qty, note) VALUES (?, ?, ?, ?, ?)', [$no, $i['name'], $i['price'], $i['qty'], $i['note']]);
                q('DELETE FROM order_items WHERE table_id = ?', [$t['id']]);
            }
            q('UPDATE dining_tables SET ' . CLEAR_TABLE . ' WHERE id = ?', [$t['id']]);
        });
        break;
    case 'menu_save':
        need('menu');
        tx(function () use ($in) {
            $name = str($in, 'name');
            $price = money($in['price'] ?? null);
            if ($name === '' || $price === null) fail('ใส่ชื่อและราคาให้ถูกต้อง');
            $id = (int)($in['id'] ?? 0);
            if ($id && !q('SELECT id FROM menu WHERE id = ? AND active = 1 FOR UPDATE', [$id])->fetch()) fail('เมนูนี้ถูกลบไปแล้ว (อาจลบจากเครื่องอื่น)');
            if (q('SELECT id FROM menu WHERE name = ? AND active = 1 AND id <> ?', [$name, $id])->fetch()) fail('มีเมนูชื่อนี้อยู่แล้ว');
            if (!empty($in['id'])) q('UPDATE menu SET name = ?, price = ?, cat = ? WHERE id = ?', [$name, $price, str($in, 'cat', 100), (int)$in['id']]);
            else q('INSERT INTO menu (name, price, cat) VALUES (?, ?, ?)', [$name, $price, str($in, 'cat', 100)]);
            global $pdo;
            return (int)($in['id'] ?? 0) ?: (int)$pdo->lastInsertId();
        });
        break;
    case 'menu_add_order':
        // admin adds a brand-new dish from the table screen and orders it at once
        need('menu');
        tx(function () use ($in, $me) {
            global $pdo;
            $t = lock_table((int)($in['table'] ?? 0));
            if ($t['status'] !== 'busy') fail('ยังไม่ได้เปิดโต๊ะ');
            $name = str($in, 'name');
            $price = money($in['price'] ?? null);
            if ($name === '' || $price === null) fail('ใส่ชื่อและราคาให้ถูกต้อง');
            q('INSERT INTO menu (name, price, cat) VALUES (?, ?, ?)', [$name, $price, str($in, 'cat', 100)]);
            q('INSERT INTO order_items (table_id, menu_id, name, price, qty, created_by) VALUES (?, ?, ?, ?, 1, ?)', [$t['id'], (int)$pdo->lastInsertId(), $name, $price, $me['id']]);
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
    case 'menu_del':
        need('menu');
        tx(fn() => q('UPDATE menu SET active = 0 WHERE id = ?', [(int)($in['id'] ?? 0)]));
        break;
    case 'settings_save':
        need('settings');
        tx(function () use ($in) {
            // a negative or >100 percentage would make every bill wrong
            foreach (['service', 'vat'] as $k) {
                if (!is_numeric($in[$k] ?? 0) || $in[$k] < 0 || $in[$k] > 100) fail('Service / VAT ต้องอยู่ระหว่าง 0–100%');
            }
            foreach (['name', 'addr', 'phone', 'service', 'vat', 'promptpay', 'footer'] as $k) {
                q('INSERT INTO settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)', [$k, str($in, $k, 500)]);
            }
        });
        break;
    case 'table_add':
        need('settings');
        tx(function () use ($in) {
            $name = str($in, 'name', 50);
            if ($name === '') fail('ใส่ชื่อโต๊ะ');
            q('INSERT INTO dining_tables (name, sort) SELECT ?, COALESCE(MAX(sort), 0) + 1 FROM dining_tables', [$name]);
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
        $date = preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET['date'] ?? '') ? $_GET['date'] : date('Y-m-d');
        $rows = q('SELECT b.*, u.name AS cashier FROM bills b LEFT JOIN users u ON u.id = b.cashier_id WHERE b.created_at >= ? AND b.created_at < ? + INTERVAL 1 DAY ORDER BY b.id',
            [$date, $date])->fetchAll();
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
                q("SELECT method, SUM(total) amt FROM bills WHERE void = 0 AND $range GROUP BY method ORDER BY amt DESC", [$from, $to])->fetchAll()),
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
    case 'users':
        need('users');
        out(['users' => array_map(fn($u) => ['id' => (int)$u['id'], 'username' => $u['username'], 'name' => $u['name'], 'role' => $u['role'], 'perms' => perms_of($u)],
            q('SELECT id, username, name, role, perms FROM users WHERE active = 1 ORDER BY role, id')->fetchAll())]);
    case 'user_save':
        need('users');
        $id = (int)($in['id'] ?? 0);
        $username = str($in, 'username', 50); $name = str($in, 'name', 100);
        $role = ($in['role'] ?? '') === 'admin' ? 'admin' : 'staff';
        $perms = $role === 'admin' ? [] : array_values(array_intersect(array_keys(PERMS), (array)($in['perms'] ?? [])));
        $pass = (string)($in['password'] ?? '');
        if ($username === '' || $name === '') fail('ใส่ชื่อผู้ใช้และชื่อ');
        if (!$id && mb_strlen($pass) < 4) fail('รหัสผ่านต้องยาวอย่างน้อย 4 ตัว');
        if ($pass !== '' && mb_strlen($pass) < 4) fail('รหัสผ่านต้องยาวอย่างน้อย 4 ตัว');
        $target = $id ? (q('SELECT role, perms FROM users WHERE id = ? AND active = 1', [$id])->fetch() ?: fail('ไม่พบผู้ใช้')) : null;
        if ($me['role'] !== 'admin') {
            // someone given "manage users" must not be able to hand out more than they have
            if ($role === 'admin' || ($target && $target['role'] === 'admin')) fail('เฉพาะเจ้าของร้านเท่านั้นที่ตั้ง/แก้บัญชีเจ้าของร้านได้', 403);
            if (array_diff($perms, $me['perms'])) fail('ให้สิทธิ์ที่ตัวเองไม่มีไม่ได้', 403);
            if ($id === $me['id']) $perms = perms_of($target);
        }
        if ($id === $me['id'] && $me['role'] === 'admin' && $role !== 'admin') fail('ลดสิทธิ์ตัวเองไม่ได้');
        if (q('SELECT id FROM users WHERE username = ? AND id <> ?', [$username, $id])->fetch()) fail('ชื่อผู้ใช้นี้มีแล้ว');
        if ($id) {
            q('UPDATE users SET username = ?, name = ?, role = ?, perms = ? WHERE id = ?', [$username, $name, $role, implode(',', $perms), $id]);
            if ($pass !== '') q('UPDATE users SET pass_hash = ? WHERE id = ?', [password_hash($pass, PASSWORD_DEFAULT), $id]);
        } else {
            q('INSERT INTO users (username, pass_hash, name, role, perms) VALUES (?, ?, ?, ?, ?)', [$username, password_hash($pass, PASSWORD_DEFAULT), $name, $role, implode(',', $perms)]);
        }
        out(['ok' => true]);
    case 'user_del':
        need('users');
        $id = (int)($in['id'] ?? 0);
        if ($id === $me['id']) fail('ลบตัวเองไม่ได้');
        if ($me['role'] !== 'admin' && q("SELECT 1 FROM users WHERE id = ? AND role = 'admin'", [$id])->fetch()) fail('เฉพาะเจ้าของร้านเท่านั้นที่ลบบัญชีเจ้าของร้านได้', 403);
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
