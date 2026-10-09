const express = require('express');
const router  = express.Router();
const { isAdmin } = require('../middleware/auth');
const adminController = require('../controllers/adminController');
const paymentCtrl     = require('../controllers/paymentController');

router.use(isAdmin);

// ── Existing routes (unchanged) ───────────────────────────────────────────────
router.get('/dashboard',          adminController.getDashboard);
router.get('/users',                      adminController.getUsers);
router.post('/users/:id/ban',             adminController.banUser);
router.post('/users/:id/delete',          adminController.deleteUser);
router.post('/users/:id/reset-password',   adminController.resetUserPassword);
router.get('/projects',                   adminController.getProjects);
router.get('/graph-data',         adminController.getGraphDataAPI);

router.get('/settings', (req, res) => {
  res.render('admin/settings', { title: 'Platform Settings - FreelanceHub' });
});

router.get('/payments',               paymentCtrl.getAdminPayments);
router.post('/payments/:id/release',  paymentCtrl.releasePayment);
router.post('/payments/:id/complete', paymentCtrl.completePayment);

// ── Admin Authorization Requests ─────────────────────────────────────────────
router.get('/admin-requests',              adminController.getAdminRequests);
router.post('/admin-requests/:id/approve', adminController.approveAdminRequest);
router.post('/admin-requests/:id/reject',  adminController.rejectAdminRequest);

// ── NEW: Unverified users list ────────────────────────────────────────────────
router.get('/unverified-users', async (req, res) => {
  try {
    const User = require('../models/User');
    const now  = new Date();

    const raw = await User.find({
      isVerified: false, isBanned: false, role: { $ne: 'admin' }
    }).sort({ createdAt: 1 }).lean();

    const users = raw.map(u => {
      const ageHrs    = Math.floor((now - new Date(u.createdAt)) / 3600000);
      const warnedHrs = u.warningSentAt
        ? Math.floor((now - new Date(u.warningSentAt)) / 3600000) : null;
      const banInHrs  = u.warningSentAt ? Math.max(0, 24 - warnedHrs) : null;
      return { ...u, ageHrs, warnedHrs, banInHrs };
    });

    res.render('admin/unverified-users', {
      title: 'Unverified Users - FreelanceHub',
      users,
      currentUser:         req.user,
      success:             req.flash('success'),
      error:               req.flash('error'),
      unreadNotifications: res.locals.unreadNotifications || 0,
      unverifiedCount:     res.locals.unverifiedCount     || 0
    });
  } catch (err) {
    console.error('[unverified-users]', err);
    req.flash('error', 'Failed to load unverified users');
    res.redirect('/admin/dashboard');
  }
});

// ── NEW: Manual cron trigger (testing / emergency) ────────────────────────────
router.post('/run-verification-cron', async (req, res) => {
  try {
    // server.js ne app.set se cron function expose kiya hai
    const runFn = req.app.get('runVerificationCron');
    if (!runFn) throw new Error('Cron function not registered on app');
    const result = await runFn();
    req.flash('success', `Cron run hua — Warned: ${result.warned}, Banned: ${result.banned}`);
  } catch (err) {
    console.error('[ManualCron]', err);
    req.flash('error', 'Cron run karne me error: ' + err.message);
  }
  res.redirect('/admin/unverified-users');
});

module.exports = router;
