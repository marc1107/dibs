// Applies the stored appearance before the first paint (no light flash in dark mode).
// Kept in sync with src/client/lib/theme.ts; external file because the CSP forbids inline scripts.
(function () {
  var pref = "system";
  try {
    pref = localStorage.getItem("dibs-theme") || "system";
  } catch {
    // Storage blocked (private mode): follow the system.
  }
  var dark = pref === "dark" || (pref !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]').setAttribute("content", dark ? "#0d1015" : "#f2f4f7");
})();
