// ================= ADMIN API (Full Version with Notifications) =================
const express = require('express');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const router = express.Router();

const pool = new Pool({
  user: "postgres",
  host: "127.0.0.1",
  database: "realestate",
  password: "6632",
  port: 5432,
});

// ================= JWT Verification Middleware =================
function verifyToken(req, res, next) {
  try {
    const token = req.cookies.token;
    if (!token) {
      return res.status(401).json({ message: "غير مسجل دخول" });
    }
    const decoded = jwt.verify(token, 'my_secret_key');
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: "جلسة غير صالحة" });
  }
}

// ================= Helper Functions =================
function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

// ================= Helper: Send Notification =================
async function sendNotification(userId, type, title, message, relatedId = null) {
  try {
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, message, related_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, type, title, message, relatedId]
    );
    console.log(`✅ Notification sent to user ${userId}: ${title}`);
  } catch (err) {
    console.error('Error sending notification:', err);
  }
}

// ================= Admin Verification Middleware =================
async function verifyAdmin(req, res, next) {
  try {
    const token = req.cookies.token;
    if (!token) {
      return res.status(401).json({ message: 'غير مسجل دخول' });
    }
    
    const decoded = jwt.verify(token, 'my_secret_key');
    
    const result = await pool.query(
      'SELECT role FROM users WHERE id = $1',
      [decoded.userId]
    );
    
    if (result.rows.length === 0 || result.rows[0].role !== 'admin') {
      return res.status(403).json({ message: 'غير مصرح لك بالدخول' });
    }
    
    req.adminId = decoded.userId;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'جلسة غير صالحة' });
  }
}

// ================= 1. Send OTP to Admin =================
router.post('/admin-login/start', async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ message: 'رقم الجوال مطلوب' });
    }

    const userRes = await pool.query(
      "SELECT id, full_name, role FROM users WHERE phone = $1 AND role = 'admin'",
      [phone]
    );

    if (userRes.rows.length === 0) {
      return res.status(404).json({ message: 'لا يوجد أدمن بهذا الرقم' });
    }

    const code = generateOTP();
    const expiresAt = addMinutes(new Date(), 5);

    await pool.query(
      `INSERT INTO otp_requests (phone, code, purpose, payload, expires_at)
       VALUES ($1, $2, 'admin_login', $3, $4)`,
      [phone, code, { adminId: userRes.rows[0].id }, expiresAt]
    );

    console.log('');
    console.log('╔══════════════════════════════════════════════════╗');
    console.log(`║   🔐 ADMIN OTP للرقم ${phone}: ${code}   ║`);
    console.log('╚══════════════════════════════════════════════════╝');
    console.log('');

    res.json({ message: 'تم إرسال رمز التحقق' });
  } catch (err) {
    console.error('admin-login/start error:', err);
    res.status(500).json({ message: 'خطأ في الخادم' });
  }
});

// ================= 2. Verify OTP for Admin =================
router.post('/admin-login/verify', async (req, res) => {
  try {
    const { phone, code } = req.body;

    if (!phone || !code) {
      return res.status(400).json({ message: 'بيانات ناقصة' });
    }

    const otpRes = await pool.query(
      `SELECT * FROM otp_requests
       WHERE phone = $1 AND code = $2 AND purpose = 'admin_login'
       ORDER BY created_at DESC LIMIT 1`,
      [phone, code]
    );

    if (otpRes.rows.length === 0) {
      return res.status(400).json({ message: 'الرمز غير صحيح' });
    }

    const row = otpRes.rows[0];

    if (new Date(row.expires_at) < new Date()) {
      return res.status(400).json({ message: 'انتهت صلاحية الرمز' });
    }

    const userRes = await pool.query(
      "SELECT id, national_id, full_name, phone, email, role FROM users WHERE phone = $1 AND role = 'admin'",
      [phone]
    );

    if (userRes.rows.length === 0) {
      return res.status(404).json({ message: 'المستخدم غير موجود' });
    }

    const user = userRes.rows[0];

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      'my_secret_key',
      { expiresIn: '12h' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax'
    });

    await pool.query('DELETE FROM otp_requests WHERE id = $1', [row.id]);

    res.json({
      message: 'تم تسجيل الدخول بنجاح',
      user,
      redirect: 'admin.html'
    });
  } catch (err) {
    console.error('admin-login/verify error:', err);
    res.status(500).json({ message: 'خطأ في الخادم' });
  }
});

