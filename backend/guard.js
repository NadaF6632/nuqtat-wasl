// ================= GUARD - ROLE-BASED ACCESS CONTROL =================
// This file handles page access restrictions based on user role

const currentUser = JSON.parse(localStorage.getItem("user") || "null");

// Get current page path
const pagePath = window.location.pathname;

// ================= PAGE CATEGORIES =================

// Public pages (anyone can access, even logged out)
const publicPages = [
  "index.html",
  "owner.html",
  "Login.html",
  "sign_up.html",
  "map.html",
  "property.html"
];

// Searcher only pages
const searcherPages = [
  "searcher_profile.html",
  "favorites.html",
  "chat_searcher.html"
];

// Owner only pages
const ownerPages = [
  "owner_profile.html",
  "owner_ads.html",
  "add_property.html",
  "edit_property.html",
  "payment.html",
  "chat_owner.html"
];

// Admin only pages
const adminPages = [
  "admin.html",
  "admin-properties.html",
  "admin-settings.html",
  "ad-details.html",
  "users.html",
  "user-details.html",
  "reports.html",
  "report-details.html"
];

// ================= CHECK IF PAGE MATCHES ANY IN LIST =================
function isPageInList(pageList) {
  return pageList.some(page => pagePath.includes(page));
}

// ================= REDIRECT BASED ON ROLE =================

// If user is NOT logged in
if (!currentUser) {
  // Redirect to login if trying to access protected pages
  if (isPageInList(searcherPages) || isPageInList(ownerPages) || isPageInList(adminPages)) {
    console.log("🔒 Not logged in, redirecting to login page");
    window.location.href = "Login.html";
  }
  // Public pages are fine - no redirect
}

// If user IS logged in
else {
  const userRole = currentUser.role;
  
  // ===== ADMIN RESTRICTIONS =====
  if (userRole === "admin") {
    // Admin can ONLY access admin pages
    if (!isPageInList(adminPages)) {
      console.log("🚫 Admin cannot access this page, redirecting to admin.html");
      window.location.href = "admin.html";
    }
  }
  
  // ===== OWNER RESTRICTIONS =====
  else if (userRole === "owner") {
    // Owner cannot access searcher pages or admin pages
    if (isPageInList(searcherPages) || isPageInList(adminPages)) {
      console.log("🚫 Owner cannot access this page, redirecting to owner.html");
      window.location.href = "owner.html";
    }
  }
  
  // ===== SEARCHER RESTRICTIONS =====
  else if (userRole === "searcher") {
    // Searcher cannot access owner pages or admin pages
    if (isPageInList(ownerPages) || isPageInList(adminPages)) {
      console.log("🚫 Searcher cannot access this page, redirecting to index.html");
      window.location.href = "index.html";
    }
  }
}

// ================= UPDATE NOTIFICATION BELL VISIBILITY =================
// This function will be called by auth.js when login status changes
function updateNotificationBellVisibility() {
  const notificationContainer = document.getElementById("notificationContainer");
  const currentUser = JSON.parse(localStorage.getItem("user") || "null");
  
  if (notificationContainer) {
    // Show bell only for logged-in users who are NOT on admin pages
    if (currentUser && currentUser.role !== "admin") {
      notificationContainer.style.display = "block";
    } else {
      notificationContainer.style.display = "none";
    }
  }
}

// Call it immediately
updateNotificationBellVisibility();

// Log current state for debugging
console.log("🔐 Guard check complete. User:", currentUser?.role || "Not logged in", "Page:", pagePath);