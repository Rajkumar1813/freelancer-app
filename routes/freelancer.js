const express = require('express');
const router = express.Router();
const { isFreelancer } = require('../middleware/auth');
const upload = require('../middleware/upload');
const freelancerController = require('../controllers/freelancerController');

router.use(isFreelancer);

router.get('/dashboard', freelancerController.getDashboard);
router.get('/browse-projects', freelancerController.getBrowseProjects);
router.post('/projects/:projectId/apply', freelancerController.submitProposal);
router.get('/my-proposals', freelancerController.getMyProposals);
router.get('/submit-report', freelancerController.getSubmitReport);
router.post('/submit-report', freelancerController.postReport);
router.get('/edit-profile', freelancerController.getEditProfile);
router.post('/edit-profile', upload.single('avatar'), freelancerController.postEditProfile);
router.post('/message-client', freelancerController.messageClientAboutProject);
router.post('/proposals/:id/cancel', freelancerController.cancelProposal);
router.post('/proposals/cancel-by-project/:projectId', freelancerController.cancelProposalByProject);
router.get('/graph-data', freelancerController.getGraphDataAPI);

module.exports = router;