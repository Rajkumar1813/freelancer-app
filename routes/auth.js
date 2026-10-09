const express  = require('express');
const router   = express.Router();
const passport = require('passport');
const authController = require('../controllers/authController');
const { isNotLoggedIn } = require('../middleware/auth');

// ── Regular user routes ───────────────────────────────────────────────────────
router.get('/login',    isNotLoggedIn, authController.getLogin);
router.post('/login',   isNotLoggedIn, authController.postLogin);
router.get('/register', isNotLoggedIn, authController.getRegister);
router.post('/register',isNotLoggedIn, authController.postRegister);
router.get('/verify-otp',  authController.getVerifyOTP);
router.post('/verify-otp', authController.postVerifyOTP);
router.post('/resend-otp', authController.postResendOTP);
router.get('/logout',      authController.logout);

// ── Google OAuth ──────────────────────────────────────────────────────────────
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/auth/login', failureFlash: true }),
  authController.googleCallback
);

// ── Forgot Password ───────────────────────────────────────────────────────────
router.get('/forgot-password', isNotLoggedIn, (req, res) => {
  res.render('auth/forgot-password', { title: 'Reset Password - FreelanceHub' });
});

router.post('/forgot-password/send-otp', async (req, res) => {
  try {
    const { email } = req.body;
    const User = require('../models/User');
    const { generateOTP, sendOTP } = require('../utils/sendOTP');
    const user = await User.findOne({ email: email.toLowerCase(), isVerified: true });
    if (!user) return res.json({ success: false, message: 'No verified account found with this email' });
    const otp = generateOTP();
    user.otp       = otp;
    user.otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();
    await sendOTP(email, user.name, otp);
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: 'Failed to send OTP' });
  }
});

router.post('/forgot-password/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    const User = require('../models/User');
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || user.otp !== otp) return res.json({ success: false, message: 'Invalid OTP' });
    if (new Date() > user.otpExpiry) return res.json({ success: false, message: 'OTP expired. Request a new one.' });
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: 'Verification failed' });
  }
});

router.post('/forgot-password/reset', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    const bcrypt = require('bcryptjs');
    const User   = require('../models/User');
    const user   = await User.findOne({ email: email.toLowerCase() });
    if (!user || user.otp !== otp) return res.json({ success: false, message: 'Invalid or expired OTP' });
    if (new Date() > user.otpExpiry) return res.json({ success: false, message: 'OTP expired' });
    user.password  = await bcrypt.hash(newPassword, 12);
    user.otp       = undefined;
    user.otpExpiry = undefined;
    await user.save();
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: 'Password reset failed' });
  }
});

// ── Warning-email account verification ───────────────────────────────────────
router.get('/verify-account',         authController.getVerifyAccount);
router.post('/verify-account',        authController.postVerifyAccount);
router.post('/verify-account/resend', authController.resendVerifyOTP);

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN AUTH ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// GET  /auth/admin/login     → Show admin login page
// POST /auth/admin/login     → Process admin login
// GET  /auth/admin/register  → Show admin register page
// POST /auth/admin/register  → Process admin registration (requires secret key)
// GET  /auth/admin/logout    → Logout admin

router.get('/admin/login',         authController.getAdminLogin);
router.post('/admin/login',        authController.postAdminLogin);
router.get('/admin/verify-pin',    authController.getAdminVerifyPin);
router.post('/admin/verify-pin',   authController.postAdminVerifyPin);
router.get('/admin/register',      authController.getAdminRegister);
router.post('/admin/register',     authController.postAdminRegister);
router.get('/admin/logout',        authController.adminLogout);

module.exports = router;