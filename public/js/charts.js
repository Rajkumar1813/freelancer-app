// ===== ENHANCED REALTIME CHART SYSTEM =====
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
    tooltipBorder: isDark ? '#2d2d4e' : '#e2e8f0',
    primaryColor: '#6c63ff',
    primaryFill: isDark ? 'rgba(108, 99, 255, 0.25)' : 'rgba(108, 99, 255, 0.12)',
    successColor: '#22c55e',
    successFill: isDark ? 'rgba(34, 197, 94, 0.25)' : 'rgba(34, 197, 94, 0.12)',
    infoColor: '#3b82f6',
    infoFill: isDark ? 'rgba(59, 130, 246, 0.25)' : 'rgba(59, 130, 246, 0.12)'
  };
}

// Format numbers into Indian localized currency or clean standard format
function formatNumber(num) {
  return Number(num || 0).toLocaleString('en-IN');
}

function formatCurrency(num) {
  return '₹' + formatNumber(num);
}

// Updates or injects a summary line & empty state inside the parent chart card
function updateCardSummary(canvasId, totalValue, isCurrency, unitName) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const card = canvas.closest('.chart-card');
  if (!card) return;

  // 1. Summary line
  let sumEl = card.querySelector('.chart-summary-line');
  if (!sumEl) {
    sumEl = document.createElement('div');
    sumEl.className = 'chart-summary-line';
    const header = card.querySelector('.chart-header');
    if (header) {
      header.insertAdjacentElement('afterend', sumEl);
    } else {
      card.prepend(sumEl);
    }
  }

  const formattedVal = isCurrency ? formatCurrency(totalValue) : formatNumber(totalValue);
  const labelSuffix = isCurrency ? '' : ` ${unitName || ''}`;
  sumEl.innerHTML = `<span>Total Period Activity:</span> <span class="chart-summary-val">${formattedVal}${labelSuffix}</span>`;

  // 2. Wrap canvas if needed
  let wrap = canvas.parentElement;
  if (!wrap.classList.contains('chart-canvas-wrap')) {
    wrap = document.createElement('div');
    wrap.className = 'chart-canvas-wrap';
    canvas.parentNode.insertBefore(wrap, canvas);
    wrap.appendChild(canvas);
  }

  // 3. Empty notice overlay
  let emptyNotice = wrap.querySelector('.chart-empty-notice');
  if (totalValue === 0) {
    if (!emptyNotice) {
      emptyNotice = document.createElement('div');
      emptyNotice.className = 'chart-empty-notice';
      emptyNotice.innerHTML = '<i class="fas fa-chart-line"></i><span>No activity recorded in this 6-month period</span><small style="opacity:0.7">Details will update automatically as projects progress</small>';
      wrap.appendChild(emptyNotice);
    }
    emptyNotice.style.display = 'flex';
  } else if (emptyNotice) {
    emptyNotice.style.display = 'none';
  }
}

