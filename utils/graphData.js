const mongoose = require('mongoose');
const Project = require('../models/Project');
const User = require('../models/User');
const Proposal = require('../models/Proposal');
const Payment = require('../models/Payment');

const getGraphData = async (role, userId) => {
  const now = new Date();
  const monthKeys = [];
  const labels = [];

  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    monthKeys.push(`${yyyy}-${mm}`);
    labels.push(d.toLocaleString('default', { month: 'short', year: '2-digit' }));
  }

  const startDate = new Date(now.getFullYear(), now.getMonth() - 5, 1, 0, 0, 0, 0);
  const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  if (role === 'admin') {
    const [projectRes, revenueRes, userRes] = await Promise.all([
      Project.aggregate([
        { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }, count: { $sum: 1 } } }
      ]),
      Project.aggregate([
        {
          $match: {
            status: 'completed',
            $or: [
              { completedAt: { $gte: startDate, $lte: endDate } },
              { updatedAt: { $gte: startDate, $lte: endDate } }
            ]
          }
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m',
                date: { $ifNull: ['$completedAt', '$updatedAt'] }
              }
            },
            total: { $sum: { $ifNull: ['$amountPaid', { $ifNull: ['$budget', 0] }] } }
          }
        }
      ]),
      User.aggregate([
        { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }, count: { $sum: 1 } } }
      ])
    ]);

    const projectMap = Object.fromEntries(projectRes.map(r => [r._id, r.count]));
    const revenueMap = Object.fromEntries(revenueRes.map(r => [r._id, r.total]));
    const userMap = Object.fromEntries(userRes.map(r => [r._id, r.count]));

    const projectData = monthKeys.map(k => projectMap[k] || 0);
    const revenueData = monthKeys.map(k => revenueMap[k] || 0);
    const userGrowth = monthKeys.map(k => userMap[k] || 0);

    return { labels, projectData, revenueData, userGrowth, role: 'admin' };

  } else if (role === 'client') {
    const clientObjId = new mongoose.Types.ObjectId(userId);

    const [projectRes, spentRes] = await Promise.all([
      Project.aggregate([
        { $match: { client: clientObjId, createdAt: { $gte: startDate, $lte: endDate } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }, count: { $sum: 1 } } }
      ]),
      Project.aggregate([
        {
          $match: {
            client: clientObjId,
            status: 'completed',
            $or: [
              { completedAt: { $gte: startDate, $lte: endDate } },
              { updatedAt: { $gte: startDate, $lte: endDate } }
            ]
          }
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m',
                date: { $ifNull: ['$completedAt', '$updatedAt'] }
              }
            },
            total: { $sum: { $ifNull: ['$amountPaid', { $ifNull: ['$budget', 0] }] } }
          }
        }
      ])
    ]);

    const projectMap = Object.fromEntries(projectRes.map(r => [r._id, r.count]));
    const spentMap = Object.fromEntries(spentRes.map(r => [r._id, r.total]));

    const projectData = monthKeys.map(k => projectMap[k] || 0);
    const revenueData = monthKeys.map(k => spentMap[k] || 0);

    return { labels, projectData, revenueData, role: 'client' };

  } else if (role === 'freelancer') {
    const flObjId = new mongoose.Types.ObjectId(userId);

    const [propRes, earningsRes, paymentRes] = await Promise.all([
      Proposal.aggregate([
        {
          $match: {
            freelancer: flObjId,
            status: 'accepted',
            createdAt: { $gte: startDate, $lte: endDate }
          }
        },
        { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }, count: { $sum: 1 } } }
      ]),
      Project.aggregate([
        {
          $match: {
            hiredFreelancer: flObjId,
            status: 'completed',
            $or: [
              { completedAt: { $gte: startDate, $lte: endDate } },
              { updatedAt: { $gte: startDate, $lte: endDate } }
            ]
          }
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m',
                date: { $ifNull: ['$completedAt', '$updatedAt'] }
              }
            },
            total: { $sum: { $ifNull: ['$amountPaid', { $ifNull: ['$budget', 0] }] } }
          }
        }
      ]),
      Payment.aggregate([
        {
          $match: {
            freelancer: flObjId,
            status: { $in: ['released', 'completed', 'paid'] },
            createdAt: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
            total: { $sum: { $ifNull: ['$freelancerAmount', { $ifNull: ['$totalAmount', 0] }] } }
          }
        }
      ])
    ]);

    const propMap = Object.fromEntries(propRes.map(r => [r._id, r.count]));
    const earnMap = Object.fromEntries(earningsRes.map(r => [r._id, r.total]));
    const payMap = Object.fromEntries(paymentRes.map(r => [r._id, r.total]));

    const projectData = monthKeys.map(k => propMap[k] || 0);
    const revenueData = monthKeys.map(k => {
      const pEarn = earnMap[k] || 0;
      return pEarn > 0 ? pEarn : (payMap[k] || 0);
    });

    return { labels, projectData, revenueData, role: 'freelancer' };
  }
};

module.exports = { getGraphData };