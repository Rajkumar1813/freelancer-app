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

// ===== MOBILE SIDEBAR TOGGLE =====
const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
const sidebar = document.querySelector('.sidebar');
if (sidebarToggleBtn && sidebar) {
  sidebarToggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    sidebar.classList.toggle('open');
  });
  sidebar.addEventListener('click', (e) => {
    e.stopPropagation();
  });
}

// Close dropdowns & mobile sidebar on outside click
document.addEventListener('click', () => {
  userDropdown?.classList.remove('open');
  notifDropdown?.classList.remove('open');
  sidebar?.classList.remove('open');
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