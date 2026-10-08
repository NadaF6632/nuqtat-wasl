// ================= NOTIFICATION SYSTEM =================

async function loadNotifications() {
  try {
    const res = await fetch('http://127.0.0.1:3001/api/admin/notifications', {
      credentials: 'include'
    });
    
    if (!res.ok) return;
    
    const notifications = await res.json();
    
    // Update badge count
    const unreadCount = notifications.filter(n => !n.is_read).length;
    const badge = document.getElementById('notificationBadge');
    if (badge) {
      if (unreadCount > 0) {
        badge.style.display = 'inline-flex';
        badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
      } else {
        badge.style.display = 'none';
      }
    }
    
    window.notificationsData = notifications;
    
  } catch(err) {
    console.error('Error loading notifications:', err);
  }
}

function renderNotificationsDropdown() {
  const list = document.getElementById('notificationList');
  const notifications = window.notificationsData || [];
  
  if (!list) return;
  
  if (notifications.length === 0) {
    list.innerHTML = '<div class="notification-empty">📭 لا توجد إشعارات</div>';
    return;
  }
  
  list.innerHTML = notifications.map(n => `
    <div class="notification-item ${!n.is_read ? 'unread' : ''}" data-id="${n.id}">
      <div class="notification-title">${n.title}</div>
      <div class="notification-message">${n.message}</div>
      <div class="notification-time">${formatNotificationTime(n.created_at)}</div>
    </div>
  `).join('');
  
  document.querySelectorAll('.notification-item').forEach(item => {
    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = item.dataset.id;
      if (id) {
        await fetch(`http://127.0.0.1:3001/api/admin/notifications/${id}/read`, {
          method: 'PUT',
          credentials: 'include'
        });
        item.classList.remove('unread');
        loadNotifications();
      }
    });
  });
}

function formatNotificationTime(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'الآن';
  if (diffMins < 60) return `منذ ${diffMins} دقيقة`;
  if (diffHours < 24) return `منذ ${diffHours} ساعة`;
  if (diffDays < 7) return `منذ ${diffDays} يوم`;
  return date.toLocaleDateString('ar-SA');
}

function toggleNotifications() {
  const dropdown = document.getElementById('notificationDropdown');
  if (!dropdown) return;
  
  const isVisible = dropdown.classList.contains('show');
  
  if (isVisible) {
    dropdown.classList.remove('show');
  } else {
    renderNotificationsDropdown();
    dropdown.classList.add('show');
  }
}

// Close dropdown when clicking outside
document.addEventListener('click', function(e) {
  const container = document.querySelector('.notification-container');
  const dropdown = document.getElementById('notificationDropdown');
  
  if (container && dropdown && !container.contains(e.target)) {
    dropdown.classList.remove('show');
  }
});

// Add click event to bell
document.addEventListener('DOMContentLoaded', () => {
  const bell = document.getElementById('notificationBell');
  if (bell) {
    bell.addEventListener('click', toggleNotifications);
  }
});

// Load notifications every 30 seconds if user is logged in
setInterval(() => {
  const user = JSON.parse(localStorage.getItem("user") || "null");
  if (user) {
    loadNotifications();
  }
}, 30000);

// Initial load
document.addEventListener('DOMContentLoaded', () => {
  const user = JSON.parse(localStorage.getItem("user") || "null");
  if (user) {
    loadNotifications();
  }
});