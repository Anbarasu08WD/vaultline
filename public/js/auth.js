(function () {
  if (getToken()) { location.replace("/dashboard.html"); return; }
  const $ = (id) => document.getElementById(id);
  const notice = sessionStorage.getItem("vl_notice");
  if (notice) { sessionStorage.removeItem("vl_notice"); $("auth-notice").textContent = notice; $("auth-notice").classList.remove("hidden"); }
  let mode = "login";

  function setMode(m) {
    mode = m;
    const reg = m === "register";
    $("tab-login").setAttribute("aria-pressed", String(!reg));
    $("tab-register").setAttribute("aria-pressed", String(reg));
    $("name-wrap").classList.toggle("hidden", !reg);
    $("pw-hint").classList.toggle("hidden", !reg);
    $("password").autocomplete = reg ? "new-password" : "current-password";
    $("auth-submit").textContent = reg ? "Create account" : "Sign in";
    $("auth-error").textContent = "";
  }
  $("pw-toggle").onclick = () => {
    const show = $("password").type === "password";
    $("password").type = show ? "text" : "password";
    $("pw-icon").textContent = show ? "visibility_off" : "visibility";
    $("pw-toggle").setAttribute("aria-label", show ? "Hide password" : "Show password");
  };
  $("tab-login").onclick = () => setMode("login");
  $("tab-register").onclick = () => setMode("register");

  $("auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("auth-submit");
    const body = { email: $("email").value.trim(), password: $("password").value };
    if (mode === "register") body.full_name = $("full_name").value.trim();
    if (!body.email || !body.password) { $("auth-error").textContent = "Enter your email and password."; return; }
    btn.disabled = true; btn.textContent = mode === "register" ? "Creating account..." : "Signing in...";
    $("auth-error").textContent = "";
    try {
      const r = await api(mode === "register" ? "/register" : "/login", { method: "POST", body });
      setToken(r.token);
      location.replace("/dashboard.html");
    } catch (err) {
      $("auth-error").textContent = err.message;
      btn.disabled = false; btn.textContent = mode === "register" ? "Create account" : "Sign in";
    }
  });
})();
