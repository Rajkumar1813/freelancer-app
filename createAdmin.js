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
      if (existing.role !== 'admin') {
        existing.role = 'admin';
        existing.isVerified = true;
        await existing.save();
        console.log('✅ Existing user promoted to Admin!');
      } else {
        console.log('ℹ️  Admin already exists. Email:', ADMIN_EMAIL);
      }
      process.exit(0);
    }

    const hashed = await bcrypt.hash(ADMIN_PASSWORD, 12);
    await User.create({
      name: ADMIN_NAME,
      email: ADMIN_EMAIL,
      password: hashed,
      role: 'admin',
      isVerified: true,
      isActive: true
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