const Project = require('../models/Project');
const User = require('../models/User');
const Proposal = require('../models/Proposal');
const Notification = require('../models/Notification');
const Conversation = require('../models/Conversation');
const { getGraphData } = require('../utils/graphData');
const { getIO } = require('../config/socket');

exports.getDashboard = async (req, res) => {
  try {
    const [pendingProjects, inProgressProjects, completedProjects, totalProjects, totalProposals] = await Promise.all([
      Project.countDocuments({ client: req.user._id, status: 'open' }),
      Project.countDocuments({ client: req.user._id, status: 'in_progress' }),
      Project.countDocuments({ client: req.user._id, status: 'completed' }),
      Project.countDocuments({ client: req.user._id }),
      Proposal.countDocuments({ project: { $in: await Project.find({ client: req.user._id }).distinct('_id') } })
    ]);

    const recentProjects = await Project.find({ client: req.user._id }).populate('hiredFreelancer', 'name').sort({ createdAt: -1 }).limit(5);
    const graphData = await getGraphData('client', req.user._id);
    const spentResult = await Project.aggregate([
      { $match: { client: req.user._id, status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$amountPaid' } } }
    ]);

    res.render('client/dashboard', {
      title: 'Client Dashboard - FreelanceHub',
      stats: {
        pendingProjects,
        inProgressProjects,
        completedProjects,
        totalProjects,
        activeProjects: pendingProjects + inProgressProjects,
        totalProposals,
        totalSpent: spentResult[0]?.total || 0
      },
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

    // Counts for tabs/pills
    const allUserProjects = await Project.find({ client: req.user._id }).select('status').lean();
    const counts = {
      all: allUserProjects.length,
      open: allUserProjects.filter(p => p.status === 'open').length,
      in_progress: allUserProjects.filter(p => p.status === 'in_progress').length,
      completed: allUserProjects.filter(p => p.status === 'completed').length,
      cancelled: allUserProjects.filter(p => p.status === 'cancelled').length
    };

    res.render('client/my-projects', { title: 'My Projects - FreelanceHub', projects, counts, filters: req.query });
  } catch (err) {
    req.flash('error', 'Failed to load projects');
    res.redirect('/client/dashboard');
  }
};

exports.getAllProposals = async (req, res) => {
  try {
    const { project: filterProjectId, status: filterStatus, sort = '-createdAt', search } = req.query;

    const myProjects = await Project.find({ client: req.user._id }).sort({ createdAt: -1 }).lean();
    const myProjectIds = myProjects.map(p => p._id);

    let query = { project: { $in: myProjectIds } };
    if (filterProjectId) query.project = filterProjectId;
    if (filterStatus) query.status = filterStatus;

    let proposals = await Proposal.find(query)
      .populate('project', 'title budget budgetType status proposalCount priority deadline')
      .populate('freelancer', 'name email skills rating reviewCount hourlyRate googleAvatar')
      .sort(sort)
      .lean();

    if (search) {
      const s = search.toLowerCase().trim();
      proposals = proposals.filter(p =>
        (p.freelancer?.name && p.freelancer.name.toLowerCase().includes(s)) ||
        (p.project?.title && p.project.title.toLowerCase().includes(s)) ||
        (p.coverLetter && p.coverLetter.toLowerCase().includes(s)) ||
        (p.freelancer?.skills && p.freelancer.skills.some(sk => sk.toLowerCase().includes(s)))
      );
    }

    // Counts across all proposals for client
    const allProps = await Proposal.find({ project: { $in: myProjectIds } }).select('status').lean();
    const stats = {
      total: allProps.length,
      pending: allProps.filter(p => p.status === 'pending').length,
      accepted: allProps.filter(p => p.status === 'accepted').length,
      rejected: allProps.filter(p => p.status === 'rejected').length
    };

    res.render('client/all-proposals', {
      title: 'Project Proposals - FreelanceHub',
      proposals,
      projects: myProjects,
      stats,
      filters: req.query
    });
  } catch (err) {
    console.error('[getAllProposals]', err);
    req.flash('error', 'Failed to load proposals');
    res.redirect('/client/dashboard');
  }
};

exports.getProjectProposals = async (req, res) => {
  try {
    const project = await Project.findOne({ _id: req.params.id, client: req.user._id });
    if (!project) { req.flash('error', 'Project not found'); return res.redirect('/client/my-projects'); }
    const proposals = await Proposal.find({ project: project._id }).populate('freelancer', 'name skills rating reviewCount hourlyRate googleAvatar').sort({ createdAt: -1 });
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