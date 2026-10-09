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

// ── Admin Authorization Requests ─────────────────────────────────────────────
exports.getAdminRequests = async (req, res) => {
  try {
    const admins = await User.find({ role: 'admin' }).sort({ createdAt: -1 }).lean();
    res.render('admin/admin-requests', {
      title: 'Admin Requests - FreelanceHub',
      admins,
      currentUser: req.user
    });
  } catch (err) {
    console.error('[getAdminRequests]', err);
    req.flash('error', 'Failed to load admin requests');
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
    await admin.save();

    req.flash('success', `Admin "${admin.name}" approved successfully! They can now log in.`);
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
    if (admin.email === 'fileshare1813@gmail.com') {
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