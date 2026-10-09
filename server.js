require('dotenv').config();
const express        = require('express');
const http           = require('http');
const path           = require('path');
const session        = require('express-session');
const passport       = require('passport');
const flash          = require('connect-flash');
const methodOverride = require('method-override');
const dns            = require('dns');

const connectDB      = require('./config/db');
const { initSocket } = require('./config/socket');
require('./config/passport');
const compression    = require('compression');
const User           = require('./models/User');
const Notification   = require('./models/Notification');

const authRoutes         = require('./routes/auth');
const adminRoutes        = require('./routes/admin');
const clientRoutes       = require('./routes/client');
const freelancerRoutes   = require('./routes/freelancer');
const projectRoutes      = require('./routes/projects');
const messageRoutes      = require('./routes/messages');
const notificationRoutes = require('./routes/notifications');
const profileRoutes      = require('./routes/profile');
const reportRoutes       = require('./routes/reports');
const paymentRoutes      = require('./routes/payments');

dns.setServers(['1.1.1.1', '8.8.8.8']);

const app    = express();
const server = http.createServer(app);

// ── Compression (Gzip/Brotli) to speed up all responses ─────────────
app.use(compression());

// ── Trust proxy — REQUIRED for Render (HTTPS cookies, correct IP) ─
app.set('trust proxy', 1);

connectDB();
initSocket(server);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use('/payments/webhook', express.raw({ type: '*/*' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d'
}));

// ── Session store — connect-mongo v3/v4 BOTH handle karta hai ─────
function buildStore() {
  const mongoUrl = process.env.MONGODB_URI;
  const opts     = { mongoUrl, touchAfter: 24 * 3600, ttl: 60 * 60 * 24 * 7 };

  // connect-mongo v4.6 — 3 possible export shapes:
  //   require('connect-mongo')           → { default: fn, create: fn }
  //   require('connect-mongo').default   → fn with .create()
  //   require('connect-mongo')           → fn directly (older builds)
  try {
    const cm = require('connect-mongo');

    // Shape 1: cm.create exists directly
    if (cm && typeof cm.create === 'function') {
      return cm.create(opts);
    }

    // Shape 2: cm.default.create exists
    if (cm && cm.default && typeof cm.default.create === 'function') {
      return cm.default.create(opts);
    }

    // Shape 3: cm itself is a function (v3 style)
    if (typeof cm === 'function') {
      const Store = cm(session);
      return new Store(opts);
    }

    throw new Error('connect-mongo: unknown export shape');
  } catch (e) {
    console.error('[Session] MongoStore build failed:', e.message);
    // Fallback: in-memory (sessions will reset on restart — not ideal but server stays up)
    return undefined;
  }
}

app.use(session({
  secret:            process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave:            false,
  saveUninitialized: false,
  store:             buildStore(),
  cookie: {
    maxAge:   1000 * 60 * 60 * 24 * 7,
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
  }
}));

app.use(passport.initialize());
app.use(passport.session());
app.use(flash());

// ── Global locals ─────────────────────────────────────────────────
app.use(async (req, res, next) => {
  res.locals.success     = req.flash('success');
  res.locals.error       = req.flash('error');
  res.locals.currentUser = req.user || null;

  if (req.user) {
    try {
      res.locals.unreadNotifications = await Notification.countDocuments({
        recipient: req.user._id, read: false
      });
    } catch (e) { res.locals.unreadNotifications = 0; }

    if (req.user.role === 'admin') {
      const isSuper = Boolean(
        req.user.isSuperAdmin ||
        req.user.email === 'fileshare1813@gmail.com' ||
        req.user.adminRole === 'super_admin'
      );
      res.locals.isSuperAdmin = isSuper;
      res.locals.adminPermissions = req.user.adminPermissions || {};
      res.locals.hasPermission = (perm) => {
        if (isSuper) return true;
        return Boolean(req.user.adminPermissions && req.user.adminPermissions[perm]);
      };

      try {
        res.locals.unverifiedCount = await User.countDocuments({
          isVerified: false, isBanned: false, role: { $ne: 'admin' }
        });
      } catch (e) { res.locals.unverifiedCount = 0; }
    } else {
      res.locals.isSuperAdmin = false;
      res.locals.adminPermissions = {};
      res.locals.hasPermission = () => false;
      res.locals.unverifiedCount = 0;
    }
  } else {
    res.locals.isSuperAdmin        = false;
    res.locals.adminPermissions    = {};
    res.locals.hasPermission       = () => false;
    res.locals.unreadNotifications = 0;
    res.locals.unverifiedCount     = 0;
  }
  next();
});

// ── Routes ────────────────────────────────────────────────────────
app.use('/auth',          authRoutes);
app.use('/admin',         adminRoutes);
app.use('/client',        clientRoutes);
app.use('/freelancer',    freelancerRoutes);
app.use('/projects',      projectRoutes);
app.use('/messages',      messageRoutes);
app.use('/notifications', notificationRoutes);
app.use('/profile',       profileRoutes);
app.use('/reports',       reportRoutes);
app.use('/payments',      paymentRoutes);

// ── Root ──────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  if (req.user) {
    const role = req.user.role;
    if (role === 'admin')      return res.redirect('/admin/dashboard');
    if (role === 'client')     return res.redirect('/client/dashboard');
    if (role === 'freelancer') return res.redirect('/freelancer/dashboard');
  }
  res.render('auth/login', { title: 'Welcome - FreelanceHub' });
});

