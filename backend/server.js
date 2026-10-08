// ================= IMPORT REQUIRED PACKAGES =================
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const multer = require("multer");
const path = require("path");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const adminApi = require('./admin-api');
const fs = require('fs'); 
// ================= INITIALIZE APP =================
const app = express();

// ================= CREATE UPLOAD DIRECTORIES =================
// ADD THIS BLOCK RIGHT HERE
const uploadDirs = ['uploads', 'uploads/images', 'uploads/videos', 'uploads/documents'];
uploadDirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`✅ Created directory: ${dir}`);
  }
});

// UPDATED CORS
app.use(cors({
  origin: true,
  credentials: true
}));

app.use(cookieParser());
app.use(express.json());
app.use('/api/admin', adminApi);

// serve uploaded files
app.use("/uploads", express.static("uploads"));

console.log("Starting server...");

// ================= DATABASE CONNECTION =================
const pool = new Pool({
  user: "postgres",
  host: "127.0.0.1",
  database: "realestate",
  password: "realestate",
  port: 5432,
});

pool.on("connect", () => {
  console.log("Connected to PostgreSQL");
});

pool.on("error", (err) => {
  console.error("Unexpected DB error:", err);
});

// =========================================================
// ============ AUTH HELPERS ================================
// =========================================================

function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

function createToken(user) {
  return jwt.sign(
    { userId: user.id, role: user.role },
    "my_secret_key",
    { expiresIn: "12h" }
  );
}

function setSessionCookie(res, token) {
  res.cookie("token", token, {
    httpOnly: true,
    secure: false,
    sameSite: "lax"
  });
}

function verifyToken(req, res, next) {
  try {
    const token = req.cookies.token;
    if (!token) {
      return res.status(401).json({ message: "غير مسجل دخول" });
    }
    const decoded = jwt.verify(token, "my_secret_key");
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: "جلسة غير صالحة" });
  }
}

// =========================================================
// ============ AUTH ROUTES =================================
// =========================================================

