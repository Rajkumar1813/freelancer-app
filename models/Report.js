const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  freelancer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  
  date: { type: Date, default: Date.now },
  hoursWorked: { type: Number, required: true },
  tasksCompleted: [{ type: String }],
  tasksPlanned: [{ type: String }],
  blockers: { type: String },
  progressPercentage: { type: Number, min: 0, max: 100 },
  notes: { type: String },
  
  // Client acknowledgement
  clientSeen: { type: Boolean, default: false }
}, { timestamps: true });

reportSchema.index({ project: 1, createdAt: -1 });
reportSchema.index({ freelancer: 1, createdAt: -1 });

module.exports = mongoose.model('Report', reportSchema);