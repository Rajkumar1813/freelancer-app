const express = require('express');
const router = express.Router();
const { isLoggedIn } = require('../middleware/auth');
const Project = require('../models/Project');
const Proposal = require('../models/Proposal');

// Route /projects -> redirect to role-specific project hub
router.get('/', isLoggedIn, (req, res) => {
  if (req.user.role === 'freelancer') {
    return res.redirect('/freelancer/browse-projects');
  }
  if (req.user.role === 'client') {
    return res.redirect('/client/my-projects');
  }
  if (req.user.role === 'admin') {
    return res.redirect('/admin/projects');
  }
  return res.redirect('/');
});

// Single project detail view
router.get('/:id', isLoggedIn, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id)
      .populate('client', 'name rating company googleAvatar avatar')
      .populate('hiredFreelancer', 'name rating skills')
      .lean();

    if (!project) {
      req.flash('error', 'Project not found');
      return res.redirect('/projects');
    }

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
      currentUser: req.user
    });
  } catch (err) {
    console.error('[getProjectDetail]', err);
    req.flash('error', 'Failed to load project');
    res.redirect('/projects');
  }
});

module.exports = router;