// SIGNUP START
app.post("/api/auth/signup/start", async (req, res) => {
  try {
    const { national_id, full_name, phone, email, role } = req.body;

    if (!national_id || !full_name || !phone || !role) {
      return res.status(400).json({ message: "بيانات ناقصة" });
    }
    if (!["searcher", "owner"].includes(role)) {
      return res.status(400).json({ message: "الدور غير صحيح" });
    }

     // ================= VALIDATION =================

    // الهوية الوطنية
    if (!/^\d{10}$/.test(national_id)) {
      return res.status(400).json({
        message: "رقم الهوية يجب أن يكون 10 أرقام"
      });
    }

    // رقم الجوال
    if (!/^05\d{8}$/.test(phone)) {
      return res.status(400).json({
        message: "رقم الجوال غير صحيح"
      });
    }

    // الإيميل (اختياري)
    if (
      email &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      return res.status(400).json({
        message: "صيغة الإيميل غير صحيحة"
      });
    }

    // ==============================================

    const exists = await pool.query(
      "SELECT id FROM users WHERE phone=$1 OR national_id=$2",
      [phone, national_id]
    );
    if (exists.rows.length > 0) {
      return res.status(400).json({ message: "يوجد حساب مسبقاً بنفس الجوال أو الهوية" });
    }

    const code = generateOTP();
    const expiresAt = addMinutes(new Date(), 5);

    await pool.query(
      `INSERT INTO otp_requests (phone, code, purpose, payload, expires_at)
       VALUES ($1, $2, 'signup', $3, $4)`,
      [phone, code, { national_id, full_name, phone, email, role }, expiresAt]
    );

    console.log("✅ SIGNUP OTP:", phone, code);
    res.json({ message: "تم إرسال رمز التحقق." });
  } catch (err) {
    console.error("signup/start error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// SIGNUP VERIFY - Add welcome notification
app.post("/api/auth/signup/verify", async (req, res) => {
  try {
    const { phone, code } = req.body;

    if (!phone || !code) {
      return res.status(400).json({ message: "بيانات ناقصة" });
    }

    const otpRes = await pool.query(
      `SELECT * FROM otp_requests
       WHERE phone=$1 AND code=$2 AND purpose='signup'
       ORDER BY created_at DESC LIMIT 1`,
      [phone, code]
    );

    if (otpRes.rows.length === 0) {
      return res.status(400).json({ message: "الرمز غير صحيح" });
    }

    const row = otpRes.rows[0];
    if (new Date(row.expires_at) < new Date()) {
      return res.status(400).json({ message: "انتهت صلاحية الرمز" });
    }

    const payload = row.payload;

    const insert = await pool.query(
      `INSERT INTO users (national_id, full_name, phone, email, role)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, national_id, full_name, phone, email, role`,
      [payload.national_id, payload.full_name, payload.phone, payload.email || null, payload.role]
    );

    const user = insert.rows[0];
    const token = createToken(user);
    setSessionCookie(res, token);

    await pool.query("DELETE FROM otp_requests WHERE id=$1", [row.id]);

    // ===== ADD WELCOME NOTIFICATION =====
    const welcomeMessage = `مرحباً بك ${user.full_name} في نقطة وصل! 🎉\n\nنحن سعداء بانضمامك إلينا. يمكنك الآن ${user.role === 'owner' ? 'إضافة عقاراتك ونشر إعلاناتك' : 'البحث عن العقارات المناسبة والتواصل مع الملاك مباشرة'}.\n\nلا تتردد في التواصل مع الدعم الفني إذا احتجت أي مساعدة.`;
    
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, message, related_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, 'welcome', '🎉 مرحباً بك في نقطة وصل', welcomeMessage, null]
    );

    const redirect = user.role === "owner" ? "owner_profile.html" : "searcher_profile.html";

    res.json({ message: "تم إنشاء الحساب", user, redirect });
  } catch (err) {
    console.error("signup/verify error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// LOGIN START
app.post("/api/auth/login/start", async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ message: "رقم الجوال مطلوب" });
    }

    const userRes = await pool.query("SELECT id FROM users WHERE phone=$1", [phone]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ message: "لا يوجد حساب بهذا الجوال" });
    }

    const code = generateOTP();
    const expiresAt = addMinutes(new Date(), 5);

    await pool.query(
      `INSERT INTO otp_requests (phone, code, purpose, payload, expires_at)
       VALUES ($1, $2, 'login', NULL, $3)`,
      [phone, code, expiresAt]
    );

    console.log("✅ LOGIN OTP:", phone, code);
    res.json({ message: "تم إرسال رمز التحقق." });
  } catch (err) {
    console.error("login/start error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// LOGIN VERIFY
app.post("/api/auth/login/verify", async (req, res) => {
  try {
    const { phone, code } = req.body;

    if (!phone || !code) {
      return res.status(400).json({ message: "بيانات ناقصة" });
    }

    const otpRes = await pool.query(
      `SELECT * FROM otp_requests
       WHERE phone=$1 AND code=$2 AND purpose='login'
       ORDER BY created_at DESC LIMIT 1`,
      [phone, code]
    );

    if (otpRes.rows.length === 0) {
      return res.status(400).json({ message: "الرمز غير صحيح" });
    }

    const row = otpRes.rows[0];
    if (new Date(row.expires_at) < new Date()) {
      return res.status(400).json({ message: "انتهت صلاحية الرمز" });
    }

    const userRes = await pool.query(
      "SELECT id, national_id, full_name, phone, email, role FROM users WHERE phone=$1",
      [phone]
    );

    if (userRes.rows.length === 0) {
      return res.status(404).json({ message: "المستخدم غير موجود" });
    }

    const user = userRes.rows[0];
    const token = createToken(user);
    setSessionCookie(res, token);

    await pool.query("DELETE FROM otp_requests WHERE id=$1", [row.id]);

    let redirect = "searcher_profile.html";
    if (user.role === "owner") redirect = "owner_profile.html";
    if (user.role === "admin") redirect = "admin.html";

    res.json({ message: "تم تسجيل الدخول", user, redirect });
  } catch (err) {
    console.error("login/verify error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// CURRENT USER
app.get("/api/auth/me", async (req, res) => {
  try {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ message: "غير مسجل دخول" });

    const decoded = jwt.verify(token, "my_secret_key");
    const result = await pool.query(
      "SELECT id, national_id, full_name, phone, email, role, status FROM users WHERE id=$1",
      [decoded.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: "المستخدم غير موجود" });

    res.json(result.rows[0]);
  } catch (err) {
    res.status(401).json({ message: "جلسة غير صالحة" });
  }
});

// LOGOUT
app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("token", { httpOnly: true, secure: false, sameSite: "lax" });
  res.json({ message: "تم تسجيل الخروج" });
});

// =========================================================
// ============ USER PROFILE ROUTES =========================
// =========================================================

app.get("/api/users/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, national_id, full_name, phone, email, role, status, created_at FROM users WHERE id=$1",
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: "المستخدم غير موجود" });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

app.put("/api/users/:id", async (req, res) => {
  try {
    const { full_name, email } = req.body;

    if (!full_name) {
      return res.status(400).json({ message: "الاسم الكامل مطلوب" });
    }

    const result = await pool.query(
      `UPDATE users 
       SET full_name=$1, email=$2
       WHERE id=$3
       RETURNING id, national_id, full_name, phone, email, role`,
      [full_name, email || null, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "المستخدم غير موجود" });
    }

    res.json({
      message: "تم حفظ البيانات",
      user: result.rows[0]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// =========================================================
// ============ OWNER PROPERTIES ============================
// =========================================================

app.get("/api/my-properties/:ownerId", verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
  `SELECT 
    p.id,
    p.title,
    p.city,
    p.price,
    p.status,
    p.created_at,
    p.rejection_reason,
    p.modified_after_rejection,
    (SELECT photo_path
     FROM property_photos
     WHERE property_id = p.id
     LIMIT 1) AS photo
   FROM properties p
   WHERE p.owner_id = $1
   ORDER BY p.created_at DESC`,
  [req.params.ownerId]
);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "خطأ في جلب العقارات" });
  }
});

// =========================================================
// ======================= PROPERTY ROUTES ==================
// =========================================================

// GET ALL PROPERTIES (only active ones for public)
app.get("/api/properties", async (req, res) => {
  try {
    const city = req.query.city;

    if (city) {
      const result = await pool.query(
        "SELECT * FROM properties WHERE city = $1 AND status = 'active'",
        [city]
      );
      return res.json(result.rows);
    }

    const result = await pool.query(
      "SELECT * FROM properties WHERE status = 'active'"
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

// GET PROPERTY BY ID
app.get("/api/properties/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM properties WHERE id = $1",
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).send("Not found");
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

// GET PROPERTY PHOTOS
app.get("/api/properties/:id/photos", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM property_photos WHERE property_id = $1",
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

// GET PROPERTY FEATURES
app.get("/api/properties/:id/features", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT f.name
      FROM property_features pf
      JOIN features f ON pf.feature_id = f.id
      WHERE pf.property_id = $1
    `, [req.params.id]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

// GET PROPERTY WITH PHOTOS & FEATURES
app.get("/api/properties/:id/details", async (req, res) => {
  try {
    const id = req.params.id;
    
    const propertyResult = await pool.query(
      `SELECT p.*, COALESCE(STRING_AGG(f.name, ' - '), '') AS features
       FROM properties p
       LEFT JOIN property_features pf ON pf.property_id = p.id
       LEFT JOIN features f ON f.id = pf.feature_id
       WHERE p.id = $1
       GROUP BY p.id`,
      [id]
    );
    
    if (propertyResult.rows.length === 0) {
      return res.status(404).json({ message: "Not found" });
    }
    
    const photosResult = await pool.query(
      `SELECT photo_path FROM property_photos WHERE property_id = $1`,
      [id]
    );
    
    const property = propertyResult.rows[0];
    property.photos = photosResult.rows;
    
    res.json(property);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// GET PROPERTY OWNER INFO
app.get("/api/properties/:id/owner", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.full_name, u.phone, u.email
      FROM properties p
      JOIN users u ON p.owner_id = u.id
      WHERE p.id = $1
    `, [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Owner not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

// =========================================================
// ================= FILE UPLOAD CONFIG =====================
// =========================================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Route files to correct folders based on field name
    if (file.fieldname === 'images') {
      cb(null, "uploads/images");
    } else if (file.fieldname === 'video') {
      cb(null, "uploads/videos");
    } else if (file.fieldname === 'blueprint' || file.fieldname === 'legal_document') {
      cb(null, "uploads/documents");
    } else {
      cb(null, "uploads");
    }
  },
  filename: (req, file, cb) => {
    // Add prefix to easily identify file types
    let prefix = '';
    if (file.fieldname === 'blueprint') prefix = 'blueprint_';
    if (file.fieldname === 'legal_document') prefix = 'legal_';
    cb(null, prefix + Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ storage });

// =========================================================
// ============ ADD PROPERTY (WITH FILES) ===================
// =========================================================

app.post("/api/properties",
  verifyToken,
  upload.fields([
    { name: "images", maxCount: 10 },
    { name: "video", maxCount: 1 },
    { name: "blueprint", maxCount: 1 },        
    { name: "legal_document", maxCount: 1 }    
  ]),
  async (req, res) => {

    try {
      const p = req.body;
      const ownerId = req.user.userId;

      // Handle blueprint file
      let blueprintUrl = null;
      if (req.files.blueprint) {
        blueprintUrl = `/uploads/documents/${req.files.blueprint[0].filename}`;
      }
      
      // Handle legal document file
      let legalDocumentUrl = null;
      if (req.files.legal_document) {
        legalDocumentUrl = `/uploads/documents/${req.files.legal_document[0].filename}`;
      }

      console.log("BODY:", p);
      console.log("FILES:", req.files);
      console.log("OWNER ID:", ownerId);

 const result = await pool.query(`
        INSERT INTO properties (
          title, description, price,
          city, district, neighborhood,
          area_space, bedrooms, bathrooms,
          property_type, listing_type, usage,
          facade, property_age,
          lat, lng,
          ad_number,
          owner_id,
          blueprint_url,
          legal_document_url,
          status,
          created_at
        )
        VALUES (
          $1,$2,$3,
          $4,$5,$6,
          $7,$8,$9,
          $10,$11,$12,
          $13,$14,
          $15,$16,
          $17,
          $18,
          $19,$20,
          'pending',
          NOW()
        )
        RETURNING id
      `, [
        p.title,
        p.description,
        p.price,
        p.city,
        p.district,
        p.neighborhood,
        p.area_space,
        p.bedrooms,
        p.bathrooms,
        p.property_type,
        p.listing_type,
        p.usage,
        p.facade,
        p.property_age,
        p.lat,
        p.lng,
        "AD-" + Date.now(),
        ownerId,
        blueprintUrl,
        legalDocumentUrl
      ]);

      const propertyId = result.rows[0].id;

      // FEATURES
      if (p.features) {
        const features = Array.isArray(p.features) ? p.features : [p.features];

        for (let f of features) {
          await pool.query(
            "INSERT INTO property_features (property_id, feature_id) VALUES ($1,$2)",
            [propertyId, Number(f)]
          );
        }
      }

      // IMAGES
      if (req.files.images) {
        for (let file of req.files.images) {
          await pool.query(
            "INSERT INTO property_photos (property_id, photo_path) VALUES ($1,$2)",
            [propertyId, `/uploads/images/${file.filename}`]
          );
        }
      }

      // VIDEO
      if (req.files.video) {
        const videoPath = `/uploads/videos/${req.files.video[0].filename}`;
        await pool.query(
          "UPDATE properties SET video_url = $1 WHERE id = $2",
          [videoPath, propertyId]
        );
      }

      res.json({ id: propertyId, message: "تم إضافة العقار بنجاح" });

    } catch (err) {
      console.error(err);
      res.status(500).send("Insert failed");
    }
});

// =========================================================
// ACTIVATE PROPERTY AFTER PAYMENT (WITH PAYMENT LOGGING)
// =========================================================
// =========================================================
// ACTIVATE PROPERTY AFTER PAYMENT (Simpler version)
// =========================================================
app.put("/api/properties/:id/activate", verifyToken, async (req, res) => {
  try {
    const propertyId = req.params.id;
    const ownerId = req.user.userId;
    
    console.log("💰 Activating property:", propertyId, "for owner:", ownerId);
    
    // First, check if property exists and belongs to this owner
    const checkResult = await pool.query(
      `SELECT p.id, p.title, p.status, u.full_name 
       FROM properties p
       JOIN users u ON p.owner_id = u.id
       WHERE p.id = $1 AND p.owner_id = $2`,
      [propertyId, ownerId]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ message: "العقار غير موجود أو لا يخصك" });
    }
    
    const property = checkResult.rows[0];
    
    // Check if property is approved
    if (property.status !== 'approved') {
      return res.status(400).json({ 
        message: `العقار غير جاهز للدفع. الحالة الحالية: ${property.status}` 
      });
    }
    
    // Get payment price from settings
    const priceResult = await pool.query("SELECT value FROM settings WHERE key = 'payment_price'");
    let paidAmount = 100; // Default
    if (priceResult.rows.length > 0) {
      paidAmount = parseInt(priceResult.rows[0].value);
    }
    
    console.log("💰 Payment amount:", paidAmount);
    
    // Update property status to active (without updated_at)
    const updateResult = await pool.query(
      `UPDATE properties 
       SET status = 'active'
       WHERE id = $1 AND owner_id = $2 
       RETURNING *`,
      [propertyId, ownerId]
    );
    
    if (updateResult.rows.length === 0) {
      return res.status(500).json({ message: "فشل في تحديث حالة العقار" });
    }
    
    // Create payment log
    try {
      // First, check if payment_logs table exists
      const tableCheck = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'payment_logs'
        )
      `);
      
      if (tableCheck.rows[0].exists) {
        await pool.query(
          `INSERT INTO payment_logs (property_id, owner_id, amount, status, property_title, owner_name, transaction_id)
           VALUES ($1, $2, $3, 'completed', $4, $5, $6)`,
          [propertyId, ownerId, paidAmount, property.title, property.full_name, 'TXN-' + Date.now()]
        );
        console.log("✅ Payment logged successfully");
      } else {
        console.log("⚠️ payment_logs table doesn't exist yet");
      }
    } catch (logError) {
      console.log("⚠️ Payment logging failed but activation succeeded:", logError.message);
      // Don't fail the request just because logging failed
    }
    
    res.json({ 
      message: "تم تفعيل الإعلان بنجاح", 
      property: updateResult.rows[0] 
    });
    
  } catch (err) {
    console.error("❌ Activate error:", err);
    res.status(500).json({ message: "خطأ في تفعيل الإعلان: " + err.message });
  }
});

// =========================================================
// REQUEST REVIEW AFTER REJECTION
// =========================================================
app.put("/api/properties/:id/request-review", verifyToken, async (req, res) => {
  try {
    const propertyId = req.params.id;
    const ownerId = req.user.userId;
    
    const checkResult = await pool.query(
      `SELECT id, status FROM properties WHERE id = $1 AND owner_id = $2`,
      [propertyId, ownerId]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ message: "العقار غير موجود" });
    }
    
    if (checkResult.rows[0].status !== 'rejected') {
      return res.status(400).json({ message: "لا يمكن طلب المراجعة إلا للعقارات المرفوضة" });
    }
    
    const result = await pool.query(
      `UPDATE properties SET status = 'pending', modified_after_rejection = true WHERE id = $1 AND owner_id = $2 RETURNING *`,
      [propertyId, ownerId]
    );
    
    res.json({ message: "تم إرسال طلب المراجعة للإدارة", property: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "خطأ في طلب المراجعة" });
  }
});

// =========================================================
// DELETE PROPERTY (Owner)
// =========================================================
app.delete("/api/properties/:id", verifyToken, async (req, res) => {
  try {
    const propertyId = req.params.id;
    const ownerId = req.user.userId;
    
    const check = await pool.query(
      `SELECT * FROM properties WHERE id = $1 AND owner_id = $2`,
      [propertyId, ownerId]
    );
    
    if (check.rows.length === 0) {
      return res.status(404).json({ message: "العقار غير موجود" });
    }
    
    await pool.query("DELETE FROM property_photos WHERE property_id = $1", [propertyId]);
    await pool.query("DELETE FROM property_features WHERE property_id = $1", [propertyId]);
    await pool.query("DELETE FROM favorites WHERE property_id = $1", [propertyId]);
    await pool.query("DELETE FROM properties WHERE id = $1", [propertyId]);
    
    res.json({ message: "تم حذف العقار" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "خطأ في حذف العقار" });
  }
});

// =========================================================
// ============ FAVORITES ROUTES ============================
// =========================================================

function searcherOnly(req, res, next) {
  if (req.user.role !== "searcher") {
    return res.status(403).json({ message: "فقط الباحث يمكنه استخدام المفضلة" });
  }
  next();
}

app.post("/api/favorites", verifyToken, searcherOnly, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { property_id } = req.body;

    if (!property_id) {
      return res.status(400).json({ message: "معرف العقار مطلوب" });
    }

    const exists = await pool.query(
      "SELECT id FROM favorites WHERE user_id=$1 AND property_id=$2",
      [userId, property_id]
    );

    if (exists.rows.length > 0) {
      return res.status(400).json({ message: "العقار موجود مسبقاً في المفضلة" });
    }

    await pool.query(
      "INSERT INTO favorites (user_id, property_id) VALUES ($1, $2)",
      [userId, property_id]
    );

    res.json({ message: "تمت الإضافة إلى المفضلة" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.delete("/api/favorites/:property_id", verifyToken, searcherOnly, async (req, res) => {
  try {
    const userId = req.user.userId;
    const propertyId = req.params.property_id;

    await pool.query(
      "DELETE FROM favorites WHERE user_id=$1 AND property_id=$2",
      [userId, propertyId]
    );

    res.json({ message: "تمت الإزالة من المفضلة" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/api/favorites", verifyToken, searcherOnly, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(`
      SELECT 
        p.id, p.title, p.price, p.city, p.district,
        p.bedrooms, p.bathrooms, p.area_space,
        p.property_type, p.listing_type,
        (SELECT photo_path FROM property_photos WHERE property_id = p.id LIMIT 1) AS photo
      FROM favorites f
      JOIN properties p ON f.property_id = p.id
      WHERE f.user_id = $1
      ORDER BY f.created_at DESC
    `, [userId]);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/api/favorites/check/:property_id", verifyToken, searcherOnly, async (req, res) => {
  try {
    const userId = req.user.userId;
    const propertyId = req.params.property_id;

    const result = await pool.query(
      "SELECT id FROM favorites WHERE user_id=$1 AND property_id=$2",
      [userId, propertyId]
    );

    res.json({ isFavorited: result.rows.length > 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// =========================================================
// ============ CHAT ROUTES =================================
// =========================================================


app.post("/api/chat/start", verifyToken, async (req, res) => {
  try {
    const propertyId = parseInt(req.body.property_id);
    const searcherId = req.user.userId;

    if (!propertyId) {
      return res.status(400).json({ message: "معرف العقار مطلوب" });
    }

    const propRes = await pool.query(
      "SELECT owner_id FROM properties WHERE id = $1",
      [propertyId]
    );
    
    if (propRes.rows.length === 0) {
      return res.status(404).json({ message: "العقار غير موجود" });
    }

    const ownerId = propRes.rows[0].owner_id;

    // Check existing
    const existing = await pool.query(
      "SELECT id FROM conversations WHERE property_id=$1 AND searcher_id=$2 AND owner_id=$3",
      [propertyId, searcherId, ownerId]
    );

    let conversationId;
    
    if (existing.rows.length > 0) {
      conversationId = existing.rows[0].id;
    } else {
      const newConv = await pool.query(
        "INSERT INTO conversations (property_id, searcher_id, owner_id) VALUES ($1,$2,$3) RETURNING id",
        [propertyId, searcherId, ownerId]
      );
      conversationId = newConv.rows[0].id;
    }

    res.json({ conversationId, ownerId, propertyId });
    
  } catch (err) {
    console.error("Chat start error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
});

// Send message with notification
app.post("/api/chat/send", verifyToken, async (req, res) => {
  try {
    const { conversation_id, message } = req.body;
    const senderId = req.user.userId;

    if (!message || !message.trim()) {
      return res.status(400).json({ message: "الرسالة فارغة" });
    }

    // Get conversation details to know who is the receiver
    const convResult = await pool.query(
      `SELECT c.*, p.title as property_title 
       FROM conversations c
       JOIN properties p ON c.property_id = p.id
       WHERE c.id = $1`,
      [conversation_id]
    );
    
    if (convResult.rows.length === 0) {
      return res.status(404).json({ message: "المحادثة غير موجودة" });
    }
    
    const conversation = convResult.rows[0];
    const receiverId = conversation.owner_id === senderId ? conversation.searcher_id : conversation.owner_id;
    
    // Get sender name
    const senderResult = await pool.query(
      "SELECT full_name FROM users WHERE id = $1",
      [senderId]
    );
    const senderName = senderResult.rows[0]?.full_name || 'مستخدم';

    const result = await pool.query(
      "INSERT INTO messages (conversation_id, sender_id, message) VALUES ($1,$2,$3) RETURNING *",
      [conversation_id, senderId, message.trim()]
    );

    // ===== SEND NOTIFICATION TO RECEIVER =====
    const notificationMessage = `📩 لديك رسالة جديدة من ${senderName} بخصوص "${conversation.property_title}"\n\n"${message.substring(0, 100)}${message.length > 100 ? '...' : ''}"`;
    
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, message, related_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [receiverId, 'new_message', '📩 رسالة جديدة', notificationMessage, conversation_id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/api/chat/messages/:conversation_id", verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT m.*, u.full_name as sender_name
       FROM messages m
       JOIN users u ON m.sender_id = u.id
       WHERE m.conversation_id = $1
       ORDER BY m.created_at ASC`,
      [req.params.conversation_id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/api/chat/conversations", verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const role = req.user.role;

    let result;
    if (role === "owner") {
      result = await pool.query(
        `SELECT c.*, p.title as property_title, p.status as property_status, u.full_name as searcher_name,
          (SELECT message FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
          (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message_time
         FROM conversations c
         JOIN properties p ON c.property_id = p.id
         JOIN users u ON c.searcher_id = u.id
         WHERE c.owner_id = $1
           AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id)
         ORDER BY last_message_time DESC`,
        [userId]
      );
    } else {
      result = await pool.query(
        `SELECT c.*, p.title as property_title, p.status as property_status, u.full_name as owner_name,
          (SELECT message FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
          (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message_time
         FROM conversations c
         JOIN properties p ON c.property_id = p.id
         JOIN users u ON c.owner_id = u.id
         WHERE c.searcher_id = $1
           AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id)
         ORDER BY last_message_time DESC`,
        [userId]
      );
    }

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// =========================================================
// ============ REPORT ROUTES ===============================
// =========================================================
// ================= Submit a Report (with chat message) =================
app.post("/api/reports", verifyToken, async (req, res) => {
  try {
    const { type, description, to_user_id, property_id } = req.body;
    const fromUserId = req.user.userId;
    const fromUserRole = req.user.role;

    if (!type || !to_user_id) {
      return res.status(400).json({ message: "نوع البلاغ والمستخدم المبلغ عنه مطلوبان" });
    }

    const userCheck = await pool.query("SELECT id, role FROM users WHERE id = $1", [to_user_id]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ message: "المستخدم غير موجود" });
    }

    const toUserRole = userCheck.rows[0].role;

    if (fromUserRole === "searcher" && toUserRole !== "owner") {
      return res.status(400).json({ message: "يمكن للباحث الإبلاغ عن المالك فقط" });
    }
    if (fromUserRole === "owner" && toUserRole !== "searcher") {
      return res.status(400).json({ message: "يمكن للمالك الإبلاغ عن الباحث فقط" });
    }

    // Insert report
    const result = await pool.query(
      `INSERT INTO reports (type, description, from_user_id, to_user_id, property_id, status)
       VALUES ($1, $2, $3, $4, $5, 'pending') RETURNING id`,
      [type, description || null, fromUserId, to_user_id, property_id || null]
    );
    
    const reportId = result.rows[0].id;
    
    // ===== SEND CHAT MESSAGE TO CONFIRM REPORT WAS SUBMITTED =====
    // Find conversation between these users
    const convResult = await pool.query(
      `SELECT id FROM conversations 
       WHERE property_id = $1 
       AND ((searcher_id = $2 AND owner_id = $3) OR (searcher_id = $3 AND owner_id = $2))
       LIMIT 1`,
      [property_id, fromUserId, to_user_id]
    );
    
    if (convResult.rows.length > 0) {
      const systemMessage = `📋 **تم إرسال بلاغك إلى الإدارة**\nنوع البلاغ: ${type}\n${description ? `الوصف: ${description}` : ''}\n\nسيتم مراجعة البلاغ رقم ${reportId} من قبل الإدارة قريباً.`;
      
      await pool.query(
        `INSERT INTO messages (conversation_id, sender_id, message) 
         VALUES ($1, $2, $3)`,
        [convResult.rows[0].id, fromUserId, systemMessage]
      );
    }
    
    // Also send a notification to the user (for the bell)
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, message, related_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [fromUserId, 'report_submitted', '📋 تم إرسال بلاغك', `تم إرسال البلاغ رقم ${reportId} بنجاح، سيتم مراجعته من قبل الإدارة.`, reportId]
    );

    res.json({ message: "تم إرسال البلاغ بنجاح وتم إشعار الإدارة", reportId });
  } catch (err) {
    console.error("Report error:", err);
    res.status(500).json({ message: "Server error" });
  }
});


// =========================================================
// MARK DEAL AS COMPLETE (Owner closes the deal)
// =========================================================
app.put("/api/chat/complete-deal", verifyToken, async (req, res) => {
  try {
    const { conversation_id } = req.body;
    const ownerId = req.user.userId;

    const convRes = await pool.query(
      "SELECT property_id, owner_id, searcher_id FROM conversations WHERE id = $1",
      [conversation_id]
    );

    if (convRes.rows.length === 0) {
      return res.status(404).json({ message: "المحادثة غير موجودة" });
    }

    if (convRes.rows[0].owner_id !== ownerId) {
      return res.status(403).json({ message: "غير مصرح لك" });
    }

    // Get property title
    const propInfo = await pool.query(
      "SELECT title FROM properties WHERE id = $1",
      [convRes.rows[0].property_id]
    );
    const propertyTitle = propInfo.rows[0]?.title || 'العقار';

    await pool.query(
      "UPDATE properties SET status = 'closed' WHERE id = $1",
      [convRes.rows[0].property_id]
    );

    await pool.query(
      "INSERT INTO messages (conversation_id, sender_id, message) VALUES ($1, $2, $3)",
      [conversation_id, ownerId, "✅ تمت الصفقة بنجاح! تم إغلاق العقار."]
    );

    // ===== NOTIFY BOTH PARTIES =====
    // Notify owner
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, message, related_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [ownerId, 'deal_completed', '🎉 تمت الصفقة بنجاح!', 
       `تم إتمام صفقة "${propertyTitle}". العقار مغلق الآن.`, convRes.rows[0].property_id]
    );
    
    // Notify searcher
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, message, related_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [convRes.rows[0].searcher_id, 'deal_completed', '🎉 تمت الصفقة بنجاح!', 
       `تم إتمام صفقة "${propertyTitle}". شكراً لثقتك بنا.`, convRes.rows[0].property_id]
    );

    res.json({ message: "تم إغلاق الصفقة بنجاح" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// ================= PUBLIC SETTINGS (No authentication required) =================
// This endpoint returns only public settings like payment price
app.get('/api/public/settings/:key', async (req, res) => {
  try {
    const { key } = req.params;
    
    // Only allow public access to certain keys
    const publicKeys = ['payment_price', 'site_name'];
    
    if (!publicKeys.includes(key)) {
      return res.status(403).json({ message: 'غير مصرح بالوصول إلى هذا الإعداد' });
    }
    
    const result = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'الإعداد غير موجود' });
    }
    
    res.json({ key: key, value: result.rows[0].value });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'خطأ في الخادم' });
  }
});

// =========================================================
// SERVE STATIC FILES - MUST BE LAST
// =========================================================
app.use(express.static(__dirname));

// ================= START SERVER =================
app.listen(3001, () => {
  console.log("Server running on http://127.0.0.1:3001");
});
