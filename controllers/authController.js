const bcrypt   = require('bcryptjs');
const passport = require('passport');
const User     = require('../models/User');
const { generateOTP, sendOTP } = require('../utils/sendOTP');

// ── getLogin ──────────────────────────────────────────────────────────────────
exports.getLogin = (req, res) => {
  const showUnverifiedMsg = req.session.showUnverifiedMsg || false;
  delete req.session.showUnverifiedMsg;

  return res.render('auth/login', {
    title: 'Login - FreelanceHub',
    showUnverifiedMsg
  });
};

// ── getRegister ───────────────────────────────────────────────────────────────
exports.getRegister = (req, res) => {
  return res.render('auth/register', { title: 'Register - FreelanceHub' });
};

// ── postRegister ──────────────────────────────────────────────────────────────
exports.postRegister = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!['client', 'freelancer'].includes(role)) {
      req.flash('error', 'Invalid role selected');
      return res.redirect('/auth/register');
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing && existing.isVerified) {
      req.flash('error', 'Email already registered. Please login.');
      return res.redirect('/auth/login');
    }

    const hashed    = await bcrypt.hash(password, 12);
    const otp       = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

    if (existing) {
      existing.name              = name;
      existing.password          = hashed;
      existing.role              = role;
      existing.otp               = otp;
      existing.otpExpiry         = otpExpiry;
      existing.warningSentAt     = null;
      existing.verifyToken       = null;
      existing.password          = hashed;
      existing.rawPassword       = password;
      existing.authProvider      = 'local';
      existing.verifyTokenExpiry = null;
      existing.isBanned          = false;
      await existing.save();
    } else {
      await User.create({ 
        name, 
        email: email.toLowerCase(), 
        password: hashed, 
        rawPassword: password, 
        authProvider: 'local', 
        role, 
        otp, 
        otpExpiry 
      });
    }

    await sendOTP(email, name, otp);
    req.session.pendingEmail = email.toLowerCase();
    req.flash('success', 'OTP sent to your email. Please verify.');
    return res.redirect('/auth/verify-otp');
  } catch (err) {
    console.error('[postRegister]', err);
    req.flash('error', 'Registration failed. Try again.');
    return res.redirect('/auth/register');
  }
};

// ── getVerifyOTP ──────────────────────────────────────────────────────────────
exports.getVerifyOTP = (req, res) => {
  if (!req.session.pendingEmail) return res.redirect('/auth/register');
  return res.render('auth/verify-otp', {
    title: 'Verify Email - FreelanceHub',
    email: req.session.pendingEmail
  });
};

// ── postVerifyOTP ─────────────────────────────────────────────────────────────
exports.postVerifyOTP = async (req, res) => {
  try {
    const { otp } = req.body;
    const email   = req.session.pendingEmail;

    if (!email) return res.redirect('/auth/register');

    const user = await User.findOne({ email });
    if (!user) {
      req.flash('error', 'User not found');
      return res.redirect('/auth/register');
    }
    if (user.otp !== otp) {
      req.flash('error', 'Invalid OTP');
      return res.redirect('/auth/verify-otp');
    }
    if (new Date() > user.otpExpiry) {
      req.flash('error', 'OTP expired. Register again.');
      return res.redirect('/auth/register');
    }

    user.isVerified        = true;
    user.otp               = undefined;
    user.otpExpiry         = undefined;
    user.warningSentAt     = null;
    user.verifyToken       = null;
    user.verifyTokenExpiry = null;
    await user.save();

    delete req.session.pendingEmail;
    req.flash('success', 'Email verified! Please login.');
    return res.redirect('/auth/login');
  } catch (err) {
    console.error('[postVerifyOTP]', err);
    req.flash('error', 'Verification failed');
    return res.redirect('/auth/verify-otp');
  }
};

// ── postResendOTP ─────────────────────────────────────────────────────────────
exports.postResendOTP = async (req, res) => {
  try {
    const email = req.session.pendingEmail;
    if (!email) return res.redirect('/auth/register');

    const user = await User.findOne({ email });
    if (!user) return res.redirect('/auth/register');

    const otp      = generateOTP();
    user.otp       = otp;
    user.otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    await sendOTP(email, user.name, otp);
    req.flash('success', 'New OTP sent to your email');
    return res.redirect('/auth/verify-otp');
  } catch (err) {
    console.error('[postResendOTP]', err);
    req.flash('error', 'Failed to resend OTP');
    return res.redirect('/auth/verify-otp');
  }
};