// ── Avatar ────────────────────────────────────────────────────────
app.get('/avatar/:userId', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select('avatar avatarContentType');
    if (user && user.avatar) {
      res.set('Content-Type', user.avatarContentType || 'image/jpeg');
      res.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
      return res.send(user.avatar);
    }
    res.redirect('/images/default-avatar.png');
  } catch (e) { res.redirect('/images/default-avatar.png'); }
});

// ── 404 ───────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('shared/404', {
    title: '404 - Not Found', currentUser: req.user || null,
    success: [], error: [], unreadNotifications: 0, unverifiedCount: 0
  });
});

// ── Error handler ─────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.stack || err.message);

  if (err.name === 'ValidationError') {
    const msg = Object.values(err.errors).map(e => e.message).join(', ');
    if (req.accepts('html')) { req.flash('error', msg); return res.redirect('back'); }
    return res.status(400).json({ success: false, message: msg });
  }
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    const msg   = `${field.charAt(0).toUpperCase() + field.slice(1)} already exists`;
    if (req.accepts('html')) { req.flash('error', msg); return res.redirect('back'); }
    return res.status(400).json({ success: false, message: msg });
  }
  if (err.code === 'LIMIT_FILE_SIZE') {
    if (req.accepts('html')) { req.flash('error', 'File too large. Max 5MB.'); return res.redirect('back'); }
    return res.status(400).json({ success: false, message: 'File too large' });
  }

  const status  = err.status || err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production'
    ? 'Something went wrong'
    : (err.message || 'Server Error');

  if (!req.accepts('html') || req.path.startsWith('/api/')) {
    return res.status(status).json({ success: false, message });
  }

  res.status(status).render('shared/500', {
    title: 'Server Error', error: message,
    currentUser: req.user || null,
    success: [], error_msgs: [], unreadNotifications: 0, unverifiedCount: 0
  });
});

// ── Verification cron logic ───────────────────────────────────────
async function runVerificationCron() {
  const User = require('./models/User');
  const Notification                = require('./models/Notification');
  const crypto                      = require('crypto');
  const { generateOTP,
          sendVerificationWarning } = require('./utils/sendOTP');

  const now     = new Date();
  const cut24   = new Date(now - 24 * 60 * 60 * 1000);
  const baseUrl = process.env.APP_URL || `https://${process.env.RENDER_EXTERNAL_URL || 'localhost:3000'}`;

  // TASK A: Warning emails
  const toWarn = await User.find({
    isVerified: false, isBanned: false,
    warningSentAt: null, createdAt: { $lte: cut24 }
  });
  console.log(`[Cron] TASK-A: ${toWarn.length} users ko warning bhejna hai`);

  for (const user of toWarn) {
    try {
      const otp       = generateOTP();
      const token     = crypto.randomBytes(32).toString('hex');
      const expiry    = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const verifyUrl = `${baseUrl}/auth/verify-account?token=${token}&email=${encodeURIComponent(user.email)}`;

      user.otp               = otp;
      user.otpExpiry         = expiry;
      user.verifyToken       = token;
      user.verifyTokenExpiry = expiry;
      user.warningSentAt     = now;
      await user.save();

      await sendVerificationWarning(user.email, user.name, otp, verifyUrl);
      console.log(`[Cron] Warning sent: ${user.email}`);
    } catch (err) {
      console.error(`[Cron] Warning FAILED ${user.email}:`, err.message);
    }
  }

  // TASK B: Auto-ban
  const toBan = await User.find({
    isVerified: false, isBanned: false,
    warningSentAt: { $ne: null, $lte: cut24 }
  });
  console.log(`[Cron] TASK-B: ${toBan.length} users ko ban karna hai`);

  for (const user of toBan) {
    try {
      user.isBanned          = true;
      user.verifyToken       = null;
      user.verifyTokenExpiry = null;
      user.otp               = null;
      user.otpExpiry         = null;
      await user.save();

      const admins = await User.find({ role: 'admin' }).select('_id').lean();
      for (const admin of admins) {
        await Notification.create({
          recipient: admin._id, type: 'system',
          message: `Auto-ban: "${user.name}" (${user.email}) — 48hrs me verify nahi kiya`,
          link: '/admin/unverified-users'
        });
      }
      console.log(`[Cron] Auto-banned: ${user.email}`);
    } catch (err) {
      console.error(`[Cron] Ban FAILED ${user.email}:`, err.message);
    }
  }

  return { warned: toWarn.length, banned: toBan.length };
}

// Expose for admin manual trigger
app.set('runVerificationCron', runVerificationCron);

// ── Start server ──────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`FreelanceHub running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);

  // ── node-cron — optional, graceful fallback ────────────────────
  try {
    const cron = require('node-cron');
    cron.schedule('0 0 * * *', async () => {
      console.log('[Cron] Midnight job start:', new Date().toISOString());
      try {
        const result = await runVerificationCron();
        console.log(`[Cron] Done — Warned: ${result.warned}, Banned: ${result.banned}`);
      } catch (err) {
        console.error('[Cron] Job error:', err.message);
      }
    }, { timezone: 'Asia/Kolkata' });
    console.log('[Cron] Verification cron scheduled — roz midnight IST');
  } catch (cronErr) {
    console.warn('[Cron] node-cron not found — cron disabled. Fix: npm install node-cron');
  }
});

// ── Graceful shutdown (Render SIGTERM) ────────────────────────────
process.on('SIGTERM', () => {
  console.log('SIGTERM received — shutting down gracefully...');
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
});

process.on('unhandledRejection', (reason) => {
  console.error('[UnhandledRejection]', reason);
});