const Project = require('../models/Project');
const Proposal = require('../models/Proposal');
const User = require('../models/User');
const { getPagination } = require('../utils/pagination');

exports.getAllProjects = async (req, res) => {
  try {
    const { status, category, search, sort = '-createdAt', minBudget, maxBudget, page = 1 } = req.query;
    let query = {};

    // Role-based visibility
    if (req.user.role === 'client') {
      query.client = req.user._id;
    } else if (req.user.role === 'freelancer') {
      query.isPublic = true;
      query.status = 'open';
    }
    // admin sees all

    if (status && req.user.role !== 'freelancer') query.status = status;
    if (category) query.category = category;
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }
    if (minBudget || maxBudget) {
      query.budget = {};
      if (minBudget) query.budget.$gte = Number(minBudget);
      if (maxBudget) query.budget.$lte = Number(maxBudget);
    }

    const [totalItems, categories] = await Promise.all([
      Project.countDocuments(query),
      Project.distinct('category')
    ]);

    const pagination = getPagination(page, 12, totalItems);

    const projects = await Project.find(query)
      .select('-attachments.data')
      .populate('client', 'name rating company')
      .populate('hiredFreelancer', 'name')
      .sort(sort)
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean();

    res.render('shared/projects', {
      title: 'Projects - FreelanceHub',
      projects,
      categories,
      pagination,
      filters: req.query
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to load projects');
    res.redirect('/');
  }
};

exports.getProjectDetail = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id)
      .select('-attachments.data')
      .populate('client', 'name rating company googleAvatar')
      .populate('hiredFreelancer', 'name rating skills')
      .lean();

    if (!project) {
      req.flash('error', 'Project not found');
      return res.redirect('/projects');
    }

    // Check access
    const isOwner = project.client._id.toString() === req.user._id.toString();
    const isHired = project.hiredFreelancer &&
      project.hiredFreelancer._id.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';
    const isPublicFreelancer = req.user.role === 'freelancer' && project.isPublic;

    if (!isOwner && !isHired && !isAdmin && !isPublicFreelancer) {
      req.flash('error', 'Access denied');
      return res.redirect('/projects');
    }

    // Check if current user already applied
    let userProposal = null;
    if (req.user.role === 'freelancer') {
      userProposal = await Proposal.findOne({
        project: project._id,
        freelancer: req.user._id
      }).lean();
    }

    const proposalCount = await Proposal.countDocuments({ project: project._id });

    res.render('shared/project-detail', {
      title: `${project.title} - FreelanceHub`,
      project,
      userProposal,
      proposalCount,
      isOwner
    });
  } catch (err) {
    req.flash('error', 'Failed to load project');
    res.redirect('/projects');
  }
};

exports.deleteProject = async (req, res) => {
  try {
    const project = await Project.findOne({
      _id: req.params.id,
      client: req.user._id,
      status: 'open'
    });
    if (!project) {
      req.flash('error', 'Project not found or cannot be deleted');
      return res.redirect('/client/my-projects');
    }
    await Project.findByIdAndDelete(req.params.id);
    await Proposal.deleteMany({ project: req.params.id });
    req.flash('success', 'Project deleted successfully');
    res.redirect('/client/my-projects');
  } catch (err) {
    req.flash('error', 'Failed to delete project');
    res.redirect('/client/my-projects');
  }
};