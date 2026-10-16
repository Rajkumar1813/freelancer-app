/**
 * scripts/migrateAvatars.js
 *
 * One-time migration script to move existing MongoDB avatar Buffers (and project attachment Buffers)
 * to Cloudinary.
 *
 * Usage:
 *   node scripts/migrateAvatars.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Project = require('../models/Project');
const { isConfigured, uploadAvatarStream, uploadAttachmentStream } = require('../utils/cloudinary');

async function runMigration() {
  console.log('🚀 Starting Cloudinary migration...\n');

  if (!isConfigured()) {
    console.error('❌ Error: Cloudinary is not configured.');
    console.error('Please ensure the following environment variables are set in your .env:');
    console.error('  - CLOUDINARY_CLOUD_NAME');
    console.error('  - CLOUDINARY_API_KEY');
    console.error('  - CLOUDINARY_API_SECRET\n');
    process.exit(1);
  }

  if (!process.env.MONGODB_URI) {
    console.error('❌ Error: MONGODB_URI is not defined in environment variables.\n');
    process.exit(1);
  }

  try {
    console.log('📦 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB.\n');

    // ── 1. Migrate User Avatars ───────────────────────────────────────────
    const usersWithAvatars = await User.find({
      avatar: { $exists: true, $ne: null }
    }).select('_id name email avatar avatarContentType avatarUrl avatarPublicId');

    console.log(`🔍 Found ${usersWithAvatars.length} user(s) with MongoDB avatar buffers.`);

    let migratedUsersCount = 0;
    let failedUsersCount = 0;

    for (let i = 0; i < usersWithAvatars.length; i++) {
      const user = usersWithAvatars[i];
      try {
        if (!user.avatar || user.avatar.length === 0) {
          user.avatar = undefined;
          user.avatarContentType = undefined;
          await user.save();
          continue;
        }

        process.stdout.write(`  [${i + 1}/${usersWithAvatars.length}] Uploading avatar for "${user.name}" (${user.email})... `);
        const result = await uploadAvatarStream(user.avatar, user._id);

        user.avatarUrl = result.secure_url;
        user.avatarPublicId = result.public_id;
        user.avatar = undefined;
        user.avatarContentType = undefined;
        await user.save();

        migratedUsersCount++;
        console.log(`✅ Done -> ${result.secure_url}`);
      } catch (err) {
        failedUsersCount++;
        console.log(`❌ Failed: ${err.message}`);
      }
    }

    console.log(`\n✨ Avatar migration complete: ${migratedUsersCount} migrated, ${failedUsersCount} failed.\n`);

    // ── 2. Migrate Project Attachments ────────────────────────────────────
    const projectsWithAttachments = await Project.find({
      'attachments.data': { $exists: true, $ne: null }
    });

    console.log(`🔍 Found ${projectsWithAttachments.length} project(s) with attachment buffers.`);

    let migratedAttCount = 0;
    let failedAttCount = 0;

    for (let i = 0; i < projectsWithAttachments.length; i++) {
      const project = projectsWithAttachments[i];
      let updated = false;

      for (const att of project.attachments) {
        if (att.data && att.data.length > 0 && !att.url) {
          try {
            process.stdout.write(`  Uploading attachment "${att.filename}" for project "${project.title}"... `);
            const result = await uploadAttachmentStream(att.data, att.filename);
            att.url = result.secure_url;
            att.publicId = result.public_id;
            att.size = att.data.length;
            att.data = undefined;
            updated = true;
            migratedAttCount++;
            console.log(`✅ Done -> ${result.secure_url}`);
          } catch (err) {
            failedAttCount++;
            console.log(`❌ Failed: ${err.message}`);
          }
        } else if (att.data) {
          att.data = undefined;
          updated = true;
        }
      }

      if (updated) {
        await project.save();
      }
    }

    console.log(`\n✨ Attachments migration complete: ${migratedAttCount} migrated, ${failedAttCount} failed.\n`);

    console.log('🎉 All migrations finished successfully!');
  } catch (err) {
    console.error('❌ Migration failed with fatal error:', err);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB.');
    process.exit(0);
  }
}

if (require.main === module) {
  runMigration();
}

module.exports = { runMigration };
