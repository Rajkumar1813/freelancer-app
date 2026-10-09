const mongoose = require('mongoose');

const proposalSchema = new mongoose.Schema({
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  freelancer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  
  coverLetter: { type: String, required: true, maxlength: 2000 },
  bidAmount: { type: Number, required: true },
  deliveryTime: { type: Number, required: true }, // in days
  
  status: { 
    type: String, 
    enum: ['pending', 'accepted', 'rejected', 'withdrawn'], 
    default: 'pending' 
  },
  
  // If client messages freelancer directly about this project
  targetProject: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' }
  
}, { timestamps: true });

// One proposal per freelancer per project
proposalSchema.index({ project: 1, freelancer: 1 }, { unique: true });
proposalSchema.index({ freelancer: 1, status: 1 });
proposalSchema.index({ project: 1, status: 1 });

module.exports = mongoose.model('Proposal', proposalSchema);