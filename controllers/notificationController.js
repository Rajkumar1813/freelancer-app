const Notification = require('../models/Notification');
const { getPagination } = require('../utils/pagination');
const { invalidateNotificationCache } = require('../utils/cache');

exports.getNotifications = async (req, res) => {
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
};

exports.markRead = async (req, res) => {
  try {
    await Notification.findOneAndUpdate(
      { _id: req.params.id, recipient: req.user._id },
      { read: true }
    );
    invalidateNotificationCache(req.user._id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.markAllRead = async (req, res) => {
  try {
    await Notification.updateMany({ recipient: req.user._id }, { read: true });
    invalidateNotificationCache(req.user._id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getAPI = async (req, res) => {
  try {
    const notifications = await Notification.find({ recipient: req.user._id })
      .populate('sender', 'name googleAvatar')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();
    res.json(notifications);
  } catch (err) {
    res.status(500).json([]);
  }
};

exports.deleteNotification = async (req, res) => {
  try {
    await Notification.findOneAndDelete({ _id: req.params.id, recipient: req.user._id });
    invalidateNotificationCache(req.user._id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
};