// ================= Admin Statistics =================
router.get('/stats', verifyAdmin, async (req, res) => {
  try {
    const results = await Promise.all([
      // Properties stats
      pool.query("SELECT COUNT(*) FROM properties WHERE status = 'active'"),           // 0
      pool.query("SELECT COUNT(*) FROM properties WHERE status = 'stopped'"),          // 1
      pool.query("SELECT COUNT(*) FROM properties WHERE status = 'closed'"),           // 2
      pool.query("SELECT COUNT(*) FROM properties"),                                    // 3 (totalAds)
      pool.query("SELECT COUNT(*) FROM properties WHERE status = 'pending'"),          // 4 (pending review)
      pool.query("SELECT COUNT(*) FROM properties WHERE status = 'approved'"),         // 5 (approved)
      pool.query("SELECT COUNT(*) FROM properties WHERE status = 'rejected'"),         // 6 (rejected)
      
      // Users stats
      pool.query("SELECT COUNT(*) FROM users WHERE role = 'owner'"),                   // 7
      pool.query("SELECT COUNT(*) FROM users WHERE role = 'searcher'"),                // 8
      pool.query("SELECT COUNT(*) FROM users WHERE status = 'active' AND role != 'admin'"),  // 9 (active users)
      pool.query("SELECT COUNT(*) FROM users WHERE status = 'blocked' AND role != 'admin'"), // 10 (blocked users)
      pool.query("SELECT COUNT(*) FROM users WHERE role = 'owner' AND status = 'active'"),   // 11
      pool.query("SELECT COUNT(*) FROM users WHERE role = 'searcher' AND status = 'active'"), // 12
      
      // Listing types
      pool.query("SELECT COUNT(*) FROM properties WHERE listing_type = 'بيع'"),        // 13
      pool.query("SELECT COUNT(*) FROM properties WHERE listing_type = 'ايجار'"),      // 14
      
      // Reports stats
      pool.query("SELECT COUNT(*) FROM reports"),                                       // 15 (total reports)
      pool.query("SELECT COUNT(*) FROM reports WHERE status = 'pending'"),             // 16 (pending reports)
      pool.query("SELECT COUNT(*) FROM reports WHERE status = 'resolved'"),            // 17 (resolved reports)
      pool.query("SELECT COUNT(*) FROM reports WHERE status = 'rejected'"),            // 18 (rejected reports)
      
      // Monthly stats
      pool.query("SELECT COUNT(*) FROM properties WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE)"),  // 19
      pool.query("SELECT COUNT(*) FROM users WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE) AND role != 'admin'"), // 20
      pool.query("SELECT COUNT(*) FROM reports WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'") // 21
    ]);
    
    res.json({
      // Properties
      activeAds: parseInt(results[0].rows[0].count),
      stoppedAds: parseInt(results[1].rows[0].count),
      closedAds: parseInt(results[2].rows[0].count),
      totalAds: parseInt(results[3].rows[0].count),
      pendingAds: parseInt(results[4].rows[0].count),
      approvedAds: parseInt(results[5].rows[0].count),
      rejectedAds: parseInt(results[6].rows[0].count),
      
      // Users
      totalOwners: parseInt(results[7].rows[0].count),
      totalSeekers: parseInt(results[8].rows[0].count),
      activeUsers: parseInt(results[9].rows[0].count),
      blockedUsers: parseInt(results[10].rows[0].count),
      activeOwners: parseInt(results[11].rows[0].count),
      activeSeekers: parseInt(results[12].rows[0].count),
      
      // Listing types
      saleAds: parseInt(results[13].rows[0].count),
      rentAds: parseInt(results[14].rows[0].count),
      
      // Reports
      totalReports: parseInt(results[15].rows[0].count),
      pendingReports: parseInt(results[16].rows[0].count),
      resolvedReports: parseInt(results[17].rows[0].count),
      rejectedReports: parseInt(results[18].rows[0].count),
      
      // Monthly
      monthlyAds: parseInt(results[19].rows[0].count),
      monthlyUsers: parseInt(results[20].rows[0].count),
      weeklyReports: parseInt(results[21].rows[0].count)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'خطأ في جلب الإحصائيات' });
  }
});

// ================= Get Properties (For Admin) =================
router.get('/properties', verifyAdmin, async (req, res) => {
  try {
    const { search, status } = req.query;
    
    let query = `
      SELECT 
        p.id,
        p.ad_number,
        p.title,
        p.city,
        p.property_type,
        p.listing_type,
        p.price,
        p.status,
        p.created_at,
        p.lat,
        p.lng,
        p.modified_after_rejection,
        u.full_name as owner_name
      FROM properties p
      JOIN users u ON p.owner_id = u.id
      WHERE 1=1
    `;
    
    const params = [];
    let paramIndex = 1;
    
    if (search) {
      query += ` AND (p.ad_number ILIKE $${paramIndex} OR p.title ILIKE $${paramIndex} OR u.full_name ILIKE $${paramIndex} OR p.city ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }
    
    if (status) {
      query += ` AND p.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }
    
    query += ` ORDER BY p.created_at DESC`;
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'خطأ في جلب الإعلانات' });
  }
});

