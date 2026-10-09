const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, required: true },
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  
  // Budget
  budget: { type: Number, required: true },
  budgetType: { type: String, enum: ['fixed', 'hourly'], default: 'fixed' },
  
  // Skills required
  skills: [{ type: String }],
  
  // Category
  category: { type: String, required: true },
  
  // Status
  status: { 
    type: String, 
    enum: ['open', 'in_progress', 'completed', 'cancelled', 'on_hold'], 
    default: 'open' 
  },
  
  // Hired freelancer
  hiredFreelancer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  
  // Deadline
  deadline: { type: Date },
  
  // Attachments (stored as buffers in MongoDB)
  attachments: [{
    filename: String,
    data: Buffer,
    contentType: String
  }],
  
  // Visibility
  isPublic: { type: Boolean, default: true },
  
  // Proposals count
  proposalCount: { type: Number, default: 0 },
  
  // Completion
  completedAt: { type: Date },
  
  // Amount paid (after completion)
  amountPaid: { type: Number, default: 0 },
  
  // Priority
  priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' }
  
}, { timestamps: true });

// Text index for search
projectSchema.index({ title: 'text', description: 'text', skills: 'text' });
projectSchema.index({ client: 1, status: 1 });
projectSchema.index({ hiredFreelancer: 1, status: 1 });
projectSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Project', projectSchema);