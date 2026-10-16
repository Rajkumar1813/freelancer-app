const User = require('../models/User');
const Project = require('../models/Project');
const Proposal = require('../models/Proposal');
const Notification = require('../models/Notification');
const Payment = require('../models/Payment');
const Setting = require('../models/Setting');
const { getGraphData } = require('../utils/graphData');
const { getIO } = require('../config/socket');
const { getPagination } = require('../utils/pagination');

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
      User.find({ role: { $ne: 'admin' } })
        .select('-avatar -avatarContentType -password -rawPassword')
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
      Project.find()
        .select('-attachments.data')
        .populate('client', 'name')
        .sort({ createdAt: -1 })
        .limit(5)
        .lean()
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
    const { role, status, search, sort = '-createdAt', page = 1 } = req.query;
    let query = { role: { $ne: 'admin' } };
    if (role) query.role = role;
    if (status === 'banned') query.isBanned = true;
    if (status === 'active') query.isBanned = false;
    if (search) query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } }
    ];

    const [totalItems, allUsersForStats] = await Promise.all([
      User.countDocuments(query),
      User.find({ role: { $ne: 'admin' } }).select('role isBanned').lean()
    ]);

    const pagination = getPagination(page, 15, totalItems);

    const users = await User.find(query)
      .select('-avatar -avatarContentType -password -rawPassword')
      .sort(sort)
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean();

    const stats = {
      totalUsers: allUsersForStats.length,
      clientsCount: allUsersForStats.filter(u => u.role === 'client').length,
      freelancersCount: allUsersForStats.filter(u => u.role === 'freelancer').length,
      bannedCount: allUsersForStats.filter(u => u.isBanned).length
    };

    res.render('admin/users', { title: 'Manage Users - FreelanceHub', users, stats, pagination, filters: req.query });
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
    const { status, category, search, sort = '-createdAt', page = 1 } = req.query;
    let query = {};
    if (status) query.status = status;
    if (category) query.category = category;
    if (search) query.$text = { $search: search };

    const [totalItems, categories] = await Promise.all([
      Project.countDocuments(query),
      Project.distinct('category')
    ]);

    const pagination = getPagination(page, 15, totalItems);

    const projects = await Project.find(query)
      .select('-attachments.data')
      .populate('client', 'name email')
      .populate('hiredFreelancer', 'name')
      .sort(sort)
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean();

    res.render('admin/projects', { title: 'All Projects - FreelanceHub', projects, categories, pagination, filters: req.query });
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
    // Emit only to admin room sockets to avoid leaking/overwriting client/freelancer dashboards
    try { getIO().to('admin_room').emit('graphUpdate', data); } catch(e) {}
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

// ── Settings Management ──────────────────────────────────────────────────────
exports.getSettings = async (req, res) => {
  try {
    const settings = await Setting.getSettings();
    res.render('admin/settings', {
      title: 'Platform Settings - FreelanceHub',
      settings,
      currentUser: req.user
    });
  } catch (err) {
    console.error('[getSettings]', err);
    req.flash('error', 'Failed to load settings');
    res.redirect('/admin/dashboard');
  }
};

