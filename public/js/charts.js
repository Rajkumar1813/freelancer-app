// ===== REALTIME CHART SYSTEM =====
let projectChart, revenueChart, userChart;
let graphRefreshInterval;

function getChartThemeColors() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  return {
    isDark,
    textColor: isDark ? '#94a3b8' : '#64748b',
    gridColor: isDark ? '#252540' : '#f1f5f9',
    tooltipBg: isDark ? '#1e1e38' : '#ffffff',
    tooltipText: isDark ? '#f1f5f9' : '#1a1a2e',
    tooltipBorder: isDark ? '#2d2d4e' : '#e2e8f0'
  };
}

function initCharts(data) {
  if (typeof Chart === 'undefined') return;
  if (!data) return;

  const colors = getChartThemeColors();

  const labels = (data.labels && data.labels.length) ? data.labels : ['M-5', 'M-4', 'M-3', 'M-2', 'M-1', 'Now'];
  const projectData = (data.projectData && data.projectData.length) ? data.projectData : new Array(labels.length).fill(0);
  const revenueData = (data.revenueData && data.revenueData.length) ? data.revenueData : new Array(labels.length).fill(0);
  const userGrowth  = (data.userGrowth && data.userGrowth.length) ? data.userGrowth : new Array(labels.length).fill(0);

  const commonOptions = {
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: colors.tooltipBg,
        titleColor: colors.tooltipText,
        bodyColor: colors.tooltipText,
        borderColor: colors.tooltipBorder,
        borderWidth: 1,
        padding: 10,
        boxPadding: 4,
        usePointStyle: true
      }
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: colors.textColor, font: { size: 11, family: 'inherit' } }
      },
      y: {
        beginAtZero: true,
        grid: { color: colors.gridColor },
        ticks: { color: colors.textColor, font: { size: 11, family: 'inherit' } }
      }
    },
    animation: { duration: 600, easing: 'easeInOutQuart' }
  };

  // 1. Project Chart
  const pCanvas = document.getElementById('projectChart');
  if (pCanvas) {
    if (projectChart) {
      try { projectChart.destroy(); } catch (_) {}
    }
    const labelTitle = data.role === 'admin' ? 'New Projects' : data.role === 'client' ? 'Projects Posted' : 'Projects Won';
    projectChart = new Chart(pCanvas, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: labelTitle,
          data: projectData,
          backgroundColor: 'rgba(108, 99, 255, 0.85)',
          hoverBackgroundColor: 'rgba(108, 99, 255, 1)',
          borderRadius: 6,
          borderSkipped: false
        }]
      },
      options: { ...commonOptions }
    });
  }

  // 2. Revenue / Spending / Earnings Chart
  const rCanvas = document.getElementById('revenueChart');
  if (rCanvas) {
    if (revenueChart) {
      try { revenueChart.destroy(); } catch (_) {}
    }
    const revLabel = data.role === 'client' ? 'Amount Spent (₹)' : data.role === 'freelancer' ? 'Earnings (₹)' : 'Revenue (₹)';
    revenueChart = new Chart(rCanvas, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: revLabel,
          data: revenueData,
          borderColor: '#22c55e',
          backgroundColor: 'rgba(34, 197, 94, 0.12)',
          fill: true,
          tension: 0.35,
          pointBackgroundColor: '#22c55e',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 1.5,
          pointRadius: 4,
          pointHoverRadius: 6
        }]
      },
      options: { ...commonOptions }
    });
  }

  // 3. User Growth Chart (Admin only)
  const uCanvas = document.getElementById('userChart');
  if (uCanvas) {
    if (userChart) {
      try { userChart.destroy(); } catch (_) {}
    }
    userChart = new Chart(uCanvas, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'New Users',
          data: userGrowth,
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.12)',
          fill: true,
          tension: 0.35,
          pointBackgroundColor: '#3b82f6',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 1.5,
          pointRadius: 4,
          pointHoverRadius: 6
        }]
      },
      options: { ...commonOptions }
    });
  }
}

function updateChartsData(data) {
  if (!data || !data.labels) return;

  // If charts haven't been created yet (e.g. initial GRAPH_DATA wasn't ready), initialize them now
  if (!projectChart && !revenueChart && !userChart) {
    initCharts(data);
    return;
  }

  if (projectChart && data.projectData) {
    projectChart.data.labels = data.labels;
    projectChart.data.datasets[0].data = data.projectData;
    projectChart.update('active');
  }
  if (revenueChart && data.revenueData) {
    revenueChart.data.labels = data.labels;
    revenueChart.data.datasets[0].data = data.revenueData;
    revenueChart.update('active');
  }
  if (userChart && data.userGrowth) {
    userChart.data.labels = data.labels;
    userChart.data.datasets[0].data = data.userGrowth;
    userChart.update('active');
  }
}

// Bulletproof startup: handles script order & asynchronous loading
let initAttempts = 0;
function startCharts() {
  if (typeof Chart === 'undefined') {
    if (initAttempts < 25) {
      initAttempts++;
      setTimeout(startCharts, 120);
    }
    return;
  }

  if (typeof GRAPH_DATA !== 'undefined' && GRAPH_DATA) {
    initCharts(GRAPH_DATA);
  }

  // Auto-refresh periodically via API (120 seconds to prevent unnecessary server churn)
  if (typeof GRAPH_API_URL !== 'undefined' && GRAPH_API_URL && !graphRefreshInterval) {
    graphRefreshInterval = setInterval(async () => {
      try {
        const res = await fetch(GRAPH_API_URL);
        const json = await res.json();
        if (json.success && json.data) {
          updateChartsData(json.data);
        }
      } catch (e) {}
    }, 120000);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startCharts);
} else {
  startCharts();
}

// Socket-based realtime graph & activity updates
if (typeof io !== 'undefined' && typeof USER_ID !== 'undefined') {
  const socket = window._mainSocket || (window._mainSocket = io());

  function triggerGraphFetch() {
    if (typeof GRAPH_API_URL !== 'undefined') {
      fetch(GRAPH_API_URL)
        .then(r => r.json())
        .then(json => {
          if (json.success && json.data) updateChartsData(json.data);
        })
        .catch(() => {});
    }
  }

  socket.on('connect', () => {
    // Update live indicators on dashboards
    document.querySelectorAll('.live-dot').forEach(d => {
      d.style.background = '#22c55e';
    });
    if (typeof USER_ROLE !== 'undefined' && typeof USER_ID !== 'undefined') {
      socket.emit('requestGraphUpdate', { role: USER_ROLE, userId: USER_ID });
    }
  });

  socket.on('disconnect', () => {
    document.querySelectorAll('.live-dot').forEach(d => {
      d.style.background = '#f59e0b';
    });
  });

  socket.on('graphUpdate', (data) => {
    if (!data) return;
    if (data.refresh) {
      triggerGraphFetch();
    } else if (data.labels) {
      updateChartsData(data);
    }
  });
}