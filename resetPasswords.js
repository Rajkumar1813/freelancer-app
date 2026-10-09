require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');

const DEFAULT_USER_PASSWORD = 'Password@123';
const DEFAULT_ADMIN_PASSWORD = 'Admin@321';

async function resetAllCredentials() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const users = await User.find({});
    console.log(`Found ${users.length} total user records.`);

    const hashedUser = await bcrypt.hash(DEFAULT_USER_PASSWORD, 12);
    const hashedAdmin = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 12);

    const credList = [];

    for (const u of users) {
      // Fix name if empty
      if (!u.name || !u.name.trim()) {
        u.name = u.email ? u.email.split('@')[0] : 'Freelance User';
      }

      // If invalid role from other project, map to client
      if (!['admin', 'client', 'freelancer'].includes(u.role)) {
        u.role = 'client';
      }

      const isAdm = u.role === 'admin';
      u.password = isAdm ? hashedAdmin : hashedUser;
      u.isVerified = true;
      u.isBanned = false;
      u.isActive = true;
      await u.save();

      credList.push({
        role: u.role,
        name: u.name,
        email: u.email,
        password: isAdm ? DEFAULT_ADMIN_PASSWORD : DEFAULT_USER_PASSWORD,
        loginUrl: isAdm ? 'http://localhost:3000/auth/admin/login' : 'http://localhost:3000/auth/login'
      });
    }

    console.log('\n================ ALL USER CREDENTIALS ================');
    console.table(credList);
    console.log('======================================================\n');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error resetting credentials:', err.message);
    process.exit(1);
  }
}

resetAllCredentials();