// ================= Get Single Property Details For Admin =================
router.get('/properties/:id', verifyAdmin, async (req, res) => {
  try {
    const propertyId = req.params.id;
    
    const propertyResult = await pool.query(`
      SELECT 
        p.*,
        u.full_name as owner_name,
        u.phone as owner_phone,
        u.national_id as owner_national_id,
        u.status as user_status
      FROM properties p
      JOIN users u ON p.owner_id = u.id
      WHERE p.id = $1
    `, [propertyId]);
    
    if (propertyResult.rows.length === 0) {
      return res.status(404).json({ message: 'الإعلان غير موجود' });
    }
    
    const featuresResult = await pool.query(`
      SELECT f.name
      FROM property_features pf
      JOIN features f ON pf.feature_id = f.id
      WHERE pf.property_id = $1
    `, [propertyId]);
    
    const property = propertyResult.rows[0];
    property.features = featuresResult.rows.map(f => f.name);
    
    res.json(property);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'خطأ في جلب تفاصيل الإعلان' });
  }
});

// ================= Update Property Status =================
// Update Property Status with notification to owner
router.put('/properties/:id/status', verifyAdmin, async (req, res) => {
  try {
    const propertyId = req.params.id;
    const { status, reason, modified_after_rejection } = req.body;
    
    // Get property info before update to know the owner
    const propertyInfo = await pool.query(
      "SELECT owner_id, title FROM properties WHERE id = $1",
      [propertyId]
    );
    
    let query = `UPDATE properties SET status = $1, rejection_reason = $2`;
    let params = [status, reason || null];
    let paramIndex = 3;
    
    if (modified_after_rejection !== undefined) {
      query += `, modified_after_rejection = $${paramIndex++}`;
      params.push(modified_after_rejection);
    }
    
    query += ` WHERE id = $${paramIndex++} RETURNING *`;
    params.push(propertyId);
    
    const result = await pool.query(query, params);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "العقار غير موجود" });
    }
    
    // ===== SEND NOTIFICATION TO OWNER =====
    let notificationTitle = '';
    let notificationMessage = '';
    let notificationType = '';
    
    switch(status) {
      case 'approved':
        notificationTitle = '✅ تم قبول إعلانك';
        notificationMessage = `تم قبول إعلان "${result.rows[0].title || propertyInfo.rows[0]?.title}". يمكنك الآن الدفع لنشره.`;
        notificationType = 'property_approved';
        break;
      case 'rejected':
        notificationTitle = '❌ تم رفض إعلانك';
        notificationMessage = `تم رفض إعلان "${result.rows[0].title || propertyInfo.rows[0]?.title}". السبب: ${reason || 'لم يتم تحديد سبب'}. يرجى تعديل البيانات وإعادة طلب المراجعة.`;
        notificationType = 'property_rejected';
        break;
      case 'active':
        notificationTitle = '🎉 إعلانك منشور الآن!';
        notificationMessage = `تم نشر إعلان "${result.rows[0].title || propertyInfo.rows[0]?.title}" بنجاح. سيظهر الآن للباحثين.`;
        notificationType = 'property_active';
        break;
      case 'stopped':
        notificationTitle = '⏸️ تم إيقاف إعلانك';
        notificationMessage = `تم إيقاف إعلان "${result.rows[0].title || propertyInfo.rows[0]?.title}" بواسطة الإدارة. للاستفسار يرجى التواصل مع الدعم.`;
        notificationType = 'property_stopped';
        break;
      default:
        notificationTitle = '📋 تحديث حالة الإعلان';
        notificationMessage = `تم تغيير حالة إعلان "${result.rows[0].title || propertyInfo.rows[0]?.title}" إلى ${status}.`;
        notificationType = 'property_updated';
    }
    
    if (propertyInfo.rows[0]?.owner_id) {
      await pool.query(
        `INSERT INTO notifications (user_id, type, title, message, related_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [propertyInfo.rows[0].owner_id, notificationType, notificationTitle, notificationMessage, propertyId]
      );
    }
    
    await pool.query(
      `INSERT INTO property_status_log (property_id, old_status, new_status, reason, admin_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [propertyId, null, status, reason, req.adminId]
    );
    
    res.json({ message: "تم تحديث حالة الإعلان", property: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'خطأ في تحديث حالة الإعلان' });
  }
});

// ================= Delete Property (Admin) =================
router.delete('/properties/:id', verifyAdmin, async (req, res) => {
  try {
    const propertyId = req.params.id;
    
    await pool.query("DELETE FROM property_photos WHERE property_id = $1", [propertyId]);
    await pool.query("DELETE FROM property_features WHERE property_id = $1", [propertyId]);
    await pool.query("DELETE FROM favorites WHERE property_id = $1", [propertyId]);
    await pool.query("DELETE FROM properties WHERE id = $1", [propertyId]);
    
    res.json({ message: "تم حذف الإعلان" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'خطأ في حذف الإعلان' });
  }
});

