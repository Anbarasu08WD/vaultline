const TOKEN_KEY = "vl_token";
const getToken = () => localStorage.getItem(TOKEN_KEY);
const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
function logout() { localStorage.removeItem(TOKEN_KEY); location.replace("/"); }

async function api(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = "Bearer " + token;
  let res;
  try {
    res = await fetch("/api" + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error("You appear to be offline. Check your connection and try again.");
  }
  let data = {};
  try { data = await res.json(); } catch { /* non-JSON response */ }
  if (res.status === 401 && token && path !== "/login") { sessionStorage.setItem("vl_notice", data.error || "Your session ended. Sign in again."); logout(); }
  if (!res.ok) throw new Error(data.error || "Something went wrong. Try again.");
  return data;
}

function money(n) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: window.CURRENCY || "USD" }).format(n);
  } catch { return Number(n).toFixed(2); }
}
function when(iso) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function toast(message, kind = "ok") {
  let box = document.getElementById("toasts");
  if (!box) { box = document.createElement("div"); box.id = "toasts"; box.setAttribute("role", "status"); box.setAttribute("aria-live", "polite"); document.body.appendChild(box); }
  const el = document.createElement("div");
  el.className = "toast toast-" + kind;
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => el.remove(), kind === "ok" ? 3500 : 6000);
}
