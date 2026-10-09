require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');

const ADMIN_EMAIL    = process.env.ADMIN_DEFAULT_EMAIL || process.argv[2] || 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_DEFAULT_PASSWORD || process.argv[3] || 'Admin@Secure123';
const ADMIN_NAME     = process.env.ADMIN_DEFAULT_NAME || 'Super Admin';

async function createAdmin() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB connected');

    const existing = await User.findOne({ email: ADMIN_EMAIL });
    if (existing) {
      existing.role = 'admin';
      existing.adminRole = 'super_admin';
      existing.isSuperAdmin = true;
      existing.adminApproved = true;
      existing.isVerified = true;
      existing.adminPermissions = {
        manageUsers: true,
        manageProjects: true,
        managePayments: true,
        manageUnverified: true,
        viewAnalytics: true,
        accessMessages: true,
        manageSettings: true
      };
      await existing.save();
      console.log('✅ Admin account updated with Super Admin privileges! Email:', ADMIN_EMAIL);
      process.exit(0);
    }

    const hashed = await bcrypt.hash(ADMIN_PASSWORD, 12);
    await User.create({
      name: ADMIN_NAME,
      email: ADMIN_EMAIL,
      password: hashed,
      role: 'admin',
      adminRole: 'super_admin',
      isSuperAdmin: true,
      adminApproved: true,
      isVerified: true,
      isActive: true,
      adminPermissions: {
        manageUsers: true,
        manageProjects: true,
        managePayments: true,
        manageUnverified: true,
        viewAnalytics: true,
        accessMessages: true,
        manageSettings: true
      }
    });

    console.log('');
    console.log('🎉 Admin account created successfully!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  Email   :', ADMIN_EMAIL);
    console.log('  Password:', ADMIN_PASSWORD);
    console.log('  URL     : http://localhost:3000/auth/login');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('⚠️  Login ke baad password zaroor change karo!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

createAdmin();