// ================= Stop Property =================
router.put('/properties/:id/stop', verifyAdmin, async (req, res) => {
  try {
    const propertyId = req.params.id;
    const result = await pool.query(
      `UPDATE properties SET status = 'stopped'
       WHERE id = $1 AND status = 'active'
       RETURNING *`,
      [propertyId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "العقار غير موجود أو ليس في حالة نشط" });
    }
    
    res.json({ message: "تم إيقاف الإعلان", property: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'خطأ في إيقاف الإعلان' });
  }
});

// ================= Reopen Stopped Property =================
router.put('/properties/:id/reopen', verifyAdmin, async (req, res) => {
  try {
    const propertyId = req.params.id;
    const result = await pool.query(
      `UPDATE properties SET status = 'pending'
       WHERE id = $1 AND status = 'stopped'
       RETURNING *`,
      [propertyId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "العقار غير موجود أو ليس في حالة موقف" });
    }
    
    res.json({ message: "تم إعادة فتح الإعلان", property: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'خطأ في إعادة فتح الإعلان' });
  }
});

// ================= Get Users List =================
router.get('/users', verifyAdmin, async (req, res) => {
  try {
    const { search, role, status } = req.query;
    
    let query = `
      SELECT 
        id,
        full_name,
        national_id,
        phone,
        email,
        role,
        status,
        created_at
      FROM users
      WHERE role != 'admin'
    `;
    
    const params = [];
    let paramIndex = 1;
    
    if (search) {
      query += ` AND (full_name ILIKE $${paramIndex} OR phone ILIKE $${paramIndex} OR national_id ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }
    
    if (role) {
      query += ` AND role = $${paramIndex}`;
      params.push(role);
      paramIndex++;
    }
    
    if (status) {
      query += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }
    
    query += ` ORDER BY created_at DESC`;
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'خطأ في جلب المستخدمين' });
  }
});

// ================= Update User Status (Block/Activate) with Notification =================
router.put('/users/:id/status', verifyAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = req.params.id;
    const { status, admin_message, report_id } = req.body;
    const adminId = req.adminId;

    await client.query('BEGIN');

    const userResult = await client.query(
      "SELECT full_name, role FROM users WHERE id = $1",
      [userId]
    );
    const userName = userResult.rows[0]?.full_name || 'المستخدم';
    const userRole = userResult.rows[0]?.role;

    const currentStatus = await client.query(
      "SELECT status FROM users WHERE id = $1",
      [userId]
    );
    const oldStatus = currentStatus.rows[0]?.status;

    if (status === 'blocked') {
      const activeProps = await client.query(
        `SELECT id, status FROM properties
         WHERE owner_id = $1
           AND status NOT IN ('stopped', 'closed')`,
        [userId]
      );

      if (activeProps.rows.length > 0) {
        await client.query('DELETE FROM property_backup WHERE user_id = $1', [userId]);

        for (const prop of activeProps.rows) {
          await client.query(
            `INSERT INTO property_backup (property_id, original_status, user_id)
             VALUES ($1, $2, $3)`,
            [prop.id, prop.status, userId]
          );
        }

        await client.query(
          `UPDATE properties SET status = 'stopped'
           WHERE owner_id = $1 AND status NOT IN ('stopped', 'closed')`,
          [userId]
        );
      }
      
      const message = admin_message || `تم حظر حسابك لمخالفة قواعد المنصة. للاستفسار يرجى التواصل مع الدعم الفني.`;
      await sendNotification(
        userId,
        'user_banned',
        '🚫 تم حظر حسابك',
        message,
        report_id
      );
      
    } else if (status === 'active') {
      const backups = await client.query(
        `SELECT property_id, original_status FROM property_backup WHERE user_id = $1`,
        [userId]
      );

      if (backups.rows.length > 0) {
        for (const backup of backups.rows) {
          await client.query(
            `UPDATE properties SET status = $1 WHERE id = $2`,
            [backup.original_status, backup.property_id]
          );
        }
        await client.query(`DELETE FROM property_backup WHERE user_id = $1`, [userId]);
      }
      
      const message = admin_message || `تم إلغاء حظر حسابك. يمكنك متابعة استخدام المنصة بشكل طبيعي.`;
      await sendNotification(
        userId,
        'user_unbanned',
        '✅ تم إلغاء حظر حسابك',
        message,
        report_id
      );
    }

    await client.query('UPDATE users SET status = $1 WHERE id = $2', [status, userId]);
    
    await client.query(
      `INSERT INTO user_status_log (user_id, old_status, new_status, admin_id)
       VALUES ($1, $2, $3, $4)`,
      [userId, oldStatus, status, adminId]
    );

    await client.query('COMMIT');

    const message = status === 'active' 
      ? `تم إلغاء حظر المستخدم وإرسال إشعار له` 
      : `تم حظر المستخدم وإيقاف إعلاناته وإرسال إشعار له`;

    res.json({ message });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('user status update error:', err);
    res.status(500).json({ message: 'خطأ في تحديث حالة المستخدم' });
  } finally {
    client.release();
  }
});

// ================= Get User Properties =================
router.get('/users/:id/properties', verifyAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    const result = await pool.query(
      `SELECT id, title, status, created_at, price 
       FROM properties 
       WHERE owner_id = $1 
       ORDER BY created_at DESC`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'خطأ في جلب عقارات المستخدم' });
  }
});

// ================= GET Reports =================
router.get('/reports', verifyAdmin, async (req, res) => {
  try {
    const { search, type, status } = req.query;
    
    let query = `
      SELECT 
        r.id,
        r.type,
        r.status,
        r.created_at,
        r.description,
        r.property_id,
        p.title as property_title,
        p.ad_number,
        u1.full_name as from_user_name,
        u2.full_name as to_user_name
      FROM reports r
      LEFT JOIN properties p ON r.property_id = p.id
      LEFT JOIN users u1 ON r.from_user_id = u1.id
      LEFT JOIN users u2 ON r.to_user_id = u2.id
      WHERE 1=1
    `;
    
    const params = [];
    let paramIndex = 1;
    
    if (search) {
      query += ` AND (r.id::text ILIKE $${paramIndex} OR u1.full_name ILIKE $${paramIndex} OR u2.full_name ILIKE $${paramIndex} OR p.title ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }
    
    if (type) {
      query += ` AND r.type = $${paramIndex}`;
      params.push(type);
      paramIndex++;
    }
    
    if (status) {
      query += ` AND r.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }
    
    query += ` ORDER BY r.created_at DESC`;
    
    const result = await pool.query(query, params);
    res.json(result.rows || []);
  } catch (err) {
    console.error('Error fetching reports:', err);
    res.json([]);
  }
});

// ================= GET Single Report =================
router.get('/reports/:id', verifyAdmin, async (req, res) => {
  try {
    const reportId = req.params.id;
    const result = await pool.query(`
      SELECT 
        r.*,
        p.title as property_title,
        p.ad_number,
        u1.full_name as from_user_name,
        u1.phone as from_user_phone,
        u2.full_name as to_user_name,
        u2.phone as to_user_phone
      FROM reports r
      LEFT JOIN properties p ON r.property_id = p.id
      LEFT JOIN users u1 ON r.from_user_id = u1.id
      LEFT JOIN users u2 ON r.to_user_id = u2.id
      WHERE r.id = $1
    `, [reportId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "البلاغ غير موجود" });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'خطأ في جلب تفاصيل البلاغ' });
  }
});
// ================= Resolve Report (Chat + Notification) =================
router.put('/reports/:id/resolve', verifyAdmin, async (req, res) => {
  try {
    const reportId = req.params.id;
    const { admin_message } = req.body;
    
    const reportResult = await pool.query(
      `SELECT from_user_id, to_user_id, property_id FROM reports WHERE id = $1`,
      [reportId]
    );
    
    if (reportResult.rows.length === 0) {
      return res.status(404).json({ message: "البلاغ غير موجود" });
    }
    
    const report = reportResult.rows[0];
    const message = admin_message || "✅ تم قبول البلاغ وحله. شكراً لتعاونك.";
    
    // Find conversation
    const convResult = await pool.query(
      `SELECT id FROM conversations 
       WHERE property_id = $1 
       AND ((searcher_id = $2 AND owner_id = $3) OR (searcher_id = $3 AND owner_id = $2))
       LIMIT 1`,
      [report.property_id, report.from_user_id, report.to_user_id]
    );
    
    // Get admin user ID
    const adminUser = await pool.query(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
    const adminId = adminUser.rows[0]?.id;
    
    // Send system message to chat
    if (convResult.rows.length > 0 && adminId) {
      const systemMessage = `📋 **إدارة المنصة**: ${message}`;
      await pool.query(
        `INSERT INTO messages (conversation_id, sender_id, message) 
         VALUES ($1, $2, $3)`,
        [convResult.rows[0].id, adminId, systemMessage]
      );
    }
    
    // Send notifications to both users (for bell)
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, message, related_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [report.from_user_id, 'report_resolved', '✅ تم قبول بلاغك', `تم قبول البلاغ رقم ${reportId}. ${message}`, reportId]
    );
    
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, message, related_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [report.to_user_id, 'report_resolved', '📋 تم حل بلاغ بشأنك', `تم مراجعة البلاغ رقم ${reportId} واتخاذ الإجراء المناسب. ${message}`, reportId]
    );
    
    // Update report status
    await pool.query(
      `UPDATE reports SET status = 'resolved', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [reportId]
    );
    
    res.json({ message: "✅ تم قبول البلاغ وتم إرسال إشعار للمستخدمين" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'خطأ في تحديث حالة البلاغ' });
  }
});

// ================= Reject Report (Chat + Notification) =================
router.put('/reports/:id/reject', verifyAdmin, async (req, res) => {
  try {
    const reportId = req.params.id;
    const { admin_message } = req.body;
    
    const reportResult = await pool.query(
      `SELECT from_user_id, to_user_id, property_id FROM reports WHERE id = $1`,
      [reportId]
    );
    
    if (reportResult.rows.length === 0) {
      return res.status(404).json({ message: "البلاغ غير موجود" });
    }
    
    const report = reportResult.rows[0];
    const message = admin_message || "❌ تم رفض البلاغ لعدم وجود مخالفة. نشكرك على اهتمامك.";
    
    // Find conversation
    const convResult = await pool.query(
      `SELECT id FROM conversations 
       WHERE property_id = $1 
       AND ((searcher_id = $2 AND owner_id = $3) OR (searcher_id = $3 AND owner_id = $2))
       LIMIT 1`,
      [report.property_id, report.from_user_id, report.to_user_id]
    );
    
    // Get admin user ID
    const adminUser = await pool.query(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
    const adminId = adminUser.rows[0]?.id;
    
    // Send system message to chat
    if (convResult.rows.length > 0 && adminId) {
      const systemMessage = `📋 **إدارة المنصة**: ${message}`;
      await pool.query(
        `INSERT INTO messages (conversation_id, sender_id, message) 
         VALUES ($1, $2, $3)`,
        [convResult.rows[0].id, adminId, systemMessage]
      );
    }
    
    // Send notification to reporter only (for bell)
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, message, related_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [report.from_user_id, 'report_rejected', '❌ تم رفض بلاغك', `تم رفض البلاغ رقم ${reportId}. ${message}`, reportId]
    );
    
    // Update report status
    await pool.query(
      `UPDATE reports SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [reportId]
    );
    
    res.json({ message: "❌ تم رفض البلاغ وتم إرسال إشعار للمستخدم" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'خطأ في تحديث حالة البلاغ' });
  }
});

// ================= Ban User (Chat + Notification) =================
router.put('/users/:id/status', verifyAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = req.params.id;
    const { status, admin_message, report_id } = req.body;
    const adminId = req.adminId;

    await client.query('BEGIN');

    const userResult = await client.query(
      "SELECT full_name, role FROM users WHERE id = $1",
      [userId]
    );
    const userName = userResult.rows[0]?.full_name || 'المستخدم';
    const userRole = userResult.rows[0]?.role;

    const currentStatus = await client.query(
      "SELECT status FROM users WHERE id = $1",
      [userId]
    );
    const oldStatus = currentStatus.rows[0]?.status;

    // Get admin user ID for system messages
    const adminUser = await client.query(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
    const systemAdminId = adminUser.rows[0]?.id;

    if (status === 'blocked') {
      // Block user - save original status for each property
      const activeProps = await client.query(
        `SELECT id, status FROM properties
         WHERE owner_id = $1
           AND status NOT IN ('stopped', 'closed')`,
        [userId]
      );

      if (activeProps.rows.length > 0) {
        await client.query('DELETE FROM property_backup WHERE user_id = $1', [userId]);

        for (const prop of activeProps.rows) {
          await client.query(
            `INSERT INTO property_backup (property_id, original_status, user_id)
             VALUES ($1, $2, $3)`,
            [prop.id, prop.status, userId]
          );
        }

        await client.query(
          `UPDATE properties SET status = 'stopped'
           WHERE owner_id = $1 AND status NOT IN ('stopped', 'closed')`,
          [userId]
        );
      }
      
      const message = admin_message || `🚫 تم حظر حسابك لمخالفة قواعد المنصة. للاستفسار يرجى التواصل مع الدعم الفني.`;
      
      // Send system message to all active conversations
      const conversations = await client.query(
        `SELECT id FROM conversations WHERE owner_id = $1 OR searcher_id = $1`,
        [userId]
      );
      
      if (systemAdminId) {
        for (const conv of conversations.rows) {
          await client.query(
            `INSERT INTO messages (conversation_id, sender_id, message) VALUES ($1, $2, $3)`,
            [conv.id, systemAdminId, `🚫 **إدارة المنصة**: ${message}`]
          );
        }
      }
      
      // Send notification (for bell)
      await client.query(
        `INSERT INTO notifications (user_id, type, title, message, related_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, 'user_banned', '🚫 تم حظر حسابك', message, report_id]
      );
      
    } else if (status === 'active') {
      // Unblock user - restore original status
      const backups = await client.query(
        `SELECT property_id, original_status FROM property_backup WHERE user_id = $1`,
        [userId]
      );

      if (backups.rows.length > 0) {
        for (const backup of backups.rows) {
          await client.query(
            `UPDATE properties SET status = $1 WHERE id = $2`,
            [backup.original_status, backup.property_id]
          );
        }
        await client.query(`DELETE FROM property_backup WHERE user_id = $1`, [userId]);
      }
      
      const message = admin_message || `✅ تم إلغاء حظر حسابك. يمكنك متابعة استخدام المنصة بشكل طبيعي.`;
      
      // Send system message to all active conversations
      const conversations = await client.query(
        `SELECT id FROM conversations WHERE owner_id = $1 OR searcher_id = $1`,
        [userId]
      );
      
      if (systemAdminId) {
        for (const conv of conversations.rows) {
          await client.query(
            `INSERT INTO messages (conversation_id, sender_id, message) VALUES ($1, $2, $3)`,
            [conv.id, systemAdminId, `✅ **إدارة المنصة**: ${message}`]
          );
        }
      }
      
      // Send notification (for bell)
      await client.query(
        `INSERT INTO notifications (user_id, type, title, message, related_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, 'user_unbanned', '✅ تم إلغاء حظر حسابك', message, report_id]
      );
    }

    await client.query('UPDATE users SET status = $1 WHERE id = $2', [status, userId]);
    
    await client.query(
      `INSERT INTO user_status_log (user_id, old_status, new_status, admin_id)
       VALUES ($1, $2, $3, $4)`,
      [userId, oldStatus, status, adminId]
    );

    await client.query('COMMIT');

    const message = status === 'active' 
      ? `تم إلغاء حظر المستخدم وتم إرسال إشعار له` 
      : `تم حظر المستخدم وإيقاف إعلاناته وتم إرسال إشعار له`;

    res.json({ message });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('user status update error:', err);
    res.status(500).json({ message: 'خطأ في تحديث حالة المستخدم' });
  } finally {
    client.release();
  }
});

// ================= Delete Report =================
router.delete('/reports/:id', verifyAdmin, async (req, res) => {
  try {
    const reportId = req.params.id;
    await pool.query(`DELETE FROM reports WHERE id = $1`, [reportId]);
    res.json({ message: "تم حذف البلاغ بنجاح" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'خطأ في حذف البلاغ' });
  }
});

// ================= Get Chat Messages for Admin =================
router.get('/chats/:conversation_id', verifyAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT m.*, u.full_name as sender_name, u.role as sender_role
       FROM messages m
       JOIN users u ON m.sender_id = u.id
       WHERE m.conversation_id = $1
       ORDER BY m.created_at ASC`,
      [req.params.conversation_id]
    );

    const convRes = await pool.query(
      `SELECT c.*, p.title as property_title, 
        u1.full_name as owner_name, u2.full_name as searcher_name
       FROM conversations c
       JOIN properties p ON c.property_id = p.id
       JOIN users u1 ON c.owner_id = u1.id
       JOIN users u2 ON c.searcher_id = u2.id
       WHERE c.id = $1`,
      [req.params.conversation_id]
    );

    res.json({
      conversation: convRes.rows[0] || null,
      messages: result.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'خطأ في جلب المحادثة' });
  }
});

// ================= Find conversation by property + users =================
router.get('/chats/find/:from_user_id/:to_user_id/:property_id', verifyAdmin, async (req, res) => {
  try {
    const { from_user_id, to_user_id, property_id } = req.params;
    
    const result = await pool.query(
      `SELECT id FROM conversations 
       WHERE property_id = $1 
       AND ((searcher_id = $2 AND owner_id = $3) OR (searcher_id = $3 AND owner_id = $2))
       LIMIT 1`,
      [property_id, from_user_id, to_user_id]
    );

    if (result.rows.length === 0) {
      return res.json({ conversation_id: null, messages: [] });
    }

    const convId = result.rows[0].id;
    
    const msgRes = await pool.query(
      `SELECT m.*, u.full_name as sender_name, u.role as sender_role
       FROM messages m
       JOIN users u ON m.sender_id = u.id
       WHERE m.conversation_id = $1
       ORDER BY m.created_at ASC`,
      [convId]
    );

    res.json({ conversation_id: convId, messages: msgRes.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'خطأ في جلب المحادثة' });
  }
});

// ================= NOTIFICATION ENDPOINTS =================

// Get User Notifications
router.get('/notifications', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const result = await pool.query(
      `SELECT * FROM notifications 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT 50`,
      [userId]
    );
    
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'خطأ في جلب الإشعارات' });
  }
});