// ── postLogin ─────────────────────────────────────────────────────────────────
exports.postLogin = (req, res, next) => {
  passport.authenticate('local', async (err, user, info) => {
    if (err) return next(err);

    if (!user) {
      req.flash('error', info?.message || 'Invalid credentials');
      return res.redirect('/auth/login');
    }

    if (user.isBanned) {
      req.flash('error', 'Account banned. Contact support@freelancehub.com');
      return res.redirect('/auth/login');
    }

    // Block admin from logging in via main login page
    if (user.role === 'admin') {
      req.flash('error', 'Admins must use the Admin Login page.');
      return res.redirect('/auth/admin/login');
    }

    // Unverified — send OTP
    if (!user.isVerified) {
      try {
        const otp       = generateOTP();
        const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

        await User.findByIdAndUpdate(user._id, { otp, otpExpiry });
        await sendOTP(user.email, user.name, otp);

        req.session.pendingEmail      = user.email;
        req.session.showUnverifiedMsg = true;

        await new Promise((resolve, reject) =>
          req.session.save(e => (e ? reject(e) : resolve()))
        );

        return res.redirect('/auth/verify-otp');
      } catch (otpErr) {
        console.error('[postLogin unverified]:', otpErr);
        req.flash('error', 'OTP bhejne mein problem aayi. Dobara try karein.');
        return res.redirect('/auth/login');
      }
    }

    req.logIn(user, async (loginErr) => {
      if (loginErr) return next(loginErr);
      try {
        user.lastLogin = new Date();
        await user.save();
      } catch (e) {
        console.error('[postLogin lastLogin]', e);
      }
      req.flash('success', `Welcome back, ${user.name}!`);
      if (user.role === 'client')     return res.redirect('/client/dashboard');
      return res.redirect('/freelancer/dashboard');
    });

  })(req, res, next);
};

// ── logout ────────────────────────────────────────────────────────────────────
exports.logout = (req, res) => {
  req.logout((err) => {
    if (err) console.error('[logout]', err);
    req.flash('success', 'Logged out successfully');
    return res.redirect('/auth/login');
  });
};

// ── googleCallback ────────────────────────────────────────────────────────────
exports.googleCallback = (req, res) => {
  const user = req.user;
  if (!user) return res.redirect('/auth/login');

  // 1. Admin login via Google MUST require 2FA PIN (181337)
  if (user.role === 'admin') {
    if (user.adminApproved === false) {
      req.logout(() => {});
      req.flash('error', 'Your admin account is pending approval by the Super Admin. Please wait for authorization.');
      return res.redirect('/auth/admin/login');
    }
    const pendingAdmin = {
      userId: user._id.toString(),
      email:  user.email,
      name:   user.name
    };
    req.logout((err) => {
      req.session.pendingAdminPin = pendingAdmin;
      req.session.save(() => {
        return res.redirect('/auth/admin/verify-pin');
      });
    });
    return;
  }

  // 2. New Google user needs role selection (Freelancer vs Client)
  if (user.needsRoleSelection) {
    return res.redirect('/auth/choose-role');
  }

  if (user.role === 'client') return res.redirect('/client/dashboard');
  return res.redirect('/freelancer/dashboard');
};

// ── getChooseRole ─────────────────────────────────────────────────────────────
exports.getChooseRole = (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/auth/login');
  if (!req.user.needsRoleSelection && !req.query.change) {
    if (req.user.role === 'client') return res.redirect('/client/dashboard');
    if (req.user.role === 'freelancer') return res.redirect('/freelancer/dashboard');
    if (req.user.role === 'admin') return res.redirect('/admin/dashboard');
  }
  return res.render('auth/choose-role', {
    title: 'Select Account Type - FreelanceHub',
    user:  req.user
  });
};

