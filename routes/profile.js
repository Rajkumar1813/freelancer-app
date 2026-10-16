const express = require('express');
const router = express.Router();
const { isLoggedIn } = require('../middleware/auth');
const upload = require('../middleware/upload');
const User = require('../models/User');
const Project = require('../models/Project');

router.get('/', isLoggedIn, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-avatar -avatarContentType -password -rawPassword').lean();
    let projects = [];
    if (user.role === 'client') projects = await Project.find({ client: user._id }).select('-attachments.data').sort({ createdAt: -1 }).limit(5).lean();
    if (user.role === 'freelancer') projects = await Project.find({ hiredFreelancer: user._id }).select('-attachments.data').sort({ createdAt: -1 }).limit(5).lean();
    res.render('shared/profile', { title: 'My Profile - FreelanceHub', profileUser: user, projects });
  } catch (err) {
    req.flash('error', 'Failed to load profile');
    res.redirect('/');
  }
});

router.get('/:id', isLoggedIn, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-avatar -avatarContentType -password -rawPassword').lean();
    if (!user) { req.flash('error', 'User not found'); return res.redirect('/'); }
    let projects = [];
    if (user.role === 'client') projects = await Project.find({ client: user._id, status: 'completed' }).select('-attachments.data').limit(5).lean();
    if (user.role === 'freelancer') projects = await Project.find({ hiredFreelancer: user._id, status: 'completed' }).select('-attachments.data').limit(5).lean();
    res.render('shared/profile', { title: `${user.name}'s Profile - FreelanceHub`, profileUser: user, projects });
  } catch (err) {
    req.flash('error', 'Failed to load profile');
    res.redirect('/');
  }
});

const { isConfigured: isCloudinaryConfigured, uploadAvatarStream, deleteResource } = require('../utils/cloudinary');

// ── Avatar Upload & Crop Endpoint (Any User: Client, Freelancer, Admin) ────────
router.post('/avatar', isLoggedIn, upload.single('avatar'), async (req, res) => {
  try {
    let buffer = null;
    let mimetype = 'image/jpeg';

    if (req.file) {
      buffer = req.file.buffer;
      mimetype = req.file.mimetype;
    } else if (req.body.avatarBase64) {
      const matches = req.body.avatarBase64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        mimetype = matches[1];
        buffer = Buffer.from(matches[2], 'base64');
      }
    }

    if (!buffer) {
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(400).json({ success: false, message: 'No cropped avatar received' });
      }
      req.flash('error', 'No image file uploaded');
      return res.redirect('/profile');
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }
      req.flash('error', 'User not found');
      return res.redirect('/profile');
    }

    let finalAvatarUrl = null;

    if (isCloudinaryConfigured()) {
      // ── Cloudinary Stream Upload ──────────────────────────────────
      const result = await uploadAvatarStream(buffer, user._id);

      // Clean up previous Cloudinary avatar if present
      if (user.avatarPublicId && user.avatarPublicId !== result.public_id) {
        deleteResource(user.avatarPublicId).catch(() => {});
      }

      user.avatarUrl = result.secure_url;
      user.avatarPublicId = result.public_id;
      user.avatar = undefined;
      user.avatarContentType = undefined;
      user.googleAvatar = null;
      await user.save();

      finalAvatarUrl = user.avatarUrl;
    } else {
      // ── Fallback (local dev without Cloudinary credentials) ────────
      user.avatar = buffer;
      user.avatarContentType = mimetype;
      user.googleAvatar = null;
      await user.save();

      finalAvatarUrl = `/avatar/${user._id}?t=${Date.now()}`;
    }

    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, avatarUrl: finalAvatarUrl, message: 'Profile photo updated successfully!' });
    }

    req.flash('success', 'Profile photo updated successfully!');
    return res.redirect('/profile');
  } catch (err) {
    console.error('[postAvatar]', err);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ success: false, message: 'Failed to update avatar: ' + err.message });
    }
    req.flash('error', 'Failed to update avatar');
    return res.redirect('/profile');
  }
});

module.exports = router;