// Mark Notification as Read
router.put('/notifications/:id/read', verifyToken, async (req, res) => {
  try {
    const notificationId = req.params.id;
    const userId = req.user.userId;
    
    await pool.query(
      `UPDATE notifications SET is_read = true 
       WHERE id = $1 AND user_id = $2`,
      [notificationId, userId]
    );
    
    res.json({ message: 'تم تحديث الإشعار' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'خطأ في تحديث الإشعار' });
  }
});

// Get Unread Notifications Count
router.get('/notifications/unread/count', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const result = await pool.query(
      `SELECT COUNT(*) FROM notifications 
       WHERE user_id = $1 AND is_read = false`,
      [userId]
    );
    
    res.json({ count: parseInt(result.rows[0].count) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'خطأ في جلب عدد الإشعارات' });
  }
});

// ================= SETTINGS ENDPOINTS =================

// Get all settings
router.get('/settings', verifyAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM settings ORDER BY key');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'خطأ في جلب الإعدادات' });
  }
});

// Get single setting
router.get('/settings/:key', verifyAdmin, async (req, res) => {
  try {
    const { key } = req.params;
    const result = await pool.query('SELECT * FROM settings WHERE key = $1', [key]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'الإعداد غير موجود' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'خطأ في جلب الإعداد' });
  }
});

