// =========================================================
// FAVORITE BUTTON HANDLER
// Used in: map.html, property.html
// =========================================================

async function handleFavoriteClick(propertyId, favBtn) {
  const user = JSON.parse(localStorage.getItem("user") || "null");

  // Not logged in
  if (!user?.id) {
    alert("يجب تسجيل الدخول لإضافة العقار للمفضلة");
    return;
  }

  // Owner trying to favorite
  if (user.role === "owner") {
    alert("المفضلة متاحة للباحثين فقط. سجل دخول كباحث لإضافة العقار للمفضلة");
    return;
  }

  // admin trying to favorite
  if (user.role === "admin") {
    alert("لا يمكن استخدام المفضله لمدير النظام");
    return;
  }

  // Toggle favorite
  if (favBtn.classList.contains("active")) {
    // Remove
    try {
      const res = await fetch(`http://127.0.0.1:3001/api/favorites/${propertyId}`, {
        method: "DELETE",
        credentials: "include"
      });
      if (res.ok) {
        favBtn.classList.remove("active");
        favBtn.textContent = "♡";
      }
    } catch (err) {
      console.error(err);
    }
  } else {
    // Add
    try {
      const res = await fetch("http://127.0.0.1:3001/api/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ property_id: Number(propertyId) })
      });
      if (res.ok) {
        favBtn.classList.add("active");
        favBtn.textContent = "♥";
      }
    } catch (err) {
      console.error(err);
    }
  }
}

async function checkIfFavorited(propertyId, favBtn) {
  const user = JSON.parse(localStorage.getItem("user") || "null");

  if (!user?.id || user.role !== "searcher") return;

  try {
    const res = await fetch(
      `http://127.0.0.1:3001/api/favorites/check/${propertyId}`,
      { credentials: "include" }
    );
    const data = await res.json();

    if (data.isFavorited) {
      favBtn.classList.add("active");
      favBtn.textContent = "♥";
    }
  } catch (err) {
    console.error(err);
  }
}