function initCharts(data) {
  if (typeof Chart === 'undefined') return;
  if (!data) return;

  const colors = getChartThemeColors();

  const labels = (data.labels && data.labels.length) ? data.labels : ['M-5', 'M-4', 'M-3', 'M-2', 'M-1', 'Now'];
  const projectData = (data.projectData && data.projectData.length) ? data.projectData.map(Number) : new Array(labels.length).fill(0);
  const revenueData = (data.revenueData && data.revenueData.length) ? data.revenueData.map(Number) : new Array(labels.length).fill(0);
  const userGrowth  = (data.userGrowth && data.userGrowth.length) ? data.userGrowth.map(Number) : new Array(labels.length).fill(0);

  const totalProjects = projectData.reduce((a, b) => a + b, 0);
  const totalRevenue  = revenueData.reduce((a, b) => a + b, 0);
  const totalUsers    = userGrowth.reduce((a, b) => a + b, 0);

  // Common Tooltip & Scale Settings
  const createCommonOptions = (isCurrency, unitLabel, suggestedMax) => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index',
      intersect: false
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: colors.tooltipBg,
        titleColor: colors.tooltipText,
        bodyColor: colors.tooltipText,
        borderColor: colors.tooltipBorder,
        borderWidth: 1,
        padding: 12,
        boxPadding: 6,
        usePointStyle: true,
        callbacks: {
          label: function (ctx) {
            const raw = ctx.parsed.y ?? ctx.raw ?? 0;
            const prefix = isCurrency ? '₹' : '';
            const suffix = !isCurrency && unitLabel ? ' ' + unitLabel : '';
            return `${ctx.dataset.label || 'Value'}: ${prefix}${formatNumber(raw)}${suffix}`;
          }
        }
      }
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: colors.textColor, font: { size: 11, family: 'inherit', weight: 500 } }
      },
      y: {
        beginAtZero: true,
        suggestedMin: 0,
        suggestedMax: suggestedMax || 5,
        grid: { color: colors.gridColor },
        ticks: {
          color: colors.textColor,
          font: { size: 11, family: 'inherit' },
          precision: isCurrency ? undefined : 0,
          callback: function (val) {
            if (isCurrency) {
              if (val >= 100000) return '₹' + (val / 1000) + 'k';
              return '₹' + formatNumber(val);
            }
            return Number.isInteger(val) ? val : '';
          }
        }
      }
    },
    animation: { duration: 600, easing: 'easeInOutQuart' }
  });

  // 1. Project Chart
  const pCanvas = document.getElementById('projectChart');
  if (pCanvas) {
    if (projectChart) {
      try { projectChart.destroy(); } catch (_) {}
    }
    const role = data.role || (typeof USER_ROLE !== 'undefined' ? USER_ROLE : 'client');
    const labelTitle = role === 'admin' ? 'New Projects' : role === 'client' ? 'Projects Posted' : 'Projects Won';
    const unitTitle = role === 'freelancer' ? 'projects won' : 'projects';

    const maxProjVal = Math.max(...projectData, 0);
    const suggestedProjMax = Math.max(5, Math.ceil((maxProjVal + 1) * 1.2));

    projectChart = new Chart(pCanvas, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: labelTitle,
          data: projectData,
          backgroundColor: colors.primaryColor,
          hoverBackgroundColor: '#584de8',
          borderRadius: 6,
          borderSkipped: false,
          maxBarThickness: 38
        }]
      },
      options: createCommonOptions(false, unitTitle, suggestedProjMax)
    });

    updateCardSummary('projectChart', totalProjects, false, unitTitle);
  }

  // 2. Revenue / Spending / Earnings Chart
  const rCanvas = document.getElementById('revenueChart');
  if (rCanvas) {
    if (revenueChart) {
      try { revenueChart.destroy(); } catch (_) {}
    }
    const role = data.role || (typeof USER_ROLE !== 'undefined' ? USER_ROLE : 'client');
    const revLabel = role === 'client' ? 'Amount Spent' : role === 'freelancer' ? 'Earnings' : 'Platform Revenue';

    const maxRevVal = Math.max(...revenueData, 0);
    const suggestedRevMax = Math.max(1000, Math.ceil((maxRevVal + 500) * 1.15));

    revenueChart = new Chart(rCanvas, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: revLabel,
          data: revenueData,
          borderColor: colors.successColor,
          backgroundColor: colors.successFill,
          fill: true,
          tension: 0.35,
          pointBackgroundColor: colors.successColor,
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2,
          pointRadius: 5,
          pointHoverRadius: 8,
          pointHitRadius: 25
        }]
      },
      options: createCommonOptions(true, '', suggestedRevMax)
    });

    updateCardSummary('revenueChart', totalRevenue, true);
  }

  // 3. User Growth Chart (Admin only)
  const uCanvas = document.getElementById('userChart');
  if (uCanvas) {
    if (userChart) {
      try { userChart.destroy(); } catch (_) {}
    }
    const maxUserVal = Math.max(...userGrowth, 0);
    const suggestedUserMax = Math.max(5, Math.ceil((maxUserVal + 1) * 1.2));

    userChart = new Chart(uCanvas, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'New Users',
          data: userGrowth,
          borderColor: colors.infoColor,
          backgroundColor: colors.infoFill,
          fill: true,
          tension: 0.35,
          pointBackgroundColor: colors.infoColor,
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2,
          pointRadius: 5,
          pointHoverRadius: 8,
          pointHitRadius: 25
        }]
      },
      options: createCommonOptions(false, 'users', suggestedUserMax)
    });

    updateCardSummary('userChart', totalUsers, false, 'users');
  }
}