exports.updateSettings = async (req, res) => {
  try {
    let settings = await Setting.getSettings();
    const b = req.body || {};

    if (b.platformName !== undefined) settings.platformName = b.platformName.trim();
    if (b.tagline !== undefined) settings.tagline = b.tagline.trim();
    if (b.supportEmail !== undefined) settings.supportEmail = b.supportEmail.trim();
    if (b.platformUrl !== undefined) settings.platformUrl = b.platformUrl.trim();

    if (b.commissionRate !== undefined && b.commissionRate !== '') settings.commissionRate = Number(b.commissionRate);
    if (b.minBudget !== undefined && b.minBudget !== '') settings.minBudget = Number(b.minBudget);
    if (b.maxBudget !== undefined && b.maxBudget !== '') settings.maxBudget = Number(b.maxBudget);

    if (b.smtpHost !== undefined) settings.smtpHost = b.smtpHost.trim();
    if (b.smtpPort !== undefined && b.smtpPort !== '') settings.smtpPort = Number(b.smtpPort);
    if (b.fromEmail !== undefined) settings.fromEmail = b.fromEmail.trim();
    if (b.fromName !== undefined) settings.fromName = b.fromName.trim();
    if (b.otpExpiry !== undefined && b.otpExpiry !== '') settings.otpExpiry = Number(b.otpExpiry);

    if (b.emailNotifs) {
      settings.emailNotifs.newRegistration  = Boolean(b.emailNotifs.newRegistration);
      settings.emailNotifs.newProposal      = Boolean(b.emailNotifs.newProposal);
      settings.emailNotifs.projectCompleted = Boolean(b.emailNotifs.projectCompleted);
      settings.emailNotifs.dailyReports     = Boolean(b.emailNotifs.dailyReports);
    }

    if (b.security) {
      settings.security.requireEmailVerification = Boolean(b.security.requireEmailVerification);
      settings.security.allowGoogleOAuth         = Boolean(b.security.allowGoogleOAuth);
      settings.security.autoBanOnReports         = Boolean(b.security.autoBanOnReports);
      if (b.security.sessionDays !== undefined && b.security.sessionDays !== '') settings.security.sessionDays = Number(b.security.sessionDays);
      if (b.security.jwtExpiry !== undefined && b.security.jwtExpiry !== '') settings.security.jwtExpiry = Number(b.security.jwtExpiry);
      if (b.security.maxLoginAttempts !== undefined && b.security.maxLoginAttempts !== '') settings.security.maxLoginAttempts = Number(b.security.maxLoginAttempts);
    }

    if (b.inAppNotifs) {
      settings.inAppNotifs.newMessage           = Boolean(b.inAppNotifs.newMessage);
      settings.inAppNotifs.newProposal          = Boolean(b.inAppNotifs.newProposal);
      settings.inAppNotifs.hiredNotification    = Boolean(b.inAppNotifs.hiredNotification);
      settings.inAppNotifs.dailyReportSubmitted = Boolean(b.inAppNotifs.dailyReportSubmitted);
      settings.inAppNotifs.paymentNotifications = Boolean(b.inAppNotifs.paymentNotifications);
    }

    if (b.platformFeatures) {
      settings.platformFeatures.allowNewRegistrations = Boolean(b.platformFeatures.allowNewRegistrations);
      settings.platformFeatures.maintenanceMode       = Boolean(b.platformFeatures.maintenanceMode);
      settings.platformFeatures.realtimeGraphs        = Boolean(b.platformFeatures.realtimeGraphs);
      settings.platformFeatures.profilePrivacy        = Boolean(b.platformFeatures.profilePrivacy);
      if (b.platformFeatures.maxProjects !== undefined && b.platformFeatures.maxProjects !== '') settings.platformFeatures.maxProjects = Number(b.platformFeatures.maxProjects);
      if (b.platformFeatures.maxSkills !== undefined && b.platformFeatures.maxSkills !== '') settings.platformFeatures.maxSkills = Number(b.platformFeatures.maxSkills);
    }

    await settings.save();
    return res.json({ success: true, message: 'Platform settings saved successfully!' });
  } catch (err) {
    console.error('[updateSettings]', err);
    return res.status(500).json({ success: false, message: 'Failed to save settings: ' + err.message });
  }
};

