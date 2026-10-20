SET NAMES utf8mb4;

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  pass_hash VARCHAR(255) NOT NULL,
  name VARCHAR(100) NOT NULL,
  role ENUM('admin','staff') NOT NULL DEFAULT 'staff',
  perms VARCHAR(200) NOT NULL DEFAULT '',
  active TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE settings (
  k VARCHAR(50) PRIMARY KEY,
  v VARCHAR(500) NOT NULL DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- change counter: clients poll it to know when to reload
CREATE TABLE meta (
  k VARCHAR(50) PRIMARY KEY,
  v BIGINT NOT NULL DEFAULT 0
) ENGINE=InnoDB;

CREATE TABLE menu (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  cat VARCHAR(100) NOT NULL DEFAULT '',
  out_of_stock TINYINT(1) NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dining_tables (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  sort INT NOT NULL DEFAULT 0,
  status ENUM('free','resv','busy') NOT NULL DEFAULT 'free',
  resv_name VARCHAR(100) NULL,
  resv_phone VARCHAR(30) NULL,
  resv_time VARCHAR(20) NULL,
  resv_pax INT NULL,
  opened_at DATETIME NULL,
  disc_type ENUM('amt','pct') NULL,
  disc_value DECIMAL(10,2) NULL,
  checked_at DATETIME NULL,
  checked_total DECIMAL(10,2) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  table_id INT NOT NULL,
  menu_id INT NULL,
  name VARCHAR(150) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  qty INT NOT NULL,
  sent INT NOT NULL DEFAULT 0,
  note VARCHAR(200) NOT NULL DEFAULT '',
  created_by INT NULL,
  INDEX (table_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE bills (
  id INT AUTO_INCREMENT PRIMARY KEY,
  table_name VARCHAR(50) NOT NULL,
  created_at DATETIME NOT NULL,
  sub DECIMAL(10,2) NOT NULL,
  disc DECIMAL(10,2) NOT NULL DEFAULT 0,
  service DECIMAL(10,2) NOT NULL DEFAULT 0,
  vat DECIMAL(10,2) NOT NULL DEFAULT 0,
  total DECIMAL(10,2) NOT NULL,
  service_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
  vat_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
  method ENUM('cash','qr','transfer','card') NOT NULL,
  cash DECIMAL(10,2) NULL,
  change_amt DECIMAL(10,2) NULL,
  cashier_id INT NULL,
  void TINYINT(1) NOT NULL DEFAULT 0,
  void_by INT NULL,
  INDEX (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE bill_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  bill_id INT NOT NULL,
  name VARCHAR(150) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  qty INT NOT NULL,
  note VARCHAR(200) NOT NULL DEFAULT '',
  INDEX (bill_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS expenses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  spent_on DATE NOT NULL,
  cat VARCHAR(100) NOT NULL DEFAULT '',
  note VARCHAR(200) NOT NULL DEFAULT '',
  amount DECIMAL(10,2) NOT NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL,
  INDEX (spent_on)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO meta (k, v) VALUES ('ver', 1);

INSERT INTO settings (k, v) VALUES
  ('name', 'โคขุน'), ('addr', ''), ('phone', ''), ('service', '0'), ('vat', '0'),
  ('promptpay', ''), ('footer', 'ขอบคุณที่ใช้บริการ');

INSERT INTO dining_tables (name, sort) VALUES
  ('1', 1),
  ('2', 2),
  ('3', 3),
  ('4', 4),
  ('5', 5),
  ('6', 6),
  ('7', 7),
  ('8', 8),
  ('9', 9),
  ('10', 10),
  ('11', 11),
  ('12', 12),
  ('13', 13),
  ('14', 14),
  ('15', 15),
  ('16', 16),
  ('17', 17),
  ('18', 18),
  ('19', 19),
  ('20', 20),
  ('21', 21),
  ('22', 22),
  ('23', 23),
  ('24', 24),
  ('25', 25);

-- the menu starts empty: staff add dishes from the menu tab or from an open table
