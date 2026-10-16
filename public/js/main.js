// ===== USER MENU TOGGLE =====
const userMenuBtn = document.getElementById('userMenuBtn');
const userDropdown = document.getElementById('userDropdown');
if (userMenuBtn && userDropdown) {
  userMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    userDropdown.classList.toggle('open');
  });
}

// ===== NOTIFICATION DROPDOWN =====
const notifBtn = document.getElementById('notifBtn');
const notifDropdown = document.getElementById('notifDropdown');
if (notifBtn && notifDropdown) {
  notifBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    notifDropdown.classList.toggle('open');
    if (notifDropdown.classList.contains('open')) {
      await loadNotifications();
    }
  });
}

// ===== MOBILE SIDEBAR TOGGLE & BACKDROP =====
const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
const sidebar = document.querySelector('.sidebar');
const sidebarBackdrop = document.getElementById('sidebarBackdrop');
const sidebarCloseBtn = document.getElementById('sidebarCloseBtn');

function openSidebar() {
  if (sidebar) sidebar.classList.add('open');
  if (sidebarBackdrop) sidebarBackdrop.classList.add('active');
  document.body.classList.add('menu-open');
}

function closeSidebar() {
  if (sidebar) sidebar.classList.remove('open');
  if (sidebarBackdrop) sidebarBackdrop.classList.remove('active');
  document.body.classList.remove('menu-open');
}

if (sidebarToggleBtn) {
  sidebarToggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (sidebar && sidebar.classList.contains('open')) {
      closeSidebar();
    } else {
      openSidebar();
    }
  });
}

if (sidebarCloseBtn) {
  sidebarCloseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeSidebar();
  });
}

if (sidebarBackdrop) {
  sidebarBackdrop.addEventListener('click', closeSidebar);
}

if (sidebar) {
  sidebar.addEventListener('click', (e) => {
    // If a navigation link was clicked, close drawer on mobile
    if (e.target.closest('.sidebar-link') || e.target.closest('.sidebar-logout')) {
      closeSidebar();
    } else {
      e.stopPropagation();
    }
  });
}

// Close dropdowns & mobile sidebar on outside click
document.addEventListener('click', () => {
  userDropdown?.classList.remove('open');
  notifDropdown?.classList.remove('open');
  closeSidebar();
});

// Auto-dismiss flash messages after 4 seconds
document.querySelectorAll('.flash').forEach(flash => {
  setTimeout(() => {
    flash.style.transition = 'opacity 0.3s ease';
    flash.style.opacity = '0';
    setTimeout(() => flash.remove(), 300);
  }, 4000);
});

// ===== ACTIVE SIDEBAR LINK =====
const path = window.location.pathname;
document.querySelectorAll('.sidebar-link').forEach(link => {
  if (link.getAttribute('href') === path) link.classList.add('active');
});

// ===== PASSWORD TOGGLE =====
function togglePass(inputId) {
  const input = document.getElementById(inputId);
  const icon = document.getElementById(inputId + 'Icon');
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    icon && (icon.className = 'fas fa-eye-slash');
  } else {
    input.type = 'password';
    icon && (icon.className = 'fas fa-eye');
  }
}

// ===== LOAD NOTIFICATIONS IN DROPDOWN =====
async function loadNotifications() {
  const list = document.getElementById('notifList');
  if (!list) return;
  try {
    const res = await fetch('/notifications/api');
    const data = await res.json();
    if (!data.length) {
      list.innerHTML = '<div class="notif-loading">No notifications</div>';
      return;
    }
    list.innerHTML = data.map(n => `
      <div class="notif-item ${n.read ? '' : 'unread'}" onclick="${n.link ? `window.location='${n.link}'` : ''}">
        <img src="${n.sender?.googleAvatar || (n.sender ? '/avatar/'+n.sender._id : '/images/default-avatar.png')}"
          class="notif-item-avatar" onerror="this.src='/images/default-avatar.png'">
        <div class="notif-item-body">
          <div class="notif-item-msg">${n.message}</div>
          <div class="notif-item-time">${new Date(n.createdAt).toLocaleString('en-IN')}</div>
        </div>
      </div>
    `).join('');
  } catch (e) {
    list.innerHTML = '<div class="notif-loading">Failed to load</div>';
  }
}

// ===== MARK ALL READ =====
async function markAllRead() {
  await fetch('/notifications/mark-all-read', { method: 'POST' });
  const badge = document.getElementById('notifCount');
  if (badge) { badge.textContent = '0'; badge.classList.add('hidden'); }
  document.querySelectorAll('.notif-item').forEach(el => el.classList.remove('unread'));
}