exports.getSettingsStats = async (req, res) => {
  try {
    const [totalUsers, totalProjects, totalPayments, completedProjects] = await Promise.all([
      User.countDocuments({ role: { $ne: 'admin' } }),
      Project.countDocuments(),
      Payment.find({ status: { $in: ['released', 'completed', 'paid'] } }).select('totalAmount platformFee freelancerAmount'),
      Project.find({ status: 'completed' }).select('amountPaid budget')
    ]);

    let totalRevenue = 0;
    if (totalPayments.length > 0) {
      totalRevenue = totalPayments.reduce((acc, p) => acc + (p.platformFee || Math.round((p.totalAmount || 0) * 0.1)), 0);
    } else {
      totalRevenue = completedProjects.reduce((acc, p) => acc + Math.round((p.amountPaid || p.budget || 0) * 0.1), 0);
    }

    return res.json({
      success: true,
      stats: {
        totalUsers,
        totalProjects,
        totalRevenue
      }
    });
  } catch (err) {
    console.error('[getSettingsStats]', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.sendTestEmail = async (req, res) => {
  try {
    const transporter = require('../config/nodemailer');
    const settings = await Setting.getSettings();

    const recipient = req.body.email || settings.supportEmail || req.user.email;
    const info = await transporter.sendMail({
      from: `"${settings.fromName || 'FreelanceHub'}" <${process.env.EMAIL_USER}>`,
      to: recipient,
      subject: `[FreelanceHub] Test Email Configuration Verified`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
          <h2 style="color: #6c63ff; margin-top: 0;">FreelanceHub SMTP Test Successful</h2>
          <p>Hello <strong>${req.user.name}</strong>,</p>
          <p>This is a confirmation message verifying that your platform email dispatch system is connected and working correctly.</p>
          <div style="background: #f8fafc; padding: 14px 18px; border-radius: 8px; margin: 18px 0; font-size: 0.9em; color: #475569; border-left: 4px solid #6c63ff;">
            <p style="margin: 4px 0;"><strong>Host:</strong> ${settings.smtpHost || process.env.EMAIL_HOST || 'smtp.gmail.com'}</p>
            <p style="margin: 4px 0;"><strong>Port:</strong> ${settings.smtpPort || process.env.EMAIL_PORT || 587}</p>
            <p style="margin: 4px 0;"><strong>From Name:</strong> ${settings.fromName || 'FreelanceHub'}</p>
            <p style="margin: 4px 0;"><strong>Sent At:</strong> ${new Date().toLocaleString('en-IN')}</p>
          </div>
          <p style="color: #64748b; font-size: 0.85em; margin-bottom: 0;">FreelanceHub Platform Administration</p>
        </div>
      `
    });

    return res.json({
      success: true,
      message: `Test email successfully sent to ${recipient} (Message ID: ${info.messageId})`
    });
  } catch (err) {
    console.error('[sendTestEmail]', err);
    return res.status(500).json({
      success: false,
      message: `Failed to send test email: ${err.message}`
    });
  }
};

exports.clearOldNotifications = async (req, res) => {
  try {
    const days = Number(req.body.days) || 30;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const result = await Notification.deleteMany({ createdAt: { $lt: cutoff } });
    return res.json({
      success: true,
      deletedCount: result.deletedCount || 0,
      message: `Successfully cleared ${result.deletedCount || 0} notifications older than ${days} days.`
    });
  } catch (err) {
    console.error('[clearOldNotifications]', err);
    return res.status(500).json({ success: false, message: 'Failed to clear notifications: ' + err.message });
  }
};

exports.exportUsersCSV = async (req, res) => {
  try {
    const users = await User.find({}).sort({ createdAt: -1 }).lean();

    const headers = ['ID', 'Name', 'Email', 'Role', 'Verified', 'Banned', 'Total Earnings (INR)', 'Total Spent (INR)', 'Created At'];
    const rows = users.map(u => [
      `"${u._id}"`,
      `"${(u.name || '').replace(/"/g, '""')}"`,
      `"${(u.email || '').replace(/"/g, '""')}"`,
      `"${u.role || ''}"`,
      u.isVerified ? 'Yes' : 'No',
      u.isBanned ? 'Yes' : 'No',
      u.totalEarnings || 0,
      u.totalSpent || 0,
      `"${u.createdAt ? new Date(u.createdAt).toISOString() : ''}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="freelancehub-users-${new Date().toISOString().slice(0,10)}.csv"`);
    return res.send(csvContent);
  } catch (err) {
    console.error('[exportUsersCSV]', err);
    req.flash('error', 'Failed to export user records');
    return res.redirect('/admin/settings');
  }
};