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
    const [projectRes, revenueRes, paymentRes, userRes] = await Promise.all([
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
      Payment.aggregate([
        {
          $match: {
            status: { $in: ['released', 'completed', 'paid'] },
            createdAt: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
            total: { $sum: { $ifNull: ['$totalAmount', 0] } }
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
    const payMap     = Object.fromEntries(paymentRes.map(r => [r._id, r.total]));
    const userMap    = Object.fromEntries(userRes.map(r => [r._id, r.count]));

    const projectData = monthKeys.map(k => projectMap[k] || 0);
    const revenueData = monthKeys.map(k => Math.max(revenueMap[k] || 0, payMap[k] || 0));
    const userGrowth  = monthKeys.map(k => userMap[k] || 0);

    const totalProjects = projectData.reduce((a, b) => a + b, 0);
    const totalRevenue  = revenueData.reduce((a, b) => a + b, 0);
    const totalUsers    = userGrowth.reduce((a, b) => a + b, 0);
    const hasData       = totalProjects > 0 || totalRevenue > 0 || totalUsers > 0;

    return {
      labels,
      projectData,
      revenueData,
      userGrowth,
      role: 'admin',
      summary: {
        totalProjects,
        totalRevenue,
        totalUsers,
        hasData,
        currencySymbol: '₹'
      }
    };

  } else if (role === 'client') {
    let clientObjId;
    try {
      clientObjId = new mongoose.Types.ObjectId(userId);
    } catch (_) {
      clientObjId = userId;
    }

    const [projectRes, spentRes, paySpentRes] = await Promise.all([
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
      ]),
      Payment.aggregate([
        {
          $match: {
            client: clientObjId,
            status: { $in: ['paid', 'released', 'completed'] },
            createdAt: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
            total: { $sum: { $ifNull: ['$totalAmount', 0] } }
          }
        }
      ])
    ]);

    const projectMap  = Object.fromEntries(projectRes.map(r => [r._id, r.count]));
    const spentMap    = Object.fromEntries(spentRes.map(r => [r._id, r.total]));
    const paySpentMap = Object.fromEntries(paySpentRes.map(r => [r._id, r.total]));

    const projectData = monthKeys.map(k => projectMap[k] || 0);
    const revenueData = monthKeys.map(k => Math.max(spentMap[k] || 0, paySpentMap[k] || 0));

    const totalProjects = projectData.reduce((a, b) => a + b, 0);
    const totalSpent    = revenueData.reduce((a, b) => a + b, 0);
    const hasData       = totalProjects > 0 || totalSpent > 0;

    return {
      labels,
      projectData,
      revenueData,
      role: 'client',
      summary: {
        totalProjects,
        totalRevenue: totalSpent,
        hasData,
        currencySymbol: '₹'
      }
    };

  } else if (role === 'freelancer') {
    let flObjId;
    try {
      flObjId = new mongoose.Types.ObjectId(userId);
    } catch (_) {
      flObjId = userId;
    }

    const [propRes, hiredRes, earningsRes, paymentRes] = await Promise.all([
      Proposal.aggregate([
        {
          $match: {
            freelancer: flObjId,
            status: 'accepted',
            $or: [
              { updatedAt: { $gte: startDate, $lte: endDate } },
              { createdAt: { $gte: startDate, $lte: endDate } }
            ]
          }
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m',
                date: { $ifNull: ['$updatedAt', '$createdAt'] }
              }
            },
            count: { $sum: 1 }
          }
        }
      ]),
      Project.aggregate([
        {
          $match: {
            hiredFreelancer: flObjId,
            status: { $in: ['in_progress', 'completed'] },
            $or: [
              { updatedAt: { $gte: startDate, $lte: endDate } },
              { createdAt: { $gte: startDate, $lte: endDate } }
            ]
          }
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m',
                date: { $ifNull: ['$updatedAt', '$createdAt'] }
              }
            },
            count: { $sum: 1 }
          }
        }
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

    const propMap  = Object.fromEntries(propRes.map(r => [r._id, r.count]));
    const hiredMap = Object.fromEntries(hiredRes.map(r => [r._id, r.count]));
    const earnMap  = Object.fromEntries(earningsRes.map(r => [r._id, r.total]));
    const payMap   = Object.fromEntries(paymentRes.map(r => [r._id, r.total]));

    const projectData = monthKeys.map(k => Math.max(propMap[k] || 0, hiredMap[k] || 0));
    const revenueData = monthKeys.map(k => Math.max(earnMap[k] || 0, payMap[k] || 0));

    const totalProjectsWon = projectData.reduce((a, b) => a + b, 0);
    const totalEarnings    = revenueData.reduce((a, b) => a + b, 0);
    const hasData          = totalProjectsWon > 0 || totalEarnings > 0;

    return {
      labels,
      projectData,
      revenueData,
      role: 'freelancer',
      summary: {
        totalProjects: totalProjectsWon,
        totalRevenue: totalEarnings,
        hasData,
        currencySymbol: '₹'
      }
    };
  }
};

module.exports = { getGraphData };