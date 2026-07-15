"use strict";

function closeAllDropdowns(except) {
  document.querySelectorAll(".dropdown-menu.open").forEach((menu) => {
    if (menu !== except) menu.classList.remove("open");
  });
}

document.addEventListener("click", (e) => {
  const toggle = e.target.closest("[data-dropdown-toggle]");
  if (toggle) {
    const menu = toggle.parentElement.querySelector(".dropdown-menu");
    if (!menu) return;
    const willOpen = !menu.classList.contains("open");
    closeAllDropdowns();
    menu.classList.toggle("open", willOpen);
    return;
  }
  if (!e.target.closest(".dropdown-menu")) closeAllDropdowns();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeAllDropdowns();
});
