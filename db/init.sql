SET NAMES utf8mb4;

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  pass_hash VARCHAR(255) NOT NULL,
  name VARCHAR(100) NOT NULL,
  role ENUM('admin','staff') NOT NULL DEFAULT 'staff',
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

-- sample menu, typical Isan/Thai prices: edit to match the real shop
INSERT INTO menu (name, price, cat) VALUES
  ('ผัดกะเพราหมูสับ', 80, 'กับข้าว'),
  ('ผัดกะเพราเนื้อ', 100, 'กับข้าว'),
  ('หมูทอดกระเทียม', 80, 'กับข้าว'),
  ('ไก่ผัดเม็ดมะม่วง', 100, 'กับข้าว'),
  ('ผัดผักบุ้งไฟแดง', 60, 'กับข้าว'),
  ('ผัดผักรวม', 60, 'กับข้าว'),
  ('ไข่เจียวหมูสับ', 50, 'กับข้าว'),
  ('ไข่เจียว', 40, 'กับข้าว'),
  ('ไข่ดาว', 10, 'กับข้าว'),
  ('ผัดพริกแกงหมู', 80, 'กับข้าว'),
  ('หมูผัดพริกเกลือ', 90, 'กับข้าว'),
  ('ปลานิลทอด', 150, 'กับข้าว'),
  ('ปลาช่อนลุยสวน', 220, 'กับข้าว'),
  ('กุ้งผัดพริกเผา', 150, 'กับข้าว'),
  ('ปลาหมึกผัดไข่เค็ม', 150, 'กับข้าว'),
  ('ผัดเปรี้ยวหวาน', 90, 'กับข้าว'),
  ('ข้าวผัดหมู', 50, 'จานเดียว'),
  ('ข้าวผัดกุ้ง', 60, 'จานเดียว'),
  ('ข้าวกะเพราหมูสับไข่ดาว', 55, 'จานเดียว'),
  ('ข้าวหมูทอดกระเทียม', 50, 'จานเดียว'),
  ('ข้าวไข่เจียวหมูสับ', 45, 'จานเดียว'),
  ('ผัดซีอิ๊ว', 50, 'จานเดียว'),
  ('ราดหน้า', 50, 'จานเดียว'),
  ('ผัดไทยกุ้ง', 60, 'จานเดียว'),
  ('สุกี้น้ำ/แห้ง', 55, 'จานเดียว'),
  ('ส้มตำไทย', 50, 'อีสาน'),
  ('ส้มตำปูปลาร้า', 50, 'อีสาน'),
  ('ตำซั่ว', 60, 'อีสาน'),
  ('ตำถั่ว', 50, 'อีสาน'),
  ('ตำแตง', 50, 'อีสาน'),
  ('ลาบหมู', 70, 'อีสาน'),
  ('ลาบเนื้อ', 90, 'อีสาน'),
  ('ลาบเป็ด', 90, 'อีสาน'),
  ('น้ำตกหมู', 70, 'อีสาน'),
  ('น้ำตกเนื้อ', 90, 'อีสาน'),
  ('ก้อยเนื้อ', 90, 'อีสาน'),
  ('ซกเล็ก', 90, 'อีสาน'),
  ('ซุปหน่อไม้', 50, 'อีสาน'),
  ('ไก่ย่าง (ครึ่งตัว)', 90, 'อีสาน'),
  ('คอหมูย่าง', 80, 'อีสาน'),
  ('ตับย่าง', 70, 'อีสาน'),
  ('ไส้กรอกอีสาน', 60, 'อีสาน'),
  ('แจ่วฮ้อน (ชุด)', 250, 'อีสาน'),
  ('เสือร้องไห้', 120, 'เนื้อย่าง'),
  ('เนื้อโคขุนย่าง (ไม้)', 25, 'เนื้อย่าง'),
  ('สันนอกโคขุน', 199, 'เนื้อย่าง'),
  ('สันในโคขุน', 249, 'เนื้อย่าง'),
  ('ริบอายโคขุน', 299, 'เนื้อย่าง'),
  ('สเต็กสะโพก', 99, 'เนื้อย่าง'),
  ('ลิ้นวัวย่าง', 150, 'เนื้อย่าง'),
  ('ตับวัวย่าง', 100, 'เนื้อย่าง'),
  ('ต้มยำกุ้งน้ำข้น', 150, 'ต้ม/แกง'),
  ('ต้มยำกุ้งน้ำใส', 150, 'ต้ม/แกง'),
  ('ต้มแซ่บกระดูกอ่อน', 100, 'ต้ม/แกง'),
  ('ต้มแซ่บเนื้อ', 120, 'ต้ม/แกง'),
  ('ต้มข่าไก่', 100, 'ต้ม/แกง'),
  ('แกงเขียวหวานไก่', 90, 'ต้ม/แกง'),
  ('แกงป่าหมู', 90, 'ต้ม/แกง'),
  ('แกงจืดเต้าหู้หมูสับ', 80, 'ต้ม/แกง'),
  ('ต้มเลือดหมู', 70, 'ต้ม/แกง'),
  ('ต้มขมเนื้อ', 120, 'ต้ม/แกง'),
  ('ยำวุ้นเส้น', 80, 'ยำ'),
  ('ยำหมูยอ', 80, 'ยำ'),
  ('ยำเห็ดเข็มทอง', 80, 'ยำ'),
  ('ยำปลาดุกฟู', 90, 'ยำ'),
  ('ยำส้มตีน', 100, 'ยำ'),
  ('ยำทะเล', 150, 'ยำ'),
  ('พล่ากุ้ง', 150, 'ยำ'),
  ('กุ้งแช่น้ำปลา', 150, 'ยำ'),
  ('แหนมทอด', 70, 'ของทอด/กับแกล้ม'),
  ('หมูแดดเดียว', 80, 'ของทอด/กับแกล้ม'),
  ('เนื้อแดดเดียว', 100, 'ของทอด/กับแกล้ม'),
  ('ไก่ทอด', 80, 'ของทอด/กับแกล้ม'),
  ('ปีกไก่ทอด', 90, 'ของทอด/กับแกล้ม'),
  ('เอ็นข้อไก่ทอด', 80, 'ของทอด/กับแกล้ม'),
  ('ทอดมันปลา', 80, 'ของทอด/กับแกล้ม'),
  ('เฟรนช์ฟรายส์', 60, 'ของทอด/กับแกล้ม'),
  ('ถั่วลิสงทอด', 40, 'ของทอด/กับแกล้ม'),
  ('เต้าหู้ทอด', 50, 'ของทอด/กับแกล้ม'),
  ('ข้าวสวย', 10, 'ข้าว'),
  ('ข้าวเหนียว', 10, 'ข้าว'),
  ('ข้าวสวย (โถ)', 40, 'ข้าว'),
  ('ข้าวเหนียว (กระติ๊บใหญ่)', 30, 'ข้าว'),
  ('ขนมจีน', 10, 'ข้าว'),
  ('น้ำเปล่า', 10, 'เครื่องดื่ม'),
  ('น้ำแข็ง (ถัง)', 20, 'เครื่องดื่ม'),
  ('โค้ก/แฟนต้า/สไปรท์', 20, 'เครื่องดื่ม'),
  ('โซดา', 15, 'เครื่องดื่ม'),
  ('ชาเย็น', 35, 'เครื่องดื่ม'),
  ('ชาดำเย็น', 30, 'เครื่องดื่ม'),
  ('กาแฟเย็น', 40, 'เครื่องดื่ม'),
  ('ชามะนาว', 35, 'เครื่องดื่ม'),
  ('น้ำมะพร้าว', 40, 'เครื่องดื่ม'),
  ('เบียร์ช้าง (ขวดใหญ่)', 75, 'เครื่องดื่ม'),
  ('เบียร์ลีโอ (ขวดใหญ่)', 75, 'เครื่องดื่ม'),
  ('เบียร์สิงห์ (ขวดใหญ่)', 85, 'เครื่องดื่ม'),
  ('ข้าวเหนียวมะม่วง', 80, 'ของหวาน'),
  ('ไอศกรีมกะทิ', 30, 'ของหวาน'),
  ('บัวลอยไข่หวาน', 40, 'ของหวาน'),
  ('ทับทิมกรอบ', 40, 'ของหวาน'),
  ('ขนมปังปิ้งสังขยา', 40, 'ของหวาน');
