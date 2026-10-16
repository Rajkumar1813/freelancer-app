/**
 * controllers/paymentController.js
 *
 * Flow:
 * 1. Freelancer hired  → prompt to save bank/UPI in profile
 * 2. Client pays       → Razorpay order → verify → status: 'paid' (escrow)
 * 3. Client marks done → project complete + payment moves to 'paid' (already was)
 * 4. Admin sees pending payout → clicks Release → status: 'released'
 * 5. Admin manually transfers via Razorpay dashboard → clicks Mark Sent → 'completed'
 * 6. Freelancer earnings updated, notifications sent
 */

const Payment      = require('../models/Payment');
const Project      = require('../models/Project');
const User         = require('../models/User');
const Notification = require('../models/Notification');
const { getIO }    = require('../config/socket');
const rzpSvc       = require('../utils/razorpayService');

const FEE_PCT = 10; // Platform commission %

// ── Notification helper ────────────────────────────────────────────────────────
const pushNotif = async (recipientId, senderId, type, message, link) => {
  try {
    const n   = await Notification.create({ recipient: recipientId, sender: senderId, type, message, link });
    const pop = await n.populate('sender', 'name googleAvatar');
    getIO().to(`user_${recipientId}`).emit('newNotification', pop);
  } catch (_) {}
};

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT: GET /payments/project/:projectId   — checkout page
// ─────────────────────────────────────────────────────────────────────────────
exports.getCheckout = async (req, res) => {
  try {
    const project = await Project.findOne({
      _id:    req.params.projectId,
      client: req.user._id
    }).populate('hiredFreelancer', 'name email payoutMethod payoutDetails');

    if (!project) {
      req.flash('error', 'Project not found');
      return res.redirect('/client/my-projects');
    }
    if (project.status !== 'in_progress') {
      req.flash('error', 'Payment only available for active projects');
      return res.redirect('/client/my-projects');
    }

    const existing  = await Payment.findOne({ project: project._id });
    const fee       = Math.round(project.budget * FEE_PCT / 100);
    const flAmount  = project.budget - fee;
    const { mode, key_id } = rzpSvc.getConfig();

    res.render('payment/checkout', {
      title:            `Pay for ${project.title} - FreelanceHub`,
      project,
      existing,
      platformFee:      fee,
      freelancerAmount: flAmount,
      razorpayKeyId:    key_id,
      razorpayMode:     mode
    });
  } catch (err) {
    console.error('[getCheckout]', err);
    req.flash('error', 'Failed to load payment page');
    res.redirect('/client/my-projects');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT: POST /payments/create-order
// ─────────────────────────────────────────────────────────────────────────────
exports.createOrder = async (req, res) => {
  try {
    const { projectId } = req.body;

    const project = await Project.findOne({
      _id:    projectId,
      client: req.user._id,
      status: 'in_progress'
    }).populate('hiredFreelancer', 'name email');

    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found or not active' });
    }

    // Block duplicate paid orders
    const dup = await Payment.findOne({
      project: project._id,
      status:  { $in: ['paid', 'released', 'completed'] }
    });
    if (dup) {
      return res.status(400).json({ success: false, message: 'Payment already completed for this project' });
    }

    const totalAmount      = project.budget;
    const platformFee      = Math.round(totalAmount * FEE_PCT / 100);
    const freelancerAmount = totalAmount - platformFee;
    const { mode }         = rzpSvc.getConfig();

    const order = await rzpSvc.createOrder({
      amountRupees: totalAmount,
      receipt:      `fh${project._id.toString().slice(-8)}${Date.now().toString().slice(-8)}`,
      notes: {
        projectId:    project._id.toString(),
        clientId:     req.user._id.toString(),
        freelancerId: project.hiredFreelancer._id.toString(),
        project:      project.title.substring(0, 50)
      }
    });

    // Save / update payment record
    await Payment.findOneAndUpdate(
      { project: project._id },
      {
        project: project._id,
        client:  req.user._id,
        freelancer:       project.hiredFreelancer._id,
        totalAmount,
        platformFee,
        freelancerAmount,
        razorpayOrderId:  order.id,
        razorpayMode:     mode,
        status:           'pending'
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({
      success:  true,
      orderId:  order.id,
      amount:   order.amount,   // in paise
      currency: 'INR',
      key:      rzpSvc.getConfig().key_id,
      mode,
      project:  { id: project._id, title: project.title },
      user:     { name: req.user.name, email: req.user.email, phone: req.user.phone || '' }
    });
  } catch (err) {
    console.error('[createOrder]', err);
    res.status(500).json({ success: false, message: err.message || 'Failed to create order' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT: POST /payments/verify
// ─────────────────────────────────────────────────────────────────────────────
exports.verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, projectId } = req.body;

    // Cryptographic signature verification
    const valid = rzpSvc.verifySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
    if (!valid) {
      return res.status(400).json({ success: false, message: 'Payment verification failed — signature mismatch' });
    }

    const payment = await Payment.findOneAndUpdate(
      { razorpayOrderId: razorpay_order_id },
      {
        razorpayPaymentId: razorpay_payment_id,
        razorpaySignature: razorpay_signature,
        status: 'paid',
        paidAt: new Date()
      },
      { new: true }
    ).populate('project freelancer client');

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment record not found' });
    }

    // Update project amountPaid
    await Project.findByIdAndUpdate(payment.project._id, {
      amountPaid: payment.totalAmount
    });

    // Notify freelancer
    await pushNotif(
      payment.freelancer._id,
      payment.client._id,
      'payment',
      `Client paid ₹${payment.totalAmount.toLocaleString('en-IN')} for "${payment.project.title}". Your ₹${payment.freelancerAmount.toLocaleString('en-IN')} will be transferred once the project is marked complete.`,
      '/payments/freelancer'
    );

    // Notify all admins
    const admins = await User.find({ role: 'admin' });
    for (const admin of admins) {
      await pushNotif(
        admin._id, payment.client._id, 'payment',
        `New payment: ₹${payment.totalAmount.toLocaleString('en-IN')} received for "${payment.project.title}". Platform fee: ₹${payment.platformFee.toLocaleString('en-IN')}.`,
        '/admin/payments'
      );
    }

    res.json({ success: true, message: 'Payment verified. Money is held in escrow.' });
  } catch (err) {
    console.error('[verifyPayment]', err);
    res.status(500).json({ success: false, message: 'Verification error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT: POST /payments/project/:projectId/complete  — mark project done
// ─────────────────────────────────────────────────────────────────────────────
exports.markProjectComplete = async (req, res) => {
  try {
    const project = await Project.findOne({
      _id:    req.params.projectId,
      client: req.user._id,
      status: 'in_progress'
    }).populate('hiredFreelancer', 'name _id');

    if (!project) {
      req.flash('error', 'Project not found');
      return res.redirect('/client/my-projects');
    }

    const payment = await Payment.findOne({ project: project._id, status: 'paid' });

    // Mark project complete
    project.status      = 'completed';
    project.completedAt = new Date();
    project.amountPaid  = payment ? payment.totalAmount : project.budget;
    await project.save();

    // Update client totalSpent
    await User.findByIdAndUpdate(req.user._id, {
      $inc: { totalSpent: project.amountPaid }
    });

    if (payment) {
      // Snapshot freelancer payout details at this moment
      const freelancer = await User.findById(payment.freelancer);
      if (freelancer?.payoutDetails?.method) {
        payment.payoutSnapshot = freelancer.payoutDetails;
      }
      await payment.save();

      // Notify freelancer
      await pushNotif(
        payment.freelancer, req.user._id, 'payment',
        `Project "${project.title}" marked complete! Your ₹${payment.freelancerAmount.toLocaleString('en-IN')} will be transferred to your ${payment.payoutSnapshot?.method?.toUpperCase() || 'registered'} account. Admin is processing the payout.`,
        '/payments/freelancer'
      );

      // Notify admins
      const admins = await User.find({ role: 'admin' });
      for (const admin of admins) {
        await pushNotif(
          admin._id, req.user._id, 'payment',
          `Action needed: Project "${project.title}" complete. Release ₹${payment.freelancerAmount.toLocaleString('en-IN')} to ${project.hiredFreelancer.name}.`,
          '/admin/payments'
        );
      }
    }

    // Also emit graph update
    try { getIO().emit('graphUpdate', { refresh: true }); } catch (_) {}

    req.flash('success', 'Project marked complete! Admin will process freelancer payment shortly.');
    res.redirect('/client/my-projects');
  } catch (err) {
    console.error('[markProjectComplete]', err);
    req.flash('error', 'Failed to complete project');
    res.redirect('/client/my-projects');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// FREELANCER: GET /payments/freelancer
// ─────────────────────────────────────────────────────────────────────────────
exports.getFreelancerPayments = async (req, res) => {
  try {
    const [payments, user] = await Promise.all([
      Payment.find({ freelancer: req.user._id })
        .populate('project', 'title status')
        .populate('client',  'name')
        .sort({ createdAt: -1 }),
      User.findById(req.user._id)
    ]);

    res.render('payment/freelancer-payments', {
      title:    'My Payments - FreelanceHub',
      payments,
      user,
      hasPayoutSetup: !!user.payoutDetails?.method
    });
  } catch (err) {
    console.error('[getFreelancerPayments]', err);
    req.flash('error', 'Failed to load payments');
    res.redirect('/freelancer/dashboard');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// FREELANCER: POST /payments/save-payout-details
// Called when freelancer first saves bank/UPI in their profile
// ─────────────────────────────────────────────────────────────────────────────
exports.savePayoutDetails = async (req, res) => {
  try {
    const { method, upiId, accountName, accountNumber, ifsc, bankName } = req.body;

    if (method === 'upi' && !upiId?.trim()) {
      return res.status(400).json({ success: false, message: 'UPI ID is required' });
    }
    if (method === 'bank' && (!accountName?.trim() || !accountNumber?.trim() || !ifsc?.trim())) {
      return res.status(400).json({ success: false, message: 'Account name, number and IFSC are required' });
    }

    const updateData = {
      payoutMethod: method,
      payoutDetails: {
        method,
        upiId:         method === 'upi' ? upiId.trim() : null,
        accountName:   method === 'bank' ? accountName.trim() : null,
        accountNumber: method === 'bank' ? accountNumber.trim() : null,
        ifsc:          method === 'bank' ? ifsc.trim().toUpperCase() : null,
        bankName:      method === 'bank' ? (bankName?.trim() || null) : null
      }
    };

    await User.findByIdAndUpdate(req.user._id, updateData);

    res.json({ success: true, message: 'Payout details saved successfully!' });
  } catch (err) {
    console.error('[savePayoutDetails]', err);
    res.status(500).json({ success: false, message: 'Failed to save details' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN: GET /admin/payments
// ─────────────────────────────────────────────────────────────────────────────
exports.getAdminPayments = async (req, res) => {
  try {
    const { status } = req.query;
    const query      = status ? { status } : {};

    const payments = await Payment.find(query)
      .populate('project',    'title status')
      .populate('client',     'name email')
      .populate('freelancer', 'name email payoutMethod payoutDetails')
      .populate('releasedBy', 'name')
      .sort({ createdAt: -1 })
      .lean();

    // Aggregate stats
    const [agg] = await Payment.aggregate([{
      $group: {
        _id:             null,
        totalCollected:  { $sum: { $cond: [{ $in: ['$status', ['paid','released','completed']] }, '$totalAmount',      0] } },
        totalFees:       { $sum: { $cond: [{ $in: ['$status', ['paid','released','completed']] }, '$platformFee',      0] } },
        totalPaid:       { $sum: { $cond: [{ $eq:  ['$status', 'completed']                   }, '$freelancerAmount', 0] } },
        pendingPayout:   { $sum: { $cond: [{ $eq:  ['$status', 'paid']                        }, '$freelancerAmount', 0] } }
      }
    }]);

    const summary = agg || { totalCollected:0, totalFees:0, totalPaid:0, pendingPayout:0 };

    res.render('payment/admin-payments', {
      title:   'Payment Management - FreelanceHub',
      payments,
      summary,
      filters: req.query
    });
  } catch (err) {
    console.error('[getAdminPayments]', err);
    req.flash('error', 'Failed to load payments');
    res.redirect('/admin/dashboard');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN: POST /admin/payments/:id/release
// Admin clicks "Release" after transferring money manually in Razorpay dashboard
// ─────────────────────────────────────────────────────────────────────────────
exports.releasePayment = async (req, res) => {
  try {
    const { note } = req.body;

    const payment = await Payment.findById(req.params.id)
      .populate('project',    'title')
      .populate('freelancer', 'name _id');

    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });
    if (payment.status !== 'paid') {
      return res.status(400).json({ success: false, message: `Cannot release — current status: ${payment.status}` });
    }

    payment.status      = 'released';
    payment.releasedBy  = req.user._id;
    payment.releasedAt  = new Date();
    payment.adminNote   = note || '';
    await payment.save();

    // Notify freelancer
    await pushNotif(
      payment.freelancer._id, req.user._id, 'payment',
      `Your payment of ₹${payment.freelancerAmount.toLocaleString('en-IN')} for "${payment.project.title}" has been released! Transfer is being processed to your registered account. ${note ? 'Note: ' + note : ''}`,
      '/payments/freelancer'
    );

    res.json({ success: true, message: 'Payment released. Freelancer notified.' });
  } catch (err) {
    console.error('[releasePayment]', err);
    res.status(500).json({ success: false, message: 'Failed to release payment' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN: POST /admin/payments/:id/complete
// Admin confirms money has been sent (after manual Razorpay dashboard transfer)
// ─────────────────────────────────────────────────────────────────────────────
exports.completePayment = async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id)
      .populate('project',    'title')
      .populate('freelancer', 'name _id');

    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });
    if (payment.status !== 'released') {
      return res.status(400).json({ success: false, message: `Cannot complete — current status: ${payment.status}` });
    }

    payment.status      = 'completed';
    payment.completedAt = new Date();
    await payment.save();

    // Update freelancer stats
    await User.findByIdAndUpdate(payment.freelancer._id, {
      $inc: { totalEarnings: payment.freelancerAmount, completedProjects: 1 }
    });

    // Notify freelancer
    await pushNotif(
      payment.freelancer._id, req.user._id, 'payment',
      `₹${payment.freelancerAmount.toLocaleString('en-IN')} has been successfully sent to your account for "${payment.project.title}"! 🎉`,
      '/payments/freelancer'
    );

    res.json({ success: true, message: 'Payment completed. Freelancer earnings updated.' });
  } catch (err) {
    console.error('[completePayment]', err);
    res.status(500).json({ success: false, message: 'Failed to complete payment' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// WEBHOOK: POST /payments/webhook  (Razorpay server-to-server backup)
// ─────────────────────────────────────────────────────────────────────────────
exports.handleWebhook = async (req, res) => {
  try {
    const sig   = req.headers['x-razorpay-signature'];
    const valid = rzpSvc.verifyWebhookSignature(req.body, sig);
    if (!valid) return res.status(400).json({ error: 'Invalid signature' });

    const { event, payload } = JSON.parse(req.body.toString());

    if (event === 'payment.captured') {
      await Payment.findOneAndUpdate(
        { razorpayOrderId: payload.payment.entity.order_id },
        { razorpayPaymentId: payload.payment.entity.id, status: 'paid', paidAt: new Date() }
      );
    }
    if (event === 'payment.failed') {
      await Payment.findOneAndUpdate(
        { razorpayOrderId: payload.payment.entity.order_id },
        { status: 'failed' }
      );
    }

    res.status(200).json({ status: 'ok' });
  } catch (err) {
    console.error('[webhook]', err);
    res.status(500).json({ error: 'Webhook error' });
  }
};
