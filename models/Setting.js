const mongoose = require('mongoose');

const settingSchema = new mongoose.Schema({
  // General Platform Info
  platformName:   { type: String, default: 'FreelanceHub', trim: true },
  tagline:        { type: String, default: 'Connect. Create. Collaborate.', trim: true },
  supportEmail:   { type: String, default: 'support@freelancehub.com', trim: true },
  platformUrl:    { type: String, default: process.env.APP_URL || 'http://localhost:3000', trim: true },

  // Commission Settings
  commissionRate: { type: Number, default: 10, min: 0, max: 100 },
  minBudget:      { type: Number, default: 500, min: 0 },
  maxBudget:      { type: Number, default: 5000000, min: 0 },

  // Email Configuration
  smtpHost:       { type: String, default: process.env.EMAIL_HOST || 'smtp.gmail.com', trim: true },
  smtpPort:       { type: Number, default: Number(process.env.EMAIL_PORT) || 587 },
  fromEmail:      { type: String, default: process.env.EMAIL_USER || 'noreply@freelancehub.com', trim: true },
  fromName:       { type: String, default: 'FreelanceHub', trim: true },
  otpExpiry:      { type: Number, default: 10, min: 1, max: 60 },

  // Email Notification Toggles
  emailNotifs: {
    newRegistration:  { type: Boolean, default: true },
    newProposal:      { type: Boolean, default: true },
    projectCompleted: { type: Boolean, default: true },
    dailyReports:     { type: Boolean, default: false }
  },

  // Security Settings
  security: {
    requireEmailVerification: { type: Boolean, default: true },
    allowGoogleOAuth:         { type: Boolean, default: true },
    autoBanOnReports:         { type: Boolean, default: true },
    sessionDays:              { type: Number, default: 7, min: 1, max: 90 },
    jwtExpiry:                { type: Number, default: 7, min: 1, max: 90 },
    maxLoginAttempts:         { type: Number, default: 5, min: 1, max: 20 }
  },

  // In-App Notification Toggles
  inAppNotifs: {
    newMessage:           { type: Boolean, default: true },
    newProposal:          { type: Boolean, default: true },
    hiredNotification:    { type: Boolean, default: true },
    dailyReportSubmitted: { type: Boolean, default: true },
    paymentNotifications: { type: Boolean, default: true }
  },

  // Platform Features & Limits
  platformFeatures: {
    allowNewRegistrations: { type: Boolean, default: true },
    maintenanceMode:       { type: Boolean, default: false },
    realtimeGraphs:        { type: Boolean, default: true },
    profilePrivacy:        { type: Boolean, default: true },
    maxProjects:           { type: Number, default: 20, min: 1 },
    maxSkills:             { type: Number, default: 20, min: 1 }
  }
}, { timestamps: true });

settingSchema.statics.getSettings = async function () {
  let doc = await this.findOne();
  if (!doc) {
    doc = await this.create({});
  }
  return doc;
};

module.exports = mongoose.model('Setting', settingSchema);
