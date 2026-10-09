const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Check if logged in (via passport session)
const isLoggedIn = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  req.flash('error', 'Please login to continue');
  res.redirect('/auth/login');
};

// Check if user is Super Admin
const isSuperAdmin = (user) => {
  if (!user) return false;
  return Boolean(user.isSuperAdmin || user.email === 'fileshare1813@gmail.com' || user.adminRole === 'super_admin');
};

// Check if admin has specific permission
const hasPermission = (user, permKey) => {
  if (!user || user.role !== 'admin') return false;
  if (isSuperAdmin(user)) return true;
  return Boolean(user.adminPermissions && user.adminPermissions[permKey]);
};

// Role guards
const isAdmin = (req, res, next) => {
  if (req.isAuthenticated() && req.user.role === 'admin') {
    if (!isSuperAdmin(req.user) && req.user.adminApproved === false) {
      req.logout(() => {});
      req.flash('error', 'Your manager/admin account is pending Super Admin authorization.');
      return res.redirect('/auth/admin/login');
    }
    return next();
  }
  req.flash('error', 'Admin access required');
  res.redirect('/auth/admin/login');
};

// Middleware: Require specific permission for route
const requirePermission = (permKey) => {
  return (req, res, next) => {
    if (!req.isAuthenticated()) return res.redirect('/auth/admin/login');
    if (req.user.role !== 'admin') return res.redirect('/');
    if (hasPermission(req.user, permKey)) return next();
    req.flash('error', 'Access Restricted: You do not have permission for this section.');
    return res.redirect('/admin/dashboard');
  };
};

// Middleware: Super Admin only
const isSuperAdminOnly = (req, res, next) => {
  if (!req.isAuthenticated()) return res.redirect('/auth/admin/login');
  if (isSuperAdmin(req.user)) return next();
  req.flash('error', 'Super Admin privileges required to manage team roles and permissions.');
  return res.redirect('/admin/dashboard');
};

const isClient = (req, res, next) => {
  if (req.isAuthenticated()) {
    if (req.user.needsRoleSelection) return res.redirect('/auth/choose-role');
    if (req.user.role === 'client') return next();
  }
  req.flash('error', 'Client access required');
  res.redirect('/');
};

const isFreelancer = (req, res, next) => {
  if (req.isAuthenticated()) {
    if (req.user.needsRoleSelection) return res.redirect('/auth/choose-role');
    if (req.user.role === 'freelancer') return next();
  }
  req.flash('error', 'Freelancer access required');
  res.redirect('/');
};

const isClientOrFreelancer = (req, res, next) => {
  if (req.isAuthenticated()) {
    if (req.user.needsRoleSelection) return res.redirect('/auth/choose-role');
    if (req.user.role === 'client' || req.user.role === 'freelancer') return next();
  }
  req.flash('error', 'Access denied');
  res.redirect('/');
};

// Check if NOT logged in (for auth pages)
const isNotLoggedIn = (req, res, next) => {
  if (!req.isAuthenticated()) return next();
  if (req.user.needsRoleSelection) return res.redirect('/auth/choose-role');
  const role = req.user.role;
  if (role === 'admin') return res.redirect('/admin/dashboard');
  if (role === 'client') return res.redirect('/client/dashboard');
  res.redirect('/freelancer/dashboard');
};

// Check account not banned
const isNotBanned = (req, res, next) => {
  if (req.user && req.user.isBanned) {
    req.logout(() => {});
    req.flash('error', 'Your account has been banned. Contact support.');
    return res.redirect('/auth/login');
  }
  next();
};

module.exports = {
  isLoggedIn,
  isAdmin,
  isSuperAdmin,
  hasPermission,
  requirePermission,
  isSuperAdminOnly,
  isClient,
  isFreelancer,
  isClientOrFreelancer,
  isNotLoggedIn,
  isNotBanned
};