// ===== CLIENT-SIDE FILTER, SEARCH & PAGINATION ENGINE =====
(function () {
  const activePaginators = new Map();

  function initPagination(options = {}) {
    const {
      containerSelector,
      itemSelector,
      pageSize = 10,
      paginationMount,
      itemLabel = 'items'
    } = options;

    const container = document.querySelector(containerSelector);
    if (!container) return null;

    let items = Array.from(container.querySelectorAll(itemSelector)).filter(el => {
      return !el.classList.contains('empty-state') && !el.querySelector('.empty-state');
    });

    if (items.length === 0) return null;

    let currentPage = 1;
    let currentLimit = pageSize;

    let mountEl = typeof paginationMount === 'string' ? document.querySelector(paginationMount) : paginationMount;
    if (!mountEl) {
      mountEl = container.closest('.table-card')?.querySelector('.pagination-container') ||
                container.parentElement.querySelector('.pagination-container');
      
      if (!mountEl) {
        mountEl = document.createElement('div');
        mountEl.className = 'pagination-container';
        const cardParent = container.closest('.table-card') || container.parentElement;
        cardParent.appendChild(mountEl);
      }
    }

    function getVisibleItems() {
      return items.filter(it => it.dataset.searchHidden !== 'true');
    }

    function render() {
      const visible = getVisibleItems();
      const total = visible.length;
      const limit = currentLimit === 'all' ? (total || 1) : currentLimit;
      const totalPages = Math.max(1, Math.ceil(total / limit));

      if (currentPage > totalPages) currentPage = totalPages;
      if (currentPage < 1) currentPage = 1;

      const startIdx = currentLimit === 'all' ? 0 : (currentPage - 1) * limit;
      const endIdx = currentLimit === 'all' ? total : Math.min(startIdx + limit, total);

      items.forEach(it => {
        if (it.dataset.searchHidden === 'true') {
          it.style.display = 'none';
        } else {
          const idx = visible.indexOf(it);
          if (idx >= startIdx && idx < endIdx) {
            it.style.display = '';
          } else {
            it.style.display = 'none';
          }
        }
      });

      if (total <= (currentLimit === 'all' ? 10 : currentLimit) && totalPages <= 1 && items.length <= 10) {
        mountEl.style.display = 'none';
        return;
      }

      mountEl.style.display = 'flex';

      let pagesHtml = '';
      const createPageBtn = (p, text = p) => `
        <button type="button" class="pagination-btn ${p === currentPage ? 'active' : ''}" data-page="${p}">
          ${text}
        </button>
      `;

      pagesHtml += `<button type="button" class="pagination-btn" data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''} title="Previous Page">‹</button>`;

      let startP = Math.max(1, currentPage - 2);
      let endP = Math.min(totalPages, currentPage + 2);

      if (startP > 1) {
        pagesHtml += createPageBtn(1);
        if (startP > 2) pagesHtml += `<span style="padding:0 4px;color:var(--text-muted)">...</span>`;
      }

      for (let p = startP; p <= endP; p++) {
        pagesHtml += createPageBtn(p);
      }

      if (endP < totalPages) {
        if (endP < totalPages - 1) pagesHtml += `<span style="padding:0 4px;color:var(--text-muted)">...</span>`;
        pagesHtml += createPageBtn(totalPages);
      }

      pagesHtml += `<button type="button" class="pagination-btn" data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''} title="Next Page">›</button>`;

      mountEl.innerHTML = `
        <div class="pagination-info">
          Showing <strong>${total === 0 ? 0 : startIdx + 1}</strong> to <strong>${endIdx}</strong> of <strong>${total}</strong> ${itemLabel}
        </div>
        <div class="pagination-controls">
          ${pagesHtml}
          <select class="pagination-size-select" title="Items per page" aria-label="Items per page">
            <option value="10" ${currentLimit == 10 ? 'selected' : ''}>10 / page</option>
            <option value="25" ${currentLimit == 25 ? 'selected' : ''}>25 / page</option>
            <option value="50" ${currentLimit == 50 ? 'selected' : ''}>50 / page</option>
            <option value="all" ${currentLimit === 'all' ? 'selected' : ''}>Show all</option>
          </select>
        </div>
      `;

      mountEl.querySelectorAll('.pagination-btn[data-page]').forEach(btn => {
        btn.addEventListener('click', () => {
          if (btn.disabled) return;
          const p = parseInt(btn.dataset.page);
          if (p && p >= 1 && p <= totalPages && p !== currentPage) {
            currentPage = p;
            render();
            const topEl = container.closest('.table-card') || container;
            const rect = topEl.getBoundingClientRect();
            if (rect.top < 0) {
              topEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          }
        });
      });

      const sizeSel = mountEl.querySelector('.pagination-size-select');
      if (sizeSel) {
        sizeSel.addEventListener('change', () => {
          currentLimit = sizeSel.value === 'all' ? 'all' : parseInt(sizeSel.value);
          currentPage = 1;
          render();
        });
      }
    }

    render();

    const paginator = {
      setPage: (p) => { currentPage = p; render(); },
      recalculate: () => { render(); },
      refreshItems: () => {
        items = Array.from(container.querySelectorAll(itemSelector)).filter(el => !el.classList.contains('empty-state'));
        render();
      }
    };

    activePaginators.set(container, paginator);
    return paginator;
  }

  function autoInitPagination() {
    // 1. Data Tables
    document.querySelectorAll('.data-table').forEach(table => {
      const tbody = table.querySelector('tbody');
      if (!tbody) return;
      const rows = tbody.querySelectorAll('tr:not(.empty-state)');
      if (rows.length > 8) {
        initPagination({
          containerSelector: '.data-table tbody',
          itemSelector: 'tr',
          pageSize: 10,
          itemLabel: 'records'
        });
      }
    });

    // 2. Grids
    document.querySelectorAll('.projects-grid, .freelancers-grid').forEach(grid => {
      const isProj = grid.classList.contains('projects-grid');
      const cards = grid.querySelectorAll(isProj ? '.project-card' : '.freelancer-card');
      if (cards.length > 8) {
        initPagination({
          containerSelector: isProj ? '.projects-grid' : '.freelancers-grid',
          itemSelector: isProj ? '.project-card' : '.freelancer-card',
          pageSize: 8,
          itemLabel: isProj ? 'projects' : 'freelancers'
        });
      }
    });

    // 3. Admin payment rows
    const prowList = document.querySelectorAll('.main-content > .prow');
    if (prowList.length > 8) {
      const parent = prowList[0].parentElement;
      if (parent) {
        initPagination({
          containerSelector: '.main-content',
          itemSelector: '.prow',
          pageSize: 10,
          itemLabel: 'payments'
        });
      }
    }
  }

  window.FilterHelpers = window.FilterHelpers || {};
  window.FilterHelpers.initPagination = initPagination;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInitPagination);
  } else {
    autoInitPagination();
  }
})();