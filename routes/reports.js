const express  = require('express');
const router   = express.Router();
const { isLoggedIn } = require('../middleware/auth');
const Report   = require('../models/Report');
const Project  = require('../models/Project');

// GET /reports/project/:projectId
// Client, Freelancer, Admin — sabko access
router.get('/project/:projectId', isLoggedIn, async (req, res) => {
  try {
    // ── FIX: correct populate syntax (separate fields, not one string) ──
    const project = await Project.findById(req.params.projectId)
      .populate('client',          'name _id')
      .populate('hiredFreelancer', 'name _id');

    if (!project) {
      req.flash('error', 'Project not found');
      return res.redirect('/');
    }

    // ── Access check ────────────────────────────────────────────────────
    const userId   = req.user._id.toString();
    const isAdmin  = req.user.role === 'admin';
    const isClient = project.client && project.client._id.toString() === userId;
    const isHired  = project.hiredFreelancer &&
                     project.hiredFreelancer._id.toString() === userId;

    if (!isAdmin && !isClient && !isHired) {
      req.flash('error', 'Access denied');
      return res.redirect('/');
    }

    // ── Optional date filters ────────────────────────────────────────────
    const { dateFrom, dateTo, sort = '-date' } = req.query;
    const query = { project: project._id };

    if (dateFrom || dateTo) {
      query.date = {};
      if (dateFrom) query.date.$gte = new Date(dateFrom);
      if (dateTo)   query.date.$lte = new Date(new Date(dateTo).setHours(23, 59, 59));
    }

    const reports = await Report.find(query)
      .populate('freelancer', 'name googleAvatar avatar')
      .sort(sort);

    // ── Mark reports as seen if client is viewing ────────────────────────
    if (isClient) {
      await Report.updateMany(
        { project: project._id, clientSeen: false },
        { clientSeen: true }
      );
    }

    // ── Render shared/reports (works for all roles) ──────────────────────
    res.render('shared/reports', {
      title:   `Reports — ${project.title}`,
      reports,
      project,
      filters:  req.query,
      isClient,
      isHired,
      isAdmin
    });

  } catch (err) {
    console.error('[reports route]', err);
    req.flash('error', 'Failed to load reports');
    res.redirect('/');
  }
});

// ── GET /reports/api/project/:projectId (AJAX for modals & popups) ──────────
router.get('/api/project/:projectId', isLoggedIn, async (req, res) => {
  try {
    const project = await Project.findById(req.params.projectId)
      .select('title status hiredFreelancer client')
      .lean();

    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    const userId = req.user._id.toString();
    const isAdmin = req.user.role === 'admin';
    const isClient = project.client && project.client.toString() === userId;
    const isHired = project.hiredFreelancer && project.hiredFreelancer.toString() === userId;

    if (!isAdmin && !isClient && !isHired) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const reports = await Report.find({ project: project._id })
      .populate('freelancer', 'name googleAvatar')
      .sort({ createdAt: -1 })
      .lean();

    res.json({ success: true, project, reports });
  } catch (err) {
    console.error('[reports api]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch reports' });
  }
});

module.exports = router;