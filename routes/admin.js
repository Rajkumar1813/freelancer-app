const express = require('express');
const router  = express.Router();
const { isAdmin, requirePermission, isSuperAdminOnly } = require('../middleware/auth');
const adminController = require('../controllers/adminController');
const paymentCtrl     = require('../controllers/paymentController');

router.use(isAdmin);

// ── Dashboard & Analytics ──────────────────────────────────────────────────
router.get('/dashboard',          adminController.getDashboard);
router.get('/graph-data',         adminController.getGraphDataAPI);

// ── Users Management (Requires 'manageUsers' permission) ────────────────────
router.get('/users',                    requirePermission('manageUsers'), adminController.getUsers);
router.post('/users/:id/ban',           requirePermission('manageUsers'), adminController.banUser);
router.post('/users/:id/delete',        requirePermission('manageUsers'), adminController.deleteUser);
router.post('/users/:id/reset-password', requirePermission('manageUsers'), adminController.resetUserPassword);

// ── Projects Management (Requires 'manageProjects' permission) ─────────────
router.get('/projects',                 requirePermission('manageProjects'), adminController.getProjects);

// ── Settings (Requires 'manageSettings' permission) ─────────────────────────
router.get('/settings', requirePermission('manageSettings'), (req, res) => {
  res.render('admin/settings', { title: 'Platform Settings - FreelanceHub' });
});

// ── Payments Management (Requires 'managePayments' permission) ─────────────
router.get('/payments',               requirePermission('managePayments'), paymentCtrl.getAdminPayments);
router.post('/payments/:id/release',  requirePermission('managePayments'), paymentCtrl.releasePayment);
router.post('/payments/:id/complete', requirePermission('managePayments'), paymentCtrl.completePayment);

// ── Super Admin Team & Manager Delegation (Super Admin Only) ───────────────
router.get('/admin-requests',              isSuperAdminOnly, adminController.getAdminRequests);
router.get('/team',                        isSuperAdminOnly, adminController.getAdminRequests);
router.post('/admin-requests/:id/approve', isSuperAdminOnly, adminController.approveAdminRequest);
router.post('/admin-requests/:id/reject',  isSuperAdminOnly, adminController.rejectAdminRequest);
router.post('/team/promote/:id',           isSuperAdminOnly, adminController.promoteToManager);
router.post('/team/permissions/:id',       isSuperAdminOnly, adminController.updateManagerPermissions);
router.post('/team/demote/:id',            isSuperAdminOnly, adminController.demoteManager);

// ── Unverified users list (Requires 'manageUnverified' permission) ─────────
router.get('/unverified-users', requirePermission('manageUnverified'), async (req, res) => {
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
