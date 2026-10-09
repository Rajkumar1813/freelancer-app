const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Check if logged in (via passport session)
const isLoggedIn = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  req.flash('error', 'Please login to continue');
  res.redirect('/auth/login');
};

// Role guards
const isAdmin = (req, res, next) => {
  if (req.isAuthenticated() && req.user.role === 'admin') return next();
  req.flash('error', 'Admin access required');
  res.redirect('/');
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

module.exports = { isLoggedIn, isAdmin, isClient, isFreelancer, isClientOrFreelancer, isNotLoggedIn, isNotBanned };