// Update setting
router.put('/settings/:key', verifyAdmin, async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;
    
    if (!value) {
      return res.status(400).json({ message: 'القيمة مطلوبة' });
    }
    
    const result = await pool.query(
      `UPDATE settings 
       SET value = $1, updated_at = CURRENT_TIMESTAMP 
       WHERE key = $2 
       RETURNING *`,
      [value, key]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'الإعداد غير موجود' });
    }
    
    res.json({ message: 'تم تحديث الإعداد بنجاح', setting: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'خطأ في تحديث الإعداد' });
  }
});

// ================= PAYMENT ENDPOINTS =================

// Get all payments with filters
router.get('/payments', verifyAdmin, async (req, res) => {
  try {
    const { search, status, date_from, date_to } = req.query;
    
    let query = `
      SELECT 
        p.id,
        p.amount,
        p.status,
        p.paid_at,
        p.transaction_id,
        p.property_title,
        p.owner_name,
        prop.ad_number
      FROM payment_logs p
      LEFT JOIN properties prop ON p.property_id = prop.id
      WHERE 1=1
    `;
    
    const params = [];
    let paramIndex = 1;
    
    if (search) {
      query += ` AND (p.owner_name ILIKE $${paramIndex} OR p.property_title ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }
    
    if (status) {
      query += ` AND p.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }
    
    if (date_from) {
      query += ` AND DATE(p.paid_at) >= $${paramIndex}`;
      params.push(date_from);
      paramIndex++;
    }
    
    if (date_to) {
      query += ` AND DATE(p.paid_at) <= $${paramIndex}`;
      params.push(date_to);
      paramIndex++;
    }
    
    query += ` ORDER BY p.paid_at DESC`;
    
    const result = await pool.query(query, params);
    
    // Get totals
    const totalRevenue = await pool.query("SELECT COALESCE(SUM(amount),0) as total FROM payment_logs WHERE status = 'completed'");
    const monthlyRevenue = await pool.query("SELECT COALESCE(SUM(amount),0) as total FROM payment_logs WHERE status = 'completed' AND DATE_TRUNC('month', paid_at) = DATE_TRUNC('month', CURRENT_DATE)");
    const totalPayments = await pool.query("SELECT COUNT(*) as count FROM payment_logs WHERE status = 'completed'");
    const monthlyPayments = await pool.query("SELECT COUNT(*) as count FROM payment_logs WHERE status = 'completed' AND DATE_TRUNC('month', paid_at) = DATE_TRUNC('month', CURRENT_DATE)");
    
    res.json({
      payments: result.rows,
      totalRevenue: parseInt(totalRevenue.rows[0].total) || 0,
      monthlyRevenue: parseInt(monthlyRevenue.rows[0].total) || 0,
      totalPayments: parseInt(totalPayments.rows[0].count) || 0,
      monthlyPayments: parseInt(monthlyPayments.rows[0].count) || 0
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'خطأ في جلب المدفوعات' });
  }
});

// Get single payment details
router.get('/payments/:id', verifyAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        p.*,
        prop.ad_number,
        prop.title as full_property_title
      FROM payment_logs p
      LEFT JOIN properties prop ON p.property_id = prop.id
      WHERE p.id = $1
    `, [req.params.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "الدفعة غير موجودة" });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'خطأ في جلب تفاصيل الدفع' });
  }
});

// ================= Chart Data =================
router.get('/chart-data', verifyAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') as month,
        COUNT(*) as count
      FROM properties
      WHERE created_at >= NOW() - INTERVAL '6 months'
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY DATE_TRUNC('month', created_at)
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'خطأ في جلب بيانات الرسم البياني' });
  }
});

module.exports = router;