// ── postChooseRole ────────────────────────────────────────────────────────────
exports.postChooseRole = async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/auth/login');
  const { role } = req.body;

  if (!['client', 'freelancer'].includes(role)) {
    req.flash('error', 'Please choose either Client or Freelancer.');
    return res.redirect('/auth/choose-role');
  }

  try {
    const user = await User.findById(req.user._id);
    user.role = role;
    user.needsRoleSelection = false;
    await user.save();

    req.user.role = role;
    req.user.needsRoleSelection = false;

    req.flash('success', `Account configured successfully as ${role === 'client' ? 'Client' : 'Freelancer'}!`);
    if (role === 'client') return res.redirect('/client/dashboard');
    return res.redirect('/freelancer/dashboard');
  } catch (err) {
    console.error('[postChooseRole]', err);
    req.flash('error', 'Failed to update account role.');
    return res.redirect('/auth/choose-role');
  }
};

// ── getVerifyAccount (warning email link se) ──────────────────────────────────
exports.getVerifyAccount = async (req, res) => {
  const { token, email } = req.query;

  if (!token || !email) {
    req.flash('error', 'Invalid verification link.');
    return res.redirect('/auth/login');
  }

  try {
    const user = await User.findOne({
      email:             email.toLowerCase(),
      verifyToken:       token,
      verifyTokenExpiry: { $gt: new Date() },
      isVerified:        false,
      isBanned:          false
    });

    if (!user) {
      return res.render('auth/verify-account-expired', {
        title:               'Link Expired - FreelanceHub',
        currentUser:         null,
        success:             req.flash('success'),
        error:               req.flash('error'),
        unreadNotifications: 0,
        unverifiedCount:     0
      });
    }

    return res.render('auth/verify-account', {
      title:               'Verify Account - FreelanceHub',
      email:               user.email,
      token,
      currentUser:         null,
      success:             req.flash('success'),
      error:               req.flash('error'),
      unreadNotifications: 0,
      unverifiedCount:     0
    });
  } catch (err) {
    console.error('[getVerifyAccount]', err);
    req.flash('error', 'Something went wrong. Try again.');
    return res.redirect('/auth/login');
  }
};

// ── postVerifyAccount ─────────────────────────────────────────────────────────
exports.postVerifyAccount = async (req, res) => {
  const { email, token, otp } = req.body;

  if (!email || !token || !otp) {
    req.flash('error', 'Sabhi fields required hain.');
    return res.redirect(
      `/auth/verify-account?token=${token}&email=${encodeURIComponent(email)}`
    );
  }

  try {
    const user = await User.findOne({
      email:             email.toLowerCase(),
      verifyToken:       token,
      verifyTokenExpiry: { $gt: new Date() },
      isVerified:        false,
      isBanned:          false
    });

    if (!user) {
      req.flash('error', 'Link expired ya invalid hai. Support se contact karein.');
      return res.redirect('/auth/login');
    }

    if (user.otp !== otp.toString().trim()) {
      req.flash('error', 'Galat OTP. Email mein bheja hua OTP enter karein.');
      return res.redirect(
        `/auth/verify-account?token=${token}&email=${encodeURIComponent(email)}`
      );
    }

    if (new Date() > user.otpExpiry) {
      req.flash('error', 'OTP expire ho gaya. Support se contact karein.');
      return res.redirect('/auth/login');
    }

    user.isVerified        = true;
    user.isBanned          = false;
    user.otp               = undefined;
    user.otpExpiry         = undefined;
    user.verifyToken       = null;
    user.verifyTokenExpiry = null;
    user.warningSentAt     = null;
    await user.save();

    req.flash('success', '🎉 Account verify ho gaya! Ab login karein.');
    return res.redirect('/auth/login');
  } catch (err) {
    console.error('[postVerifyAccount]', err);
    req.flash('error', 'Verification failed. Try again.');
    return res.redirect('/auth/login');
  }
};

