const User = require('../models/User');
const Project = require('../models/Project');
const Proposal = require('../models/Proposal');
const Notification = require('../models/Notification');
const { getGraphData } = require('../utils/graphData');
const { getIO } = require('../config/socket');

exports.getDashboard = async (req, res) => {
  try {
    const [totalUsers, totalProjects, openProjects, completedProjects, 
           totalClients, totalFreelancers, recentUsers, recentProjects] = await Promise.all([
      User.countDocuments({ role: { $ne: 'admin' } }),
      Project.countDocuments(),
      Project.countDocuments({ status: 'open' }),
      Project.countDocuments({ status: 'completed' }),
      User.countDocuments({ role: 'client' }),
      User.countDocuments({ role: 'freelancer' }),
      User.find({ role: { $ne: 'admin' } }).sort({ createdAt: -1 }).limit(5),
      Project.find().populate('client', 'name').sort({ createdAt: -1 }).limit(5)
    ]);

    const completedRevenue = await Project.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$amountPaid' } } }
    ]);

    const totalRevenue = completedRevenue[0]?.total || 0;
    const graphData = await getGraphData('admin', req.user._id);

    res.render('admin/dashboard', {
      title: 'Admin Dashboard - FreelanceHub',
      stats: { totalUsers, totalProjects, openProjects, completedProjects, totalClients, totalFreelancers, totalRevenue },
      recentUsers, recentProjects, graphData
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to load dashboard');
    res.redirect('/');
  }
};

exports.getUsers = async (req, res) => {
  try {
    const { role, status, search, sort = '-createdAt' } = req.query;
    let query = { role: { $ne: 'admin' } };
    if (role) query.role = role;
    if (status === 'banned') query.isBanned = true;
    if (status === 'active') query.isBanned = false;
    if (search) query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } }
    ];
    const users = await User.find(query).sort(sort).lean();
    res.render('admin/users', { title: 'Manage Users - FreelanceHub', users, filters: req.query });
  } catch (err) {
    req.flash('error', 'Failed to load users');
    res.redirect('/admin/dashboard');
  }
};

exports.banUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) { req.flash('error', 'User not found'); return res.redirect('/admin/users'); }
    user.isBanned = !user.isBanned;
    await user.save();
    req.flash('success', `User ${user.isBanned ? 'banned' : 'unbanned'} successfully`);
    res.redirect('/admin/users');
  } catch (err) {
    req.flash('error', 'Action failed');
    res.redirect('/admin/users');
  }
};

exports.getProjects = async (req, res) => {
  try {
    const { status, category, search, sort = '-createdAt' } = req.query;
    let query = {};
    if (status) query.status = status;
    if (category) query.category = category;
    if (search) query.$text = { $search: search };
    const projects = await Project.find(query).populate('client', 'name email').populate('hiredFreelancer', 'name').sort(sort).lean();
    const categories = await Project.distinct('category');
    res.render('admin/projects', { title: 'All Projects - FreelanceHub', projects, categories, filters: req.query });
  } catch (err) {
    req.flash('error', 'Failed to load projects');
    res.redirect('/admin/dashboard');
  }
};

exports.deleteUser = async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    req.flash('success', 'User deleted');
    res.redirect('/admin/users');
  } catch (err) {
    req.flash('error', 'Delete failed');
    res.redirect('/admin/users');
  }
};

exports.getGraphDataAPI = async (req, res) => {
  try {
    const data = await getGraphData('admin', req.user._id);
    // Emit to all admin sockets too
    try { getIO().emit('graphUpdate', data); } catch(e) {}
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false });
  }
};

const parsePermissions = (body) => ({
  manageUsers:      body.manageUsers === 'on' || body.manageUsers === true,
  manageProjects:   body.manageProjects === 'on' || body.manageProjects === true,
  managePayments:   body.managePayments === 'on' || body.managePayments === true,
  manageUnverified: body.manageUnverified === 'on' || body.manageUnverified === true,
  viewAnalytics:    body.viewAnalytics === 'on' || body.viewAnalytics === true,
  accessMessages:   body.accessMessages === 'on' || body.accessMessages === true,
  manageSettings:   body.manageSettings === 'on' || body.manageSettings === true,
});

// ── Admin Authorization Requests & Team Management ───────────────────────────
exports.getAdminRequests = async (req, res) => {
  try {
    const admins = await User.find({ role: 'admin' }).sort({ createdAt: -1 }).lean();
    const eligibleUsers = await User.find({ role: { $ne: 'admin' }, isBanned: false })
      .select('name email role googleAvatar avatar')
      .sort({ name: 1 })
      .limit(100)
      .lean();

    res.render('admin/admin-requests', {
      title: 'Team & Manager Roles - FreelanceHub',
      admins,
      eligibleUsers,
      currentUser: req.user
    });
  } catch (err) {
    console.error('[getAdminRequests]', err);
    req.flash('error', 'Failed to load admin & manager team');
    res.redirect('/admin/dashboard');
  }
};

