const express = require('express');
const router = express.Router();
const { isClient } = require('../middleware/auth');
const clientController = require('../controllers/clientController');

router.use(isClient);

router.get('/dashboard', clientController.getDashboard);
router.get('/post-project', clientController.getPostProject);
router.post('/post-project', clientController.postProject);
router.get('/my-projects', clientController.getMyProjects);
router.get('/proposals', clientController.getAllProposals);
router.get('/my-projects/:id/proposals', clientController.getProjectProposals);
router.post('/proposals/:proposalId/accept', clientController.acceptProposal);
router.post('/projects/:id/complete', clientController.markProjectComplete);
router.post('/projects/:id/delete', clientController.deleteProject);
router.get('/find-freelancer', clientController.getFindFreelancers);
router.get('/freelancer/:id', clientController.getFreelancerProfile);
router.get('/graph-data', clientController.getGraphDataAPI);

module.exports = router;