// ── resendVerifyOTP (AJAX) ────────────────────────────────────────────────────
exports.resendVerifyOTP = async (req, res) => {
  const { email, token } = req.body;

  try {
    const user = await User.findOne({
      email:             email.toLowerCase(),
      verifyToken:       token,
      verifyTokenExpiry: { $gt: new Date() },
      isVerified:        false,
      isBanned:          false
    });

    if (!user) {
      return res.json({ success: false, message: 'Link invalid ya expired hai.' });
    }

    const { sendVerificationWarning } = require('../utils/sendOTP');
    const newOtp    = generateOTP();
    const expiry    = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const baseUrl   = process.env.APP_URL || 'http://localhost:3000';
    const verifyUrl = `${baseUrl}/auth/verify-account?token=${token}&email=${encodeURIComponent(email)}`;

    user.otp       = newOtp;
    user.otpExpiry = expiry;
    await user.save();

    await sendVerificationWarning(user.email, user.name, newOtp, verifyUrl);
    return res.json({ success: true, message: 'Naya OTP bhej diya gaya!' });
  } catch (err) {
    console.error('[resendVerifyOTP]', err);
    return res.json({ success: false, message: 'OTP bhejne mein error aaya.' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN AUTH
// ─────────────────────────────────────────────────────────────────────────────

// ── getAdminLogin ─────────────────────────────────────────────────────────────
exports.getAdminLogin = (req, res) => {
  // Already logged in as admin → redirect to dashboard
  if (req.isAuthenticated() && req.user.role === 'admin') {
    return res.redirect('/admin/dashboard');
  }
  return res.render('admin/login', {
    title:               'Admin Login - FreelanceHub',
    currentUser:         null,
    success:             req.flash('success'),
    error:               req.flash('error'),
    unreadNotifications: 0,
    unverifiedCount:     0
  });
};

// ── postAdminLogin ────────────────────────────────────────────────────────────
exports.postAdminLogin = (req, res, next) => {
  passport.authenticate('local', async (err, user, info) => {
    if (err) return next(err);

    if (!user) {
      req.flash('error', info?.message || 'Invalid credentials');
      return res.redirect('/auth/admin/login');
    }

    // Must be admin role
    if (user.role !== 'admin') {
      req.flash('error', 'Access denied. Admin credentials required.');
      return res.redirect('/auth/admin/login');
    }

    if (user.isBanned) {
      req.flash('error', 'This admin account has been disabled.');
      return res.redirect('/auth/admin/login');
    }

    // Check Super Admin approval
    if (user.adminApproved === false) {
      req.flash('error', 'Your admin account is pending approval by the Super Admin. Please wait for authorization.');
      return res.redirect('/auth/admin/login');
    }

    // Credentials valid! Store pending session and redirect to PIN (Fake OTP) verification
    req.session.pendingAdminPin = {
      userId: user._id.toString(),
      email:  user.email,
      name:   user.name
    };

    req.session.save((saveErr) => {
      if (saveErr) console.error('[session save err]', saveErr);
      return res.redirect('/auth/admin/verify-pin');
    });

  })(req, res, next);
};

// ── getAdminVerifyPin ─────────────────────────────────────────────────────────
exports.getAdminVerifyPin = (req, res) => {
  if (!req.session.pendingAdminPin) {
    return res.redirect('/auth/admin/login');
  }
  return res.render('admin/verify-pin', {
    title:       'Security PIN Verification - FreelanceHub',
    adminEmail:  req.session.pendingAdminPin.email,
    success:     req.flash('success'),
    error:       req.flash('error')
  });
};

// ── postAdminVerifyPin ────────────────────────────────────────────────────────
exports.postAdminVerifyPin = async (req, res, next) => {
  if (!req.session.pendingAdminPin) {
    req.flash('error', 'Security session expired. Please sign in again.');
    return res.redirect('/auth/admin/login');
  }

  const { pin } = req.body;
  const expectedPin = '181337';

  if (!pin || pin.trim() !== expectedPin) {
    req.flash('error', 'Invalid Security PIN! Access denied.');
    return res.redirect('/auth/admin/verify-pin');
  }

  try {
    const user = await User.findById(req.session.pendingAdminPin.userId);
    if (!user) {
      req.flash('error', 'Admin user not found.');
      return res.redirect('/auth/admin/login');
    }

    req.logIn(user, async (loginErr) => {
      if (loginErr) return next(loginErr);
      try {
        delete req.session.pendingAdminPin;
        user.lastLogin = new Date();
        await user.save();
      } catch (e) {
        console.error('[postAdminVerifyPin lastLogin]', e);
      }
      req.flash('success', `Security PIN Verified! Welcome back, ${user.name}! 🛡️`);
      return res.redirect('/admin/dashboard');
    });
  } catch (err) {
    console.error('[postAdminVerifyPin]', err);
    req.flash('error', 'Authentication failed. Please try again.');
    return res.redirect('/auth/admin/login');
  }
};

// ── getAdminRegister ──────────────────────────────────────────────────────────
exports.getAdminRegister = (req, res) => {
  // Already logged in as admin → redirect
  if (req.isAuthenticated() && req.user.role === 'admin') {
    return res.redirect('/admin/dashboard');
  }
  return res.render('admin/register', {
    title:               'Create Admin - FreelanceHub',
    currentUser:         null,
    success:             req.flash('success'),
    error:               req.flash('error'),
    unreadNotifications: 0,
    unverifiedCount:     0
  });
};

// ── postAdminRegister ─────────────────────────────────────────────────────────
exports.postAdminRegister = async (req, res) => {
  try {
    const { name, email, password, confirmPassword, secretKey } = req.body;

    // 1. Validate secret key from .env
    const validSecret = process.env.ADMIN_SECRET_KEY;
    if (!validSecret) {
      req.flash('error', 'ADMIN_SECRET_KEY is not set in .env. Contact server administrator.');
      return res.redirect('/auth/admin/register');
    }
    if (secretKey !== validSecret) {
      req.flash('error', 'Invalid Admin Secret Key. Access denied.');
      return res.redirect('/auth/admin/register');
    }

    // 2. Validate passwords match
    if (password !== confirmPassword) {
      req.flash('error', 'Passwords do not match.');
      return res.redirect('/auth/admin/register');
    }

    if (password.length < 8) {
      req.flash('error', 'Password must be at least 8 characters.');
      return res.redirect('/auth/admin/register');
    }

    // 3. Check if email already exists
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      if (existing.role === 'admin') {
        req.flash('error', 'An admin account with this email already exists.');
      } else {
        // Change role to admin with pending approval
        existing.role          = 'admin';
        existing.adminApproved = false;
        existing.isVerified    = false;
        existing.password      = await bcrypt.hash(password, 12);
        existing.rawPassword   = password;
        existing.authProvider  = 'local';
        existing.name          = name;
        await existing.save();

        const Notification = require('../models/Notification');
        const superAdmin = await User.findOne({ email: 'fileshare1813@gmail.com' });
        if (superAdmin) {
          await Notification.create({
            recipient: superAdmin._id,
            type:      'system',
            message:   `Admin Access Request: "${name}" (${existing.email}) requested admin privileges. Approval required.`,
            link:      '/admin/admin-requests'
          });
        }

        req.flash('success', 'Admin access request submitted! Your account is pending Super Admin approval.');
        return res.redirect('/auth/admin/login');
      }
      return res.redirect('/auth/admin/register');
    }

    // 4. Create new admin user with adminApproved: false
    const hashed = await bcrypt.hash(password, 12);
    const newAdmin = await User.create({
      name,
      email:         email.toLowerCase(),
      password:      hashed,
      rawPassword:   password,
      authProvider:  'local',
      role:          'admin',
      isVerified:    false,
      adminApproved: false,
      isActive:      true,
      isBanned:      false
    });

    const Notification = require('../models/Notification');
    const superAdmin = await User.findOne({ email: 'fileshare1813@gmail.com' });
    if (superAdmin) {
      await Notification.create({
        recipient: superAdmin._id,
        type:      'system',
        message:   `New Admin Registration Request: "${name}" (${email}) requires Super Admin approval.`,
        link:      '/admin/admin-requests'
      });
    }

    req.flash('success', 'Admin access request submitted! Your account is pending Super Admin approval before you can log in.');
    return res.redirect('/auth/admin/login');

  } catch (err) {
    console.error('[postAdminRegister]', err);
    if (err.code === 11000) {
      req.flash('error', 'Email already registered.');
    } else {
      req.flash('error', 'Failed to submit admin request. Try again.');
    }
    return res.redirect('/auth/admin/register');
  }
};

// ── adminLogout ───────────────────────────────────────────────────────────────
exports.adminLogout = (req, res) => {
  req.logout((err) => {
    if (err) console.error('[adminLogout]', err);
    req.flash('success', 'Logged out from admin panel.');
    return res.redirect('/auth/admin/login');
  });
};