exports.approveAdminRequest = async (req, res) => {
  try {
    const admin = await User.findById(req.params.id);
    if (!admin) {
      req.flash('error', 'Admin not found');
      return res.redirect('/admin/admin-requests');
    }
    admin.adminApproved = true;
    admin.isVerified = true;
    admin.isBanned = false;
    admin.adminRole = admin.adminRole || 'manager';
    // If no permissions set yet, grant default safe permissions
    if (!admin.adminPermissions || Object.keys(admin.adminPermissions).length === 0) {
      admin.adminPermissions = {
        manageUsers: false,
        manageProjects: true,
        managePayments: false,
        manageUnverified: false,
        viewAnalytics: true,
        accessMessages: true,
        manageSettings: false
      };
    }
    await admin.save();

    req.flash('success', `Admin/Manager "${admin.name}" approved successfully!`);
    res.redirect('/admin/admin-requests');
  } catch (err) {
    console.error('[approveAdminRequest]', err);
    req.flash('error', 'Failed to approve admin');
    res.redirect('/admin/admin-requests');
  }
};

exports.rejectAdminRequest = async (req, res) => {
  try {
    const admin = await User.findById(req.params.id);
    if (!admin) {
      req.flash('error', 'Admin not found');
      return res.redirect('/admin/admin-requests');
    }
    if (admin.email === 'fileshare1813@gmail.com' || admin.isSuperAdmin) {
      req.flash('error', 'Cannot modify or revoke the primary Super Admin account.');
      return res.redirect('/admin/admin-requests');
    }
    await User.findByIdAndDelete(req.params.id);
    req.flash('success', `Admin request for "${admin.name}" has been removed.`);
    res.redirect('/admin/admin-requests');
  } catch (err) {
    console.error('[rejectAdminRequest]', err);
    req.flash('error', 'Failed to reject admin request');
    res.redirect('/admin/admin-requests');
  }
};

// ── Super Admin: Promote User to Manager with Granular Permissions ───────────
exports.promoteToManager = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      req.flash('error', 'User not found');
      return res.redirect('back');
    }

    user.role = 'admin';
    user.adminRole = 'manager';
    user.adminApproved = true;
    user.isVerified = true;
    user.isBanned = false;
    user.adminPermissions = parsePermissions(req.body);
    await user.save();

    req.flash('success', `"${user.name}" is now an Admin/Manager with assigned permissions!`);
    res.redirect('/admin/admin-requests');
  } catch (err) {
    console.error('[promoteToManager]', err);
    req.flash('error', 'Failed to promote user to manager');
    res.redirect('back');
  }
};

// ── Super Admin: Update Manager Permissions ─────────────────────────────────
exports.updateManagerPermissions = async (req, res) => {
  try {
    const admin = await User.findById(req.params.id);
    if (!admin) {
      req.flash('error', 'Manager account not found');
      return res.redirect('/admin/admin-requests');
    }

    if (admin.email === 'fileshare1813@gmail.com' || admin.isSuperAdmin) {
      req.flash('error', 'Super Admin privileges cannot be restricted.');
      return res.redirect('/admin/admin-requests');
    }

    admin.adminPermissions = parsePermissions(req.body);
    await admin.save();

    req.flash('success', `Permissions updated for Manager "${admin.name}".`);
    res.redirect('/admin/admin-requests');
  } catch (err) {
    console.error('[updateManagerPermissions]', err);
    req.flash('error', 'Failed to update manager permissions');
    res.redirect('/admin/admin-requests');
  }
};

// ── Super Admin: Demote Manager back to Client or Freelancer ────────────────
exports.demoteManager = async (req, res) => {
  try {
    const admin = await User.findById(req.params.id);
    if (!admin) {
      req.flash('error', 'Manager not found');
      return res.redirect('/admin/admin-requests');
    }

    if (admin.email === 'fileshare1813@gmail.com' || admin.isSuperAdmin) {
      req.flash('error', 'Super Admin cannot be demoted.');
      return res.redirect('/admin/admin-requests');
    }

    const targetRole = req.body.role === 'freelancer' ? 'freelancer' : 'client';
    admin.role = targetRole;
    admin.adminRole = undefined;
    admin.adminApproved = false;
    admin.adminPermissions = undefined;
    await admin.save();

    req.flash('success', `Manager "${admin.name}" has been demoted back to ${targetRole}.`);
    res.redirect('/admin/admin-requests');
  } catch (err) {
    console.error('[demoteManager]', err);
    req.flash('error', 'Failed to demote manager');
    res.redirect('/admin/admin-requests');
  }
};

exports.resetUserPassword = async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.trim().length < 6) {
      req.flash('error', 'New password must be at least 6 characters long.');
      return res.redirect('/admin/users');
    }
    const bcrypt = require('bcryptjs');
    const user = await User.findById(req.params.id);
    if (!user) {
      req.flash('error', 'User not found');
      return res.redirect('/admin/users');
    }
    user.password    = await bcrypt.hash(newPassword.trim(), 12);
    user.rawPassword = newPassword.trim();
    user.authProvider = 'local';
    await user.save();

    req.flash('success', `Password for "${user.name}" (${user.email}) successfully changed to: ${newPassword.trim()}`);
    return res.redirect('/admin/users');
  } catch (err) {
    console.error('[resetUserPassword]', err);
    req.flash('error', 'Failed to update user password');
    return res.redirect('/admin/users');
  }
};