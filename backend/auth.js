// ================= AUTHENTICATION - UPDATED =================

const currentUser = JSON.parse(localStorage.getItem("user") || "null");

// Get login button elements
const loginBtn = document.getElementById("loginBtn");
const joinBtn = document.getElementById("joinBtn");

// If user is logged in, change button text to their name
if (currentUser && loginBtn) {
  // Change button text to user name
  loginBtn.textContent = currentUser.full_name;
  
  // Change link to profile page based on role
  if (currentUser.role === "searcher") {
    loginBtn.href = "searcher_profile.html";
  }
  else if (currentUser.role === "owner") {
    loginBtn.href = "owner_profile.html";
    
    // FOR OWNER PAGE ONLY: Change join button to owner's name
    if (joinBtn && window.location.pathname.includes("owner.html")) {
      joinBtn.textContent = currentUser.full_name;
      joinBtn.href = "owner_profile.html";
    }
  }
  else if (currentUser.role === "admin") {
    loginBtn.href = "admin.html";
  }
  
  // Show notification bell (only for non-admin users on appropriate pages)
  const notificationContainer = document.getElementById("notificationContainer");
  if (notificationContainer && currentUser.role !== "admin") {
    notificationContainer.style.display = "block";
  }
} else {
  // User not logged in - hide notification bell
  const notificationContainer = document.getElementById("notificationContainer");
  if (notificationContainer) {
    notificationContainer.style.display = "none";
  }
  
  // Reset join button to default for owner page when not logged in
  if (joinBtn && window.location.pathname.includes("owner.html")) {
    joinBtn.textContent = "انضم إلينا";
    joinBtn.href = "Login.html";
  }
}

// ================= LOGOUT FUNCTION =================
function logoutUser() {
  localStorage.removeItem("user");
  sessionStorage.clear();
  window.location.href = "Login.html";
}

// Attach logout to buttons if they exist
const logoutBtn = document.getElementById("logoutBtn");
if (logoutBtn) {
  logoutBtn.onclick = (e) => {
    e.preventDefault();
    logoutUser();
  };
}

// ================= FOOTER ACCOUNT LINK =================
// Make the footer "الحساب" link do the same as the login button
function setupAccountLink() {
  const accountLink = document.getElementById('accountLink');
  const loginBtn = document.getElementById('loginBtn');
  
  if (accountLink && loginBtn) {
    accountLink.addEventListener('click', (e) => {
      e.preventDefault();
      // Just click the login button programmatically
      loginBtn.click();
    });
  }
}

// Call this when DOM is ready
document.addEventListener('DOMContentLoaded', setupAccountLink);