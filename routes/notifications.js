const express = require('express');
const router = express.Router();
const { isLoggedIn } = require('../middleware/auth');
const Notification = require('../models/Notification');
const { getPagination } = require('../utils/pagination');
const { invalidateNotificationCache } = require('../utils/cache');

router.get('/', isLoggedIn, async (req, res) => {
  try {
    const { page = 1 } = req.query;
    const totalItems = await Notification.countDocuments({ recipient: req.user._id });
    const pagination = getPagination(page, 20, totalItems);

    const notifications = await Notification.find({ recipient: req.user._id })
      .populate('sender', 'name googleAvatar')
      .sort({ createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean();

    // Mark current user's unread notifications as read and invalidate cache
    Notification.updateMany({ recipient: req.user._id, read: false }, { read: true })
      .then(() => invalidateNotificationCache(req.user._id))
      .catch(e => console.error(e));

    res.render('shared/notifications', {
      title: 'Notifications - FreelanceHub',
      notifications,
      pagination,
      filters: req.query
    });
  } catch (err) {
    req.flash('error', 'Failed to load notifications');
    res.redirect('/');
  }
});

router.post('/mark-read/:id', isLoggedIn, async (req, res) => {
  await Notification.findOneAndUpdate({ _id: req.params.id, recipient: req.user._id }, { read: true });
  invalidateNotificationCache(req.user._id);
  res.json({ success: true });
});

router.post('/mark-all-read', isLoggedIn, async (req, res) => {
  await Notification.updateMany({ recipient: req.user._id }, { read: true });
  invalidateNotificationCache(req.user._id);
  res.json({ success: true });
});

router.get('/api', isLoggedIn, async (req, res) => {
  const notifications = await Notification.find({ recipient: req.user._id })
    .populate('sender', 'name googleAvatar')
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();
  res.json(notifications);
});

module.exports = router;