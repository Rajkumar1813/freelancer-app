// ===== THEME SYSTEM - FreelanceHub =====
// Place this file at: public/js/theme.js
// IMPORTANT: Include in EVERY view's <head> tag BEFORE main.css loads
// Add this line in <head>: <script src="/js/theme.js"></script>

(function () {
  'use strict';

  var STORAGE_KEY = 'fh_theme';
  var DARK  = 'dark';
  var LIGHT = 'light';

  // ── 1. Read saved preference ──────────────────────────────────────
  function getSaved() {
    try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
  }

  function save(theme) {
    try { localStorage.setItem(STORAGE_KEY, theme); } catch (e) {}
  }

  // ── 2. Get OS preference ─────────────────────────────────────────
  function getOS() {
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? DARK : LIGHT;
    } catch (e) { return LIGHT; }
  }

  // ── 3. Apply theme to <html> immediately (no flash) ───────────────
  function applyNow(theme) {
    document.documentElement.setAttribute('data-theme', theme);
  }

  // Apply ASAP — runs synchronously before any rendering
  var initial = getSaved() || getOS();
  applyNow(initial);

  // ── 4. Full apply (includes icon + chart update) ──────────────────
  function applyFull(theme) {
    applyNow(theme);
    updateIcon(theme);
    updateCharts(theme);
  }

  // ── 5. Update the toggle button icon ─────────────────────────────
  function updateIcon(theme) {
    var btn = document.getElementById('themeToggleBtn');
    if (!btn) return;
    var icon = btn.querySelector('i');
    if (!icon) return;
    if (theme === DARK) {
      icon.className = 'fas fa-sun';
      btn.setAttribute('title', 'Switch to Light Mode');
    } else {
      icon.className = 'fas fa-moon';
      btn.setAttribute('title', 'Switch to Dark Mode');
    }
  }

  // ── 6. Toggle between dark and light ─────────────────────────────
  function toggle() {
    var current = document.documentElement.getAttribute('data-theme') || LIGHT;
    var next = current === DARK ? LIGHT : DARK;
    applyFull(next);
    save(next);
  }

  // ── 7. Update Chart.js colors ────────────────────────────────────
  var isUpdatingCharts = false;
  function updateCharts(theme) {
    if (typeof Chart === 'undefined' || isUpdatingCharts) return;
    isUpdatingCharts = true;
    try {
      var isDark    = theme === DARK;
      var textColor = isDark ? '#94a3b8' : '#64748b';
      var gridColor = isDark ? '#252540' : '#f1f5f9';
      var bordColor = isDark ? '#2d2d4e' : '#e2e8f0';

      Chart.defaults.color       = textColor;
      Chart.defaults.borderColor = bordColor;

      // Update every existing chart instance
      var instances = Chart.instances;
      if (!instances) return;

      // Chart.js v4 returns an object keyed by id
      Object.keys(instances).forEach(function (key) {
        var chart = instances[key];
        if (!chart || !chart.options) return;

        var scales = chart.options.scales || {};
        ['x', 'y'].forEach(function (axis) {
          if (!scales[axis]) return;
          if (scales[axis].ticks) scales[axis].ticks.color = textColor;
          if (scales[axis].grid)  scales[axis].grid.color  = gridColor;
        });

        if (chart.options.plugins && chart.options.plugins.legend) {
          chart.options.plugins.legend.labels = chart.options.plugins.legend.labels || {};
          chart.options.plugins.legend.labels.color = textColor;
        }

        chart.update('none'); // redraw without animation
      });
    } catch (e) {
      console.warn('[theme] updateCharts error:', e);
    } finally {
      isUpdatingCharts = false;
    }
  }

  // ── 8. Attach button listener + watch OS changes ──────────────────
  function setup() {
    // Attach toggle to button
    var btn = document.getElementById('themeToggleBtn');
    if (btn) {
      // Remove any old listener by cloning (safe pattern)
      var fresh = btn.cloneNode(true);
      btn.parentNode.replaceChild(fresh, btn);
      fresh.addEventListener('click', toggle);
    }

    // Set correct icon immediately
    updateIcon(document.documentElement.getAttribute('data-theme') || initial);

    // Watch OS preference changes (only when user hasn't set manually)
    try {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
        if (!getSaved()) {
          applyFull(e.matches ? DARK : LIGHT);
        }
      });
    } catch (e) {}

    // Initialize Chart defaults if Chart is already loaded
    if (typeof Chart !== 'undefined') {
      var currentTheme = document.documentElement.getAttribute('data-theme') || initial;
      updateCharts(currentTheme);
    }
  }

  // Run setup after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }

  // ── 9. Public API (for inline scripts if needed) ──────────────────
  window.__fhTheme = {
    toggle : toggle,
    apply  : applyFull,
    get    : function () { return document.documentElement.getAttribute('data-theme') || LIGHT; }
  };

})();