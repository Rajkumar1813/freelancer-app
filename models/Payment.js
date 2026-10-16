const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  // ── Core refs ──────────────────────────────────────────────────────────────
  project:    { type: mongoose.Schema.Types.ObjectId, ref: 'Project',  required: true },
  client:     { type: mongoose.Schema.Types.ObjectId, ref: 'User',     required: true },
  freelancer: { type: mongoose.Schema.Types.ObjectId, ref: 'User',     required: true },

  // ── Amounts (INR ₹) ────────────────────────────────────────────────────────
  totalAmount:      { type: Number, required: true }, // Full project budget
  platformFee:      { type: Number, required: true }, // 10% admin commission
  freelancerAmount: { type: Number, required: true }, // 90% to freelancer

  // ── Razorpay collection (client → platform) ────────────────────────────────
  razorpayOrderId:   { type: String, unique: true, sparse: true },
  razorpayPaymentId: { type: String, unique: true, sparse: true },
  razorpaySignature: { type: String },
  razorpayMode:      { type: String, enum: ['test', 'live'], default: 'test' },

  // ── Payment lifecycle ──────────────────────────────────────────────────────
  // pending      → Razorpay order created, client hasn't paid yet
  // paid         → Client paid, money with platform (escrow)
  // released     → Admin approved, marked as transferred
  // completed    → Admin confirmed money sent to freelancer
  // refunded     → Refunded to client
  // failed       → Payment failed
  status: {
    type:    String,
    enum:    ['pending', 'paid', 'released', 'completed', 'refunded', 'failed'],
    default: 'pending'
  },

  // ── Admin payout tracking ──────────────────────────────────────────────────
  adminNote:          { type: String },          // Admin note when releasing
  releasedBy:         { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  releasedAt:         { type: Date },
  completedAt:        { type: Date },

  // ── Freelancer payout details (snapshot at time of payout) ────────────────
  payoutSnapshot: {
    method:        { type: String },  // 'upi' | 'bank'
    upiId:         { type: String },
    accountName:   { type: String },
    accountNumber: { type: String },
    ifsc:          { type: String },
    bankName:      { type: String }
  },

  // ── Timestamps ─────────────────────────────────────────────────────────────
  paidAt: { type: Date }

}, { timestamps: true });

paymentSchema.index({ project:    1 });
paymentSchema.index({ client:     1 });
paymentSchema.index({ freelancer: 1, status: 1 });
paymentSchema.index({ freelancer: 1, createdAt: -1 });
paymentSchema.index({ status:     1, createdAt: -1 });
paymentSchema.index({ createdAt:  -1 });

module.exports = mongoose.model('Payment', paymentSchema);