function updateChartsData(data) {
  if (!data || !data.labels) return;

  // Guard against cross-role data leaks
  if (data.role && typeof USER_ROLE !== 'undefined' && data.role !== USER_ROLE) {
    return;
  }

  // If charts haven't been created yet, initialize now
  if (!projectChart && !revenueChart && !userChart) {
    initCharts(data);
    return;
  }

  const role = data.role || (typeof USER_ROLE !== 'undefined' ? USER_ROLE : 'client');

  if (projectChart && data.projectData) {
    const pData = data.projectData.map(Number);
    const totP = pData.reduce((a, b) => a + b, 0);
    projectChart.data.labels = data.labels;
    projectChart.data.datasets[0].data = pData;
    projectChart.options.scales.y.suggestedMax = Math.max(5, Math.ceil((Math.max(...pData, 0) + 1) * 1.2));
    projectChart.update('active');
    updateCardSummary('projectChart', totP, false, role === 'freelancer' ? 'projects won' : 'projects');
  }

  if (revenueChart && data.revenueData) {
    const rData = data.revenueData.map(Number);
    const totR = rData.reduce((a, b) => a + b, 0);
    revenueChart.data.labels = data.labels;
    revenueChart.data.datasets[0].data = rData;
    revenueChart.options.scales.y.suggestedMax = Math.max(1000, Math.ceil((Math.max(...rData, 0) + 500) * 1.15));
    revenueChart.update('active');
    updateCardSummary('revenueChart', totR, true);
  }

  if (userChart && data.userGrowth) {
    const uData = data.userGrowth.map(Number);
    const totU = uData.reduce((a, b) => a + b, 0);
    userChart.data.labels = data.labels;
    userChart.data.datasets[0].data = uData;
    userChart.options.scales.y.suggestedMax = Math.max(5, Math.ceil((Math.max(...uData, 0) + 1) * 1.2));
    userChart.update('active');
    updateCardSummary('userChart', totU, false, 'users');
  }
}

// Bulletproof startup: handles script order & asynchronous loading
let initAttempts = 0;
function startCharts() {
  if (typeof Chart === 'undefined') {
    if (initAttempts < 35) {
      initAttempts++;
      setTimeout(startCharts, 100);
    }
    return;
  }

  if (typeof GRAPH_DATA !== 'undefined' && GRAPH_DATA) {
    initCharts(GRAPH_DATA);
  }

  // Auto-refresh periodically via API (120 seconds)
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

// Theme switch listener: dynamically refresh chart styling when user toggles dark/light mode
const themeObserver = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
      if (typeof GRAPH_DATA !== 'undefined' && GRAPH_DATA) {
        initCharts(GRAPH_DATA);
      }
    }
  });
});
themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

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
      if (USER_ROLE === 'admin') {
        socket.emit('joinAdmin');
      }
    }
  });

  socket.on('disconnect', () => {
    document.querySelectorAll('.live-dot').forEach(d => {
      d.style.background = '#f59e0b';
    });
  });

  socket.on('graphUpdate', (data) => {
    if (!data) return;
    if (data.role && typeof USER_ROLE !== 'undefined' && data.role !== USER_ROLE) {
      return; // Ignore other roles' data
    }
    if (data.refresh) {
      triggerGraphFetch();
    } else if (data.labels) {
      updateChartsData(data);
    }
  });
}