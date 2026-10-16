const Notification = require('../models/Notification');
const User = require('../models/User');

const notifCache = new Map();
const NOTIF_CACHE_TTL = 30 * 1000; // 30 seconds

let unverifiedCache = { count: 0, ts: 0 };
const UNVERIFIED_CACHE_TTL = 45 * 1000; // 45 seconds

const getCachedUnreadNotifications = async (userId) => {
  if (!userId) return 0;
  const key = userId.toString();
  const cached = notifCache.get(key);
  const now = Date.now();
  if (cached && (now - cached.ts < NOTIF_CACHE_TTL)) {
    return cached.count;
  }
  const count = await Notification.countDocuments({ recipient: userId, read: false });
  notifCache.set(key, { count, ts: now });
  return count;
};

const invalidateNotificationCache = (userId) => {
  if (!userId) {
    notifCache.clear();
  } else {
    notifCache.delete(userId.toString());
  }
};

const getCachedUnverifiedCount = async () => {
  const now = Date.now();
  if (now - unverifiedCache.ts < UNVERIFIED_CACHE_TTL) {
    return unverifiedCache.count;
  }
  const count = await User.countDocuments({
    isVerified: false, isBanned: false, role: { $ne: 'admin' }
  });
  unverifiedCache = { count, ts: now };
  return count;
};

const invalidateUnverifiedCount = () => {
  unverifiedCache.ts = 0;
};

// Periodic garbage collection for memory safety
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of notifCache.entries()) {
    if (now - val.ts > NOTIF_CACHE_TTL * 3) {
      notifCache.delete(key);
    }
  }
}, 60 * 1000).unref();

module.exports = {
  getCachedUnreadNotifications,
  invalidateNotificationCache,
  getCachedUnverifiedCount,
  invalidateUnverifiedCount
};
