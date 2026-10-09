const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  type: { 
    type: String, 
    enum: ['message', 'proposal', 'hired', 'project_update', 'report', 'review', 'system', 'payment'],
    required: true 
  },
  message: { type: String, required: true },
  link: { type: String },
  read: { type: Boolean, default: false }
}, { timestamps: true });

notificationSchema.index({ recipient: 1, read: 1 });
notificationSchema.index({ recipient: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);