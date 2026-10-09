const Project = require('../models/Project');
const User = require('../models/User');
const Proposal = require('../models/Proposal');
const Notification = require('../models/Notification');
const Conversation = require('../models/Conversation');
const { getGraphData } = require('../utils/graphData');
const { getIO } = require('../config/socket');

exports.getDashboard = async (req, res) => {
  try {
    const [activeProjects, completedProjects, totalProposals] = await Promise.all([
      Project.countDocuments({ client: req.user._id, status: { $in: ['open', 'in_progress'] } }),
      Project.countDocuments({ client: req.user._id, status: 'completed' }),
      Proposal.countDocuments({ project: { $in: await Project.find({ client: req.user._id }).distinct('_id') } })
    ]);

    const recentProjects = await Project.find({ client: req.user._id }).sort({ createdAt: -1 }).limit(5);
    const graphData = await getGraphData('client', req.user._id);
    const spentResult = await Project.aggregate([
      { $match: { client: req.user._id, status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$amountPaid' } } }
    ]);

    res.render('client/dashboard', {
      title: 'Client Dashboard - FreelanceHub',
      stats: { activeProjects, completedProjects, totalProposals, totalSpent: spentResult[0]?.total || 0 },
      recentProjects, graphData
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to load dashboard');
    res.redirect('/');
  }
};

exports.getPostProject = (req, res) => {
  res.render('client/post-project', { title: 'Post a Project - FreelanceHub' });
};

exports.postProject = async (req, res) => {
  try {
    const { title, description, budget, budgetType, skills, category, deadline, priority } = req.body;
    const skillsArr = typeof skills === 'string' ? skills.split(',').map(s => s.trim()).filter(Boolean) : (skills || []);
    
    await Project.create({
      title, description, budget, budgetType, skills: skillsArr,
      category, deadline: deadline || undefined, priority: priority || 'medium',
      client: req.user._id
    });

    // Notify freelancers with matching skills
    const matchingFreelancers = await User.find({ role: 'freelancer', skills: { $in: skillsArr }, isBanned: false });
    const io = getIO();
    for (const fl of matchingFreelancers) {
      const notif = await Notification.create({
        recipient: fl._id, sender: req.user._id, type: 'project_update',
        message: `New project matching your skills: "${title}"`, link: '/projects'
      });
      const pop = await notif.populate('sender', 'name googleAvatar');
      io.to(`user_${fl._id}`).emit('newNotification', pop);
    }

    req.flash('success', 'Project posted successfully!');
    res.redirect('/client/my-projects');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to post project');
    res.redirect('/client/post-project');
  }
};

exports.getMyProjects = async (req, res) => {
  try {
    const { status, sort = '-createdAt' } = req.query;
    let query = { client: req.user._id };
    if (status) query.status = status;
    const projects = await Project.find(query).populate('hiredFreelancer', 'name').sort(sort).lean();
    res.render('client/my-projects', { title: 'My Projects - FreelanceHub', projects, filters: req.query });
  } catch (err) {
    req.flash('error', 'Failed to load projects');
    res.redirect('/client/dashboard');
  }
};

exports.getProjectProposals = async (req, res) => {
  try {
    const project = await Project.findOne({ _id: req.params.id, client: req.user._id });
    if (!project) { req.flash('error', 'Project not found'); return res.redirect('/client/my-projects'); }
    const proposals = await Proposal.find({ project: project._id }).populate('freelancer', 'name skills rating reviewCount hourlyRate').sort({ createdAt: -1 });
    res.render('client/proposals', { title: 'Proposals - FreelanceHub', project, proposals });
  } catch (err) {
    req.flash('error', 'Failed to load proposals');
    res.redirect('/client/my-projects');
  }
};

exports.acceptProposal = async (req, res) => {
  try {
    const proposal = await Proposal.findById(req.params.proposalId).populate('project freelancer');
    if (!proposal) { req.flash('error', 'Proposal not found'); return res.redirect('/client/my-projects'); }
    
    const project = proposal.project;
    if (project.client.toString() !== req.user._id.toString()) {
      req.flash('error', 'Unauthorized'); return res.redirect('/client/my-projects');
    }

    // Accept this, reject others
    await Proposal.updateMany({ project: project._id, _id: { $ne: proposal._id } }, { status: 'rejected' });
    proposal.status = 'accepted';
    await proposal.save();

    project.hiredFreelancer = proposal.freelancer._id;
    project.status = 'in_progress';
    await project.save();

    // Notify freelancer
    const notif = await Notification.create({
      recipient: proposal.freelancer._id, sender: req.user._id, type: 'hired',
      message: `Congratulations! You've been hired for "${project.title}"`,
      link: `/freelancer/my-proposals`
    });
    const pop = await notif.populate('sender', 'name googleAvatar');
    getIO().to(`user_${proposal.freelancer._id}`).emit('newNotification', pop);

    // Prompt freelancer to add payout details if not set
    const hiredFl = await User.findById(proposal.freelancer._id);
    if (!hiredFl.payoutDetails?.method) {
      const payoutPrompt = await Notification.create({
        recipient: proposal.freelancer._id,
        sender:    req.user._id,
        type:      'payment',
        message:   `🎉 You've been hired for "${project.title}"! Please add your bank/UPI details to receive your payment when the project is complete.`,
        link:      '/payments/freelancer'
      });
      const payoutPop = await payoutPrompt.populate('sender', 'name googleAvatar');
      getIO().to(`user_${proposal.freelancer._id}`).emit('newNotification', payoutPop);
    }

    req.flash('success', `${proposal.freelancer.name} hired successfully!`);
    res.redirect(`/client/my-projects`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to accept proposal');
    res.redirect('/client/my-projects');
  }
};

exports.getFindFreelancers = async (req, res) => {
  try {
    const { skill, minRate, maxRate, availability, sort = '-rating', search } = req.query;
    let query = { role: 'freelancer', isBanned: false, isVerified: true };
    if (skill) query.skills = { $in: [skill] };
    if (availability) query.availability = availability;
    if (minRate || maxRate) {
      query.hourlyRate = {};
      if (minRate) query.hourlyRate.$gte = Number(minRate);
      if (maxRate) query.hourlyRate.$lte = Number(maxRate);
    }
    if (search) query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { bio: { $regex: search, $options: 'i' } },
      { skills: { $in: [new RegExp(search, 'i')] } }
    ];
    const freelancers = await User.find(query).sort(sort).lean();
    const allSkills = await User.distinct('skills', { role: 'freelancer' });
    res.render('client/find-freelancer', { title: 'Find Freelancers - FreelanceHub', freelancers, allSkills, filters: req.query });
  } catch (err) {
    req.flash('error', 'Failed to load freelancers');
    res.redirect('/client/dashboard');
  }
};

exports.getFreelancerProfile = async (req, res) => {
  try {
    const freelancer = await User.findOne({ _id: req.params.id, role: 'freelancer' }).lean();
    if (!freelancer) { req.flash('error', 'Freelancer not found'); return res.redirect('/client/find-freelancer'); }
    const completedProjects = await Project.find({ hiredFreelancer: freelancer._id, status: 'completed' }).populate('client', 'name').sort({ completedAt: -1 }).limit(5).lean();
    
    // Check if conversation exists
    const existingConv = await Conversation.findOne({ participants: { $all: [req.user._id, freelancer._id] } });
    
    res.render('client/freelancer-profile', { title: `${freelancer.name} - FreelanceHub`, freelancer, completedProjects, existingConv });
  } catch (err) {
    req.flash('error', 'Failed to load profile');
    res.redirect('/client/find-freelancer');
  }
};

exports.markProjectComplete = async (req, res) => {
  try {
    const project = await Project.findOne({ _id: req.params.id, client: req.user._id });
    if (!project) { req.flash('error', 'Project not found'); return res.redirect('/client/my-projects'); }
    project.status = 'completed';
    project.completedAt = new Date();
    project.amountPaid = project.budget;
    await project.save();

    if (project.hiredFreelancer) {
      await User.findByIdAndUpdate(project.hiredFreelancer, {
        $inc: { totalEarnings: project.budget, completedProjects: 1 }
      });
      const notif = await Notification.create({
        recipient: project.hiredFreelancer, sender: req.user._id, type: 'payment',
        message: `Project "${project.title}" marked as completed. Payment: ₹${project.budget}`,
        link: '/freelancer/dashboard'
      });
      const pop = await notif.populate('sender', 'name googleAvatar');
      getIO().to(`user_${project.hiredFreelancer}`).emit('newNotification', pop);
      getIO().to(`user_${project.hiredFreelancer}`).emit('graphUpdate', { refresh: true });
    }
    await User.findByIdAndUpdate(req.user._id, { $inc: { totalSpent: project.budget } });
    getIO().emit('graphUpdate', { refresh: true });

    req.flash('success', 'Project marked as completed!');
    res.redirect('/client/my-projects');
  } catch (err) {
    req.flash('error', 'Failed to complete project');
    res.redirect('/client/my-projects');
  }
};

exports.getGraphDataAPI = async (req, res) => {
  try {
    const data = await getGraphData('client', req.user._id);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false });
  }
};

exports.deleteProject = async (req, res) => {
  try {
    const project = await Project.findOne({ _id: req.params.id, client: req.user._id });
    if (!project) {
      req.flash('error', 'Project not found or unauthorized');
      return res.redirect('/client/my-projects');
    }
    if (project.status === 'in_progress' && project.paymentStatus === 'escrow_funded') {
      req.flash('error', 'Cannot delete a project currently in progress with escrow funds. Please complete or cancel escrow first.');
      return res.redirect('/client/my-projects');
    }
    // Delete associated proposals and project
    await Proposal.deleteMany({ project: project._id });
    await Project.findByIdAndDelete(project._id);

    req.flash('success', `Project "${project.title}" has been deleted.`);
    return res.redirect('/client/my-projects');
  } catch (err) {
    console.error('[deleteProject]', err);
    req.flash('error', 'Failed to delete project');
    return res.redirect('/client/my-projects');
  }
};