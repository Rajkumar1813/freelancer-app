const Project = require('../models/Project');
const User = require('../models/User');
const Proposal = require('../models/Proposal');
const Notification = require('../models/Notification');
const Report = require('../models/Report');
const Conversation = require('../models/Conversation');
const { getGraphData } = require('../utils/graphData');
const { getIO } = require('../config/socket');

exports.getDashboard = async (req, res) => {
  try {
    const [activeProjects, completedProjects, totalProposals, pendingProposals] = await Promise.all([
      Project.countDocuments({ hiredFreelancer: req.user._id, status: 'in_progress' }),
      Project.countDocuments({ hiredFreelancer: req.user._id, status: 'completed' }),
      Proposal.countDocuments({ freelancer: req.user._id }),
      Proposal.countDocuments({ freelancer: req.user._id, status: 'pending' })
    ]);

    const recentProposals = await Proposal.find({ freelancer: req.user._id })
      .populate('project', 'title budget status').sort({ createdAt: -1 }).limit(5);
    const graphData = await getGraphData('freelancer', req.user._id);

    res.render('freelancer/dashboard', {
      title: 'Freelancer Dashboard - FreelanceHub',
      stats: { activeProjects, completedProjects, totalProposals, pendingProposals, totalEarnings: req.user.totalEarnings || 0 },
      recentProposals, graphData
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to load dashboard');
    res.redirect('/');
  }
};

exports.getBrowseProjects = async (req, res) => {
  try {
    const { skill, minBudget, maxBudget, category, sort = '-createdAt', search } = req.query;
    let query = { status: 'open', isPublic: true };
    if (skill) query.skills = { $in: [skill] };
    if (category) query.category = category;
    if (minBudget || maxBudget) {
      query.budget = {};
      if (minBudget) query.budget.$gte = Number(minBudget);
      if (maxBudget) query.budget.$lte = Number(maxBudget);
    }
    if (search) query.$text = { $search: search };

    const projects = await Project.find(query).populate('client', 'name rating').sort(sort).lean();

    // Mark which ones freelancer already applied to
    const myProposalProjectIds = (await Proposal.find({ freelancer: req.user._id }).distinct('project')).map(String);
    const projectsWithStatus = projects.map(p => ({
      ...p,
      alreadyApplied: myProposalProjectIds.includes(String(p._id))
    }));

    const categories = await Project.distinct('category');
    const allSkills = await User.distinct('skills', { role: 'freelancer' });
    
    res.render('freelancer/browse-projects', {
      title: 'Browse Projects - FreelanceHub',
      projects: projectsWithStatus, categories, allSkills, filters: req.query
    });
  } catch (err) {
    req.flash('error', 'Failed to load projects');
    res.redirect('/freelancer/dashboard');
  }
};

exports.submitProposal = async (req, res) => {
  try {
    const { coverLetter, bidAmount, deliveryTime } = req.body;
    const project = await Project.findOne({ _id: req.params.projectId, status: 'open' });
    if (!project) { req.flash('error', 'Project not found or closed'); return res.redirect('/freelancer/browse-projects'); }

    const existing = await Proposal.findOne({ project: project._id, freelancer: req.user._id });
    if (existing) { req.flash('error', 'Already applied to this project'); return res.redirect('/freelancer/browse-projects'); }

    await Proposal.create({ project: project._id, freelancer: req.user._id, coverLetter, bidAmount, deliveryTime });
    await Project.findByIdAndUpdate(project._id, { $inc: { proposalCount: 1 } });

    // Notify client
    const notif = await Notification.create({
      recipient: project.client, sender: req.user._id, type: 'proposal',
      message: `${req.user.name} submitted a proposal for "${project.title}"`,
      link: `/client/my-projects/${project._id}/proposals`
    });
    const pop = await notif.populate('sender', 'name googleAvatar');
    getIO().to(`user_${project.client}`).emit('newNotification', pop);

    req.flash('success', 'Proposal submitted successfully!');
    res.redirect('/freelancer/my-proposals');
  } catch (err) {
    if (err.code === 11000) { req.flash('error', 'Already applied to this project'); }
    else { req.flash('error', 'Failed to submit proposal'); }
    res.redirect('/freelancer/browse-projects');
  }
};

exports.getMyProposals = async (req, res) => {
  try {
    const { status, sort = '-createdAt' } = req.query;
    let query = { freelancer: req.user._id };
    if (status) query.status = status;
    const proposals = await Proposal.find(query).populate('project', 'title budget status deadline client').sort(sort);
    res.render('freelancer/my-proposals', { title: 'My Proposals - FreelanceHub', proposals, filters: req.query });
  } catch (err) {
    req.flash('error', 'Failed to load proposals');
    res.redirect('/freelancer/dashboard');
  }
};

exports.getSubmitReport = async (req, res) => {
  try {
    const activeProjects = await Project.find({ hiredFreelancer: req.user._id, status: 'in_progress' }).populate('client', 'name');
    res.render('freelancer/submit-report', { title: 'Submit Daily Report - FreelanceHub', activeProjects, selectedProject: req.query.project });
  } catch (err) {
    req.flash('error', 'Failed to load report form');
    res.redirect('/freelancer/dashboard');
  }
};

exports.postReport = async (req, res) => {
  try {
    const { projectId, hoursWorked, tasksCompleted, tasksPlanned, blockers, progressPercentage, notes } = req.body;
    const project = await Project.findOne({ _id: projectId, hiredFreelancer: req.user._id });
    if (!project) { req.flash('error', 'Project not found'); return res.redirect('/freelancer/submit-report'); }

    const tasksCompArr = typeof tasksCompleted === 'string' ? tasksCompleted.split('\n').filter(Boolean) : (tasksCompleted || []);
    const tasksPlanArr = typeof tasksPlanned === 'string' ? tasksPlanned.split('\n').filter(Boolean) : (tasksPlanned || []);

    const report = await Report.create({
      project: projectId, freelancer: req.user._id, client: project.client,
      hoursWorked, tasksCompleted: tasksCompArr, tasksPlanned: tasksPlanArr,
      blockers, progressPercentage, notes
    });

    // Notify client
    const notif = await Notification.create({
      recipient: project.client, sender: req.user._id, type: 'report',
      message: `${req.user.name} submitted a daily report for "${project.title}"`,
      link: `/reports/project/${projectId}`
    });
    const pop = await notif.populate('sender', 'name googleAvatar');
    getIO().to(`user_${project.client}`).emit('newNotification', pop);

    req.flash('success', 'Daily report submitted to client!');
    res.redirect('/freelancer/my-proposals');
  } catch (err) {
    req.flash('error', 'Failed to submit report');
    res.redirect('/freelancer/submit-report');
  }
};

exports.getEditProfile = (req, res) => {
  res.render('freelancer/edit-profile', { title: 'Edit Profile - FreelanceHub', user: req.user });
};

exports.postEditProfile = async (req, res) => {
  try {
    const { name, bio, location, phone, website, hourlyRate, skills, availability } = req.body;
    const skillsArr = typeof skills === 'string' ? skills.split(',').map(s => s.trim()).filter(Boolean) : (skills || []);
    
    const updateData = { name, bio, location, phone, website, hourlyRate, skills: skillsArr, availability };
    
    if (req.file) {
      updateData.avatar = req.file.buffer;
      updateData.avatarContentType = req.file.mimetype;
      updateData.googleAvatar = null; // Remove google avatar if uploading own
    } else if (req.body.avatarBase64) {
      const matches = req.body.avatarBase64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        updateData.avatarContentType = matches[1];
        updateData.avatar = Buffer.from(matches[2], 'base64');
        updateData.googleAvatar = null;
      }
    }

    await User.findByIdAndUpdate(req.user._id, updateData);
    req.flash('success', 'Profile updated successfully!');
    res.redirect('/profile');
  } catch (err) {
    req.flash('error', 'Failed to update profile');
    res.redirect('/freelancer/edit-profile');
  }
};

exports.getGraphDataAPI = async (req, res) => {
  try {
    const data = await getGraphData('freelancer', req.user._id);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false });
  }
};

exports.messageClientAboutProject = async (req, res) => {
  try {
    const { clientId, projectId, message } = req.body;
    const project = await Project.findById(projectId);
    if (!project) { req.flash('error', 'Project not found'); return res.redirect('/freelancer/browse-projects'); }

    // Find or create conversation
    let conversation = await Conversation.findOne({ participants: { $all: [req.user._id, clientId] } });
    if (!conversation) {
      conversation = await Conversation.create({ participants: [req.user._id, clientId], relatedProject: projectId });
    }

    res.redirect(`/messages/${conversation._id}?initMsg=${encodeURIComponent(message)}&projectId=${projectId}`);
  } catch (err) {
    req.flash('error', 'Failed to start conversation');
    res.redirect('/freelancer/browse-projects');
  }
};