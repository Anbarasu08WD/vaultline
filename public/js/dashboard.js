(function () {
  if (!getToken()) { location.replace("/"); return; }
  const $ = (id) => document.getElementById(id);
  const VIEWS = ["accounts", "move", "activity", "security", "admin"];
  const COLORS = ["#006859", "#6ed9c2", "#516071", "#b15f00", "#9aa8b6"];
  const S = {
    me: null, page1: [], extra: [], txs: [], next1: null, extraNext: null, alerts: [], payees: [], scheduled: [],
    notifs: { notifications: [], unread: 0 }, view: "accounts", mode: "transfer", type: "all", astatus: "all", atab: "alerts",
    sig: "", verify: null, loaded: false,
  };

  /* ---------- small helpers ---------- */
  const chip = (cls, text, icon) => `<span class="chip ${cls}">${icon ? `<span class="material-symbols-outlined text-[14px]">${icon}</span>` : ""}${esc(text)}</span>`;
  const empty = (icon, msg) => `<div class="p-6 text-center text-on-surface-variant"><span class="material-symbols-outlined text-[32px] text-outline">${icon}</span><p class="mt-2">${esc(msg)}</p></div>`;
  const last4 = (n) => "\u2022\u2022\u2022\u2022 " + String(n).slice(-4);
  const accIcon = (t) => (t === "savings" ? "savings" : "account_balance_wallet");
  const accName = (a) => a.nickname || (a.type[0].toUpperCase() + a.type.slice(1) + " account");
  const fmtDay = (iso) => new Date(iso + "T00:00:00").toLocaleDateString(undefined, { dateStyle: "medium" });
  const todayUTC = () => new Date().toISOString().slice(0, 10);
  const selAcc = () => (S.me ? S.me.accounts.find((a) => String(a.id) === $("acc-select").value) : null);
  const kv = (k, v) => `<div class="kv"><span>${esc(k)}</span><span>${v}</span></div>`;
  const curSym = () => {
    try { return new Intl.NumberFormat(undefined, { style: "currency", currency: window.CURRENCY || "USD", currencyDisplay: "narrowSymbol" }).formatToParts(0).find((p) => p.type === "currency").value; }
    catch { return "$"; }
  };

  /* ---------- modal ---------- */
  let lastFocus = null;
  function closeModal() {
    $("modal-root").innerHTML = "";
    document.removeEventListener("keydown", modalKey);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function modalKey(e) {
    if (e.key === "Escape") return closeModal();
    if (e.key !== "Tab") return;
    const f = [...$("modal-root").querySelectorAll("button:not([disabled]), a[href], input, select")];
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  function openModal({ title, html, actions = [] }) {
    lastFocus = document.activeElement;
    const root = $("modal-root");
    root.innerHTML = `<div class="modal-backdrop" id="modal-bg"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="flex items-center justify-between p-5 pb-2"><h2 id="modal-title" class="font-display font-semibold text-xl">${esc(title)}</h2>
        <button type="button" class="w-9 h-9 rounded-md hover:bg-surface-container no-print" data-close aria-label="Close"><span class="material-symbols-outlined">close</span></button></div>
      <div class="px-5 pb-2">${html}</div><div class="p-5 pt-3 grid gap-2 no-print" id="modal-actions"></div></div></div>`;
    const box = $("modal-actions");
    actions.forEach((a) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "btn " + (a.cls || "btn-soft"); b.innerHTML = a.label;
      b.onclick = () => a.onClick(b); box.appendChild(b);
    });
    root.querySelector("[data-close]").onclick = closeModal;
    $("modal-bg").addEventListener("click", (e) => { if (e.target.id === "modal-bg") closeModal(); });
    document.addEventListener("keydown", modalKey);
    (box.querySelector("button") || root.querySelector("[data-close]")).focus();
  }

  /* ---------- navigation ---------- */
  function show(view) {
    S.view = view;
    VIEWS.forEach((v) => $("view-" + v).classList.toggle("hidden", v !== view));
    document.querySelectorAll("[data-nav]").forEach((b) => {
      if (b.dataset.nav === view) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    window.scrollTo({ top: 0 });
    closePanel();
    if (view === "admin") loadAdmin();
    if (view === "security") { localStorage.setItem("vl_sec_seen", "1"); loadEvents(); if (S.loaded) renderOnboarding(); }
    if (view === "move") { loadPayees(); loadScheduled(); }
  }
  document.querySelectorAll("[data-nav]").forEach((b) => (b.onclick = () => show(b.dataset.nav)));
  $("logout").onclick = logout;

  /* ---------- data ---------- */
  async function refresh(silent = true) {
    try {
      const [me, tx, al, nt] = await Promise.all([api("/me"), api("/transactions?limit=50"), api("/alerts"), api("/notifications")]);
      S.me = me; S.page1 = tx.transactions; S.next1 = tx.next_before; S.alerts = al.alerts; S.notifs = nt;
      const minId = S.page1.length ? S.page1[S.page1.length - 1].id : 0;
      S.extra = S.extra.filter((t) => t.id < minId);
      if (!S.extra.length) S.extraNext = null;
      S.txs = S.page1.concat(S.extra);
      window.CURRENCY = me.currency;
      if (!S.loaded) { S.loaded = true; await Promise.all([loadPayees(true), loadScheduled(true)]); }
      render();
      if (S.view === "admin") loadAdmin();
    } catch (err) {
      if (!silent) toast(err.message, "error");
    }
  }
  async function loadPayees(quiet) { try { S.payees = (await api("/payees")).payees; if (!quiet) { renderPayees(); renderOnboarding(); } } catch { /* ignore */ } }
  async function loadScheduled(quiet) { try { S.scheduled = (await api("/scheduled")).scheduled; if (!quiet) renderScheduled(); } catch { /* ignore */ } }

  /* ---------- transactions ---------- */
  function txInfo(t) {
    let dir, title, icon;
    if (t.kind === "interest") { dir = "in"; title = "Interest earned"; icon = "trending_up"; }
    else if (t.kind === "deposit") { dir = "in"; title = "Deposit"; icon = "south_west"; }
    else if (t.kind === "withdraw") { dir = "out"; title = "Withdrawal"; icon = "account_balance"; }
    else if (t.from_mine && t.to_mine) { dir = "self"; title = `Moved from ${t.from_number} to ${t.to_number}`; icon = "swap_horiz"; }
    else if (t.from_mine) { dir = "out"; title = `Sent to ${t.to_number}`; icon = "north_east"; }
    else { dir = "in"; title = `Received from ${t.from_number}`; icon = "south_west"; }
    return { dir, title, icon };
  }
  function txRow(t) {
    const { dir, title, icon } = txInfo(t);
    const dead = t.status === "blocked" || t.status === "rejected";
    const sign = dir === "in" ? "+" : dir === "out" ? "-" : "";
    const amt = dead ? "text-outline line-through" : dir === "in" ? "text-primary" : "text-on-surface";
    const bubble = dead ? "bg-error-container text-error" : dir === "in" ? "bg-primary-fixed text-primary" : "bg-surface-container-high text-on-surface-variant";
    const tag = t.status === "blocked" ? chip("chip-bad", "Held for review") : t.status === "rejected" ? chip("chip-muted", "Rejected")
      : t.risk_score >= 40 ? chip("chip-warn", "Flagged") : `<span class="text-xs text-on-surface-variant">Completed</span>`;
    return `<button type="button" class="w-full text-left p-4 flex items-center gap-3 hover:bg-surface-container-low transition-colors" data-tx="${t.id}" aria-label="${esc(title)}, ${money(t.amount)}. View receipt">
      <span class="w-10 h-10 rounded-full ${bubble} flex items-center justify-center shrink-0"><span class="material-symbols-outlined text-[20px]">${dead ? "pan_tool" : icon}</span></span>
      <span class="min-w-0 grow"><span class="block font-semibold truncate">${esc(title)}</span>
        <span class="block text-sm text-on-surface-variant truncate">${when(t.created_at)}${t.note ? " \u00b7 " + esc(t.note) : ""}</span></span>
      <span class="text-right shrink-0"><span class="block font-display font-semibold ${amt}">${sign}${money(t.amount)}</span>${tag}</span></button>`;
  }

  async function showReceipt(id) {
    try {
      const t = await api("/transactions/" + id);
      const { title, dir } = txInfo(t);
      const stText = { completed: "Completed", blocked: "Held for review", rejected: "Rejected" }[t.status];
      const stChip = { completed: "chip-ok", blocked: "chip-bad", rejected: "chip-muted" }[t.status];
      const party = (name, num) => (num ? `${name ? esc(name) + "<br>" : ""}<span class="font-normal text-on-surface-variant">${esc(num)}</span>` : "");
      let html = `<div class="text-center py-3"><p class="text-sm text-on-surface-variant">${esc(title)}</p>
        <p class="font-display font-bold text-4xl mt-1 ${t.status !== "completed" ? "line-through text-outline" : ""}">${dir === "in" ? "+" : dir === "out" ? "-" : ""}${money(t.amount)}</p>
        <div class="mt-2">${chip(stChip, stText)}</div></div>`;
      html += kv("Reference", esc(t.reference)) + kv("Date", when(t.created_at));
      if (t.from_number) html += kv("From", party(t.from_name, t.from_number));
      if (t.to_number) html += kv("To", party(t.to_name, t.to_number));
      if (t.note) html += kv("Note", esc(t.note));
      if (t.alert_reason) html += `<div class="mt-3 rounded-xl bg-tertiary-fixed/60 p-3 text-sm text-on-tertiary-fixed"><p class="font-semibold">Why this was flagged</p><p>${esc(t.alert_reason)}.</p>${t.status === "blocked" ? "<p class=\"mt-1\">No money has moved while it is under review.</p>" : ""}</div>`;
      openModal({
        title: "Receipt", html, actions: [
          { label: '<span class="material-symbols-outlined text-[20px]">print</span>Print receipt', cls: "btn-white", onClick: () => window.print() },
          { label: '<span class="material-symbols-outlined text-[20px]">content_copy</span>Copy reference', cls: "btn-soft", onClick: async () => { try { await navigator.clipboard.writeText(t.reference); toast("Reference copied"); } catch { toast("Copy failed", "error"); } } },
        ],
      });
    } catch (err) { toast(err.message, "error"); }
  }

  /* ---------- render ---------- */
  function render() {
    const { user, accounts, total_balance, open_alerts } = S.me;
    const h = new Date().getHours();
    $("greet").textContent = `${h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"}, ${user.full_name.split(" ")[0]}`;
    $("who").textContent = user.full_name;
    $("avatar").textContent = user.full_name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
    const admin = user.role === "admin";
    $("nav-admin").classList.toggle("hidden", !admin); $("nav-admin").classList.toggle("flex", admin);
    $("cur-sym").textContent = curSym();
    const nm = $("profile-name"); if (document.activeElement !== nm && nm.dataset.set !== user.full_name) { nm.value = user.full_name; nm.dataset.set = user.full_name; }
    $("profile-email").value = user.email;
    renderBell();

    $("total").classList.remove("skeleton", "w-56");
    $("total").textContent = money(total_balance);
    const active = accounts.filter((a) => a.status === "active").reduce((s, a) => s + a.balance, 0);
    const frozen = accounts.filter((a) => a.status === "frozen").reduce((s, a) => s + a.balance, 0);
    const tile = (label, value, icon, tone) => `<div class="rounded-xl bg-surface-container-low p-3.5"><p class="flex items-center gap-1 text-xs sm:text-sm text-on-surface-variant"><span class="material-symbols-outlined text-[16px] ${tone}">${icon}</span>${label}</p><p class="font-display font-semibold text-base sm:text-xl mt-1 break-words">${value}</p></div>`;
    $("stat-tiles").innerHTML = tile("Available", money(active), "check_circle", "text-primary") + tile("Frozen", money(frozen), "ac_unit", "text-tertiary") +
      tile("Interest, 30 days", "+" + money(S.me.interest_30d), "trending_up", "text-primary") + tile("Open alerts", String(open_alerts), "notifications", open_alerts ? "text-error" : "text-primary");
    $("open-note").textContent = `Savings accounts earn ${S.me.apy}% a year, paid daily. You can hold up to 5 accounts.`;

    const heldTx = S.txs.filter((t) => t.status === "blocked" && t.from_mine);
    $("held-banner").classList.toggle("hidden", !heldTx.length);
    $("held-banner").innerHTML = heldTx.length ? `<div class="flex flex-wrap items-center gap-4 rounded-xl bg-tertiary-fixed/60 border-l-4 border-tertiary p-4">
      <span class="material-symbols-outlined text-tertiary icon-fill">pan_tool</span>
      <div class="grow min-w-[12rem]"><p class="font-semibold text-on-tertiary-fixed">${heldTx.length} payment${heldTx.length > 1 ? "s" : ""} held for review</p>
      <p class="text-sm text-on-tertiary-fixed-variant">${money(heldTx.reduce((s, t) => s + t.amount, 0))} is waiting for a fraud analyst. No money has moved.</p></div>
      <button class="btn btn-white btn-sm" data-go="activity" type="button">See details</button></div>` : "";

    const left = Math.max(S.me.daily_limit - S.me.daily_used, 0);
    $("limit-total").textContent = money(S.me.daily_limit);
    $("limit-left").textContent = money(left);
    $("limit-fill").style.width = Math.min(100, (S.me.daily_used / S.me.daily_limit) * 100) + "%";

    if (total_balance > 0) {
      $("alloc-bar").innerHTML = accounts.map((a, i) => a.balance > 0 ? `<span style="width:${(a.balance / total_balance) * 100}%;background:${COLORS[i % COLORS.length]}"></span>` : "").join("");
      $("alloc-legend").innerHTML = accounts.map((a, i) => `<li class="flex items-center justify-between gap-2"><span class="flex items-center gap-2 min-w-0"><span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${COLORS[i % COLORS.length]}"></span><span class="truncate">${esc(accName(a))} ${last4(a.account_number)}</span></span><span class="font-semibold">${Math.round((a.balance / total_balance) * 100)}%</span></li>`).join("");
    } else {
      $("alloc-bar").innerHTML = "";
      $("alloc-legend").innerHTML = `<li class="text-on-surface-variant">Add money under Move money to see your balance split.</li>`;
    }

    $("acc-count").textContent = accounts.length;
    $("account-list").innerHTML = accounts.map((a) => {
      const fz = a.status === "frozen";
      return `<article class="bg-surface-container-lowest rounded-xl shadow-sm p-5">
        <div class="flex items-start justify-between gap-3">
          <div class="flex items-center gap-3 min-w-0">
            <span class="w-11 h-11 rounded-lg ${fz ? "bg-tertiary-fixed text-tertiary" : "bg-primary-fixed text-primary"} flex items-center justify-center shrink-0"><span class="material-symbols-outlined">${fz ? "ac_unit" : accIcon(a.type)}</span></span>
            <div class="min-w-0"><h3 class="font-display font-semibold flex items-center gap-1"><span class="truncate">${esc(accName(a))}</span>
              <button type="button" class="w-8 h-8 rounded-md hover:bg-surface-container text-outline shrink-0" data-rename="${a.id}" data-name="${esc(a.nickname || "")}" aria-label="Rename account"><span class="material-symbols-outlined text-[18px]">edit</span></button></h3>
              <p class="text-sm text-on-surface-variant flex items-center gap-1">${esc(a.account_number)}
              <button type="button" class="w-8 h-8 rounded-md hover:bg-surface-container text-outline" data-copy="${esc(a.account_number)}" aria-label="Copy account number"><span class="material-symbols-outlined text-[18px]">content_copy</span></button></p></div>
          </div>
          ${fz ? chip("chip-warn", "Frozen", "ac_unit") : chip("chip-ok", "Active")}
        </div>
        <p class="text-sm text-on-surface-variant mt-5">Available balance</p>
        <p class="font-display font-semibold text-[32px] leading-10 tracking-tight">${money(a.balance)}</p>
        ${fz ? `<p class="mt-3 flex items-center gap-2 rounded-lg bg-tertiary-fixed/60 text-on-tertiary-fixed text-sm px-3 py-2"><span class="material-symbols-outlined text-[18px]">block</span>Payments are paused on this account</p>` : ""}
        <div class="grid grid-cols-2 gap-2 mt-4">
          ${fz ? `<button class="btn btn-primary btn-sm col-span-2" data-freeze="${a.id}" data-to="0" type="button"><span class="material-symbols-outlined text-[20px]">lock_open</span>Unfreeze account</button>`
            : `<button class="btn btn-primary btn-sm" data-go="move" data-mode="transfer" data-acc="${a.id}" type="button"><span class="material-symbols-outlined text-[20px]">north_east</span>Send</button>
               <button class="btn btn-soft btn-sm" data-go="move" data-mode="deposit" data-acc="${a.id}" type="button"><span class="material-symbols-outlined text-[20px]">add</span>Deposit</button>`}
        </div></article>`;
    }).join("");

    const sig = accounts.map((a) => a.id + a.status).join(",");
    const label = (a) => `${accName(a)} ${last4(a.account_number)} \u2014 ${money(a.balance)}${a.status === "frozen" ? " (frozen)" : ""}`;
    if (sig !== S.sig) {
      S.sig = sig;
      const keep = $("acc-select").value, keepF = $("filter-acc").value;
      $("acc-select").innerHTML = accounts.map((a) => `<option value="${a.id}">${esc(label(a))}</option>`).join("");
      $("filter-acc").innerHTML = `<option value="">All accounts</option>` + accounts.map((a) => `<option value="${a.id}">${esc(accName(a))} ${last4(a.account_number)}</option>`).join("");
      if (keep) $("acc-select").value = keep;
      if (keepF) $("filter-acc").value = keepF;
    } else {
      [...$("acc-select").options].forEach((o) => { const a = accounts.find((x) => String(x.id) === o.value); if (a) o.textContent = label(a); });
    }
    updateAvail();
    renderPayees();
    renderScheduled();
    renderOnboarding();

    $("recent-list").innerHTML = S.txs.length ? S.txs.slice(0, 5).map(txRow).join("") : empty("receipt_long", "No activity yet. Make a deposit to get started.");
    renderActivity();

    $("freeze-list").innerHTML = accounts.map((a) => {
      const on = a.status === "active";
      return `<div class="flex items-center justify-between gap-3 rounded-xl bg-surface-container-low p-4">
        <div class="flex items-center gap-3 min-w-0">
          <span class="w-10 h-10 rounded-lg bg-surface-container-high text-on-surface-variant flex items-center justify-center shrink-0"><span class="material-symbols-outlined">${accIcon(a.type)}</span></span>
          <div class="min-w-0"><p class="font-semibold truncate">${esc(accName(a))} ${last4(a.account_number)}</p>
          <p class="text-sm text-on-surface-variant">${on ? "Active, payments enabled" : "Frozen, payments blocked"} \u00b7 ${money(a.balance)}</p></div>
        </div>
        <button type="button" role="switch" aria-checked="${on}" aria-label="${on ? "Freeze" : "Unfreeze"} ${esc(accName(a))} ${esc(a.account_number)}" class="switch" data-freeze="${a.id}" data-to="${on ? "1" : "0"}"></button>
      </div>`;
    }).join("");
    const anyActive = accounts.some((a) => a.status === "active");
    $("freeze-all-label").textContent = anyActive ? "Freeze all accounts" : "Unfreeze all accounts";
    $("freeze-all").dataset.to = anyActive ? "1" : "0";
    renderAlerts();
  }

  function renderOnboarding() {
    const box = $("onboarding");
    if (!S.me) return;
    const steps = [
      { done: S.txs.some((t) => t.kind === "deposit"), label: "Make your first deposit", attrs: 'data-go="move" data-mode="deposit"' },
      { done: S.me.accounts.length > 1 || S.me.accounts.some((a) => a.nickname), label: "Open a second account or name yours", attrs: 'data-focus="new-name"' },
      { done: S.payees.length > 0, label: "Save a recipient for quick payments", attrs: 'data-go="move" data-mode="transfer"' },
      { done: localStorage.getItem("vl_sec_seen") === "1", label: "Review your security settings", attrs: 'data-go="security"' },
    ];
    const done = steps.filter((s) => s.done).length;
    const hide = localStorage.getItem("vl_onb_hide") === "1" || done === steps.length;
    box.classList.toggle("hidden", hide);
    if (hide) return;
    box.innerHTML = `<div class="bg-surface-container-lowest rounded-xl shadow-sm p-5">
      <div class="flex items-start justify-between gap-3"><div><h2 class="font-display font-semibold text-lg">Get started</h2><p class="text-sm text-on-surface-variant">${done} of ${steps.length} steps done</p></div>
      <button type="button" class="text-sm font-semibold text-on-surface-variant hover:underline" data-onb-hide>Dismiss</button></div>
      <div class="h-2 rounded-full bg-surface-container-high mt-3 overflow-hidden"><div class="h-full bg-primary rounded-full" style="width:${(done / steps.length) * 100}%"></div></div>
      <div class="grid sm:grid-cols-2 gap-2 mt-4">${steps.map((s) => `<button type="button" ${s.attrs} class="flex items-center gap-3 rounded-lg p-3 text-left ${s.done ? "bg-primary-fixed/50" : "bg-surface-container-low hover:bg-surface-container"}">
        <span class="material-symbols-outlined ${s.done ? "text-primary icon-fill" : "text-outline"}">${s.done ? "check_circle" : "radio_button_unchecked"}</span><span class="text-sm font-semibold ${s.done ? "line-through text-on-surface-variant" : ""}">${s.label}</span></button>`).join("")}</div></div>`;
  }

  function renderActivity() {
    if (!S.me) return;
    const q = $("search").value.trim().toLowerCase();
    const accId = $("filter-acc").value;
    const acc = accId ? S.me.accounts.find((a) => String(a.id) === accId) : null;
    const list = S.txs.filter((t) => {
      const { dir, title } = txInfo(t);
      if (acc && t.from_number !== acc.account_number && t.to_number !== acc.account_number) return false;
      if (S.type === "in" && dir !== "in") return false;
      if (S.type === "out" && dir !== "out") return false;
      if (S.type === "flagged" && !(t.status !== "completed" || t.risk_score >= 40)) return false;
      if (q && !(`${title} ${t.note || ""} ${t.kind} ${t.amount}`.toLowerCase().includes(q))) return false;
      return true;
    });
    $("tx-list").innerHTML = list.length ? list.map(txRow).join("") : empty("search_off", S.txs.length ? "Nothing matches these filters." : "No activity yet. Make a deposit to get started.");
    const more = S.extra.length ? S.extraNext != null : S.next1 != null;
    $("load-more").classList.toggle("hidden", !more);
  }

  const STATUS = {
    open: ["chip-warn", "Under review", "hourglass_top"], released: ["chip-ok", "Payment released", "check"],
    rejected: ["chip-muted", "Payment rejected", "block"], dismissed: ["chip-ok", "Cleared", "check"], confirmed: ["chip-bad", "Confirmed fraud", "gpp_bad"],
  };
  function renderAlerts() {
    const list = S.alerts.filter((a) => S.astatus === "all" || (S.astatus === "resolved" ? ["released", "rejected", "dismissed"].includes(a.status) : a.status === S.astatus));
    $("alert-list").innerHTML = list.length ? list.map((a) => {
      const [cls, text, icon] = STATUS[a.status];
      return `<div class="rounded-xl bg-surface-container-low p-4">
        <div class="flex items-start justify-between gap-2"><p class="font-semibold">${esc(a.reason)}</p>${chip(cls, text, icon)}</div>
        <p class="text-sm text-on-surface-variant mt-1.5">${a.amount ? money(a.amount) + " " + esc(a.kind) + " (" + (a.tx_status === "blocked" ? "held" : a.tx_status) + ") \u00b7 " : ""}${when(a.created_at)}</p>
        <div class="mt-2">${chip(a.risk_score >= 70 ? "chip-bad" : "chip-warn", "Risk " + a.risk_score + " / 100", "warning")}</div></div>`;
    }).join("") : `<div class="rounded-xl bg-surface-container-low">${empty("verified_user", S.alerts.length ? "No alerts in this group." : "No alerts. We'll tell you here if anything looks unusual.")}</div>`;
  }

  function renderPayees() {
    if (!S.me) return;
    const chips = S.payees.slice(0, 6).map((p) => ({ n: p.account_number, l: p.name, saved: true }));
    const seen = new Set(chips.map((c) => c.n));
    S.txs.forEach((t) => { if (t.kind === "transfer" && t.from_mine && !t.to_mine && !seen.has(t.to_number) && chips.length < 8) { seen.add(t.to_number); chips.push({ n: t.to_number, l: t.to_number, saved: false }); } });
    $("payees-wrap").classList.toggle("hidden", !chips.length);
    $("payees").innerHTML = chips.map((c) => `<button type="button" class="pill flex items-center gap-1.5" data-payee="${esc(c.n)}"><span class="material-symbols-outlined text-[16px]">${c.saved ? "person" : "history"}</span>${esc(c.l)}</button>`).join("");
    $("payee-list").innerHTML = S.payees.length ? S.payees.map((p) => `<div class="py-3 flex items-center gap-3">
      <span class="w-10 h-10 rounded-full bg-primary-fixed text-primary flex items-center justify-center font-semibold shrink-0">${esc(p.name[0].toUpperCase())}</span>
      <div class="min-w-0 grow"><p class="font-semibold truncate">${esc(p.name)}</p><p class="text-sm text-on-surface-variant">${esc(p.account_number)}</p></div>
      <button type="button" class="btn btn-soft btn-sm" data-payee-send="${esc(p.account_number)}">Send</button>
      <button type="button" class="w-10 h-10 rounded-lg text-outline hover:bg-surface-container hover:text-error" data-payee-del="${p.id}" aria-label="Remove ${esc(p.name)}"><span class="material-symbols-outlined">delete</span></button></div>`).join("")
      : empty("group", "No saved recipients yet. Tick \u201cSave this recipient\u201d when you send money.");
  }

  function renderScheduled() {
    const f = { once: "One time", weekly: "Every week", monthly: "Every month" };
    $("sched-list").innerHTML = S.scheduled.length ? S.scheduled.map((s) => `<div class="py-3 flex items-center gap-3">
      <span class="w-10 h-10 rounded-full bg-surface-container-high text-on-surface-variant flex items-center justify-center shrink-0"><span class="material-symbols-outlined">event_repeat</span></span>
      <div class="min-w-0 grow"><p class="font-semibold truncate">${money(s.amount)} to ${esc(s.to_account_number)}</p>
      <p class="text-sm text-on-surface-variant">${f[s.frequency]} \u00b7 next ${fmtDay(s.next_run)}${s.last_status ? " \u00b7 last: " + esc(s.last_status) : ""}</p></div>
      <button type="button" class="btn btn-soft btn-sm" data-sched-cancel="${s.id}">Cancel</button></div>`).join("")
      : empty("event_available", "Nothing scheduled. Use the Schedule tab above to set up a payment.");
  }

  /* ---------- notifications ---------- */
  const NK = { success: ["check_circle", "text-primary"], warning: ["warning", "text-tertiary"], danger: ["gpp_bad", "text-error"], info: ["info", "text-secondary"] };
  function renderBell() {
    const dot = $("bell-dot"); const n = S.notifs.unread;
    dot.textContent = n > 9 ? "9+" : n; dot.classList.toggle("hidden", !n);
  }
  function renderNotifs() {
    const items = S.notifs.notifications;
    $("notif-list").innerHTML = items.length ? items.map((n) => {
      const [icon, tone] = NK[n.kind] || NK.info;
      return `<div class="px-4 py-3 flex gap-3 ${n.is_read ? "" : "is-unread"}"><span class="material-symbols-outlined ${tone}">${icon}</span>
        <div class="min-w-0"><p class="font-semibold text-sm">${esc(n.title)}</p>${n.body ? `<p class="text-sm text-on-surface-variant">${esc(n.body)}</p>` : ""}<p class="text-xs text-outline mt-1">${when(n.created_at)}</p></div></div>`;
    }).join("") : empty("notifications_none", "You're all caught up.");
  }
  function closePanel() { $("notif-panel").classList.add("hidden"); $("bell").setAttribute("aria-expanded", "false"); }
  async function togglePanel() {
    const panel = $("notif-panel");
    if (!panel.classList.contains("hidden")) return closePanel();
    renderNotifs(); panel.classList.remove("hidden"); $("bell").setAttribute("aria-expanded", "true");
    if (S.notifs.unread) { S.notifs.unread = 0; renderBell(); try { await api("/notifications/read", { method: "POST" }); } catch { /* ignore */ } }
  }
  $("bell").onclick = togglePanel;
  $("notif-close").onclick = closePanel;
  document.addEventListener("click", (e) => { if (!$("notif-panel").classList.contains("hidden") && !e.target.closest("#notif-panel") && !e.target.closest("#bell")) closePanel(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePanel(); });

  /* ---------- move money form ---------- */
  const MODES = {
    transfer: { label: "From account", button: "Review payment", to: true, limit: true, max: true, sched: false },
    deposit: { label: "Add to account", button: "Add money", to: false, limit: false, max: false, sched: false },
    withdraw: { label: "Withdraw from account", button: "Review withdrawal", to: false, limit: true, max: true, sched: false },
    schedule: { label: "Pay from account", button: "Review schedule", to: true, limit: false, max: false, sched: true },
  };
  function setMode(m) {
    S.mode = m; const c = MODES[m];
    document.querySelectorAll("#view-move [data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === m)));
    $("acc-label").textContent = c.label; $("move-submit").textContent = c.button;
    $("to-wrap").classList.toggle("hidden", !c.to); $("sched-wrap").classList.toggle("hidden", !c.sched);
    $("limit-box").classList.toggle("hidden", !c.limit); $("max-btn").classList.toggle("hidden", !c.max);
    formError(""); updateAvail();
  }
  function updateAvail() { const a = selAcc(); $("avail").textContent = a ? (S.mode === "deposit" || S.mode === "schedule" ? "Balance: " : "Available: ") + money(a.balance) : ""; }
  function formError(msg) { const el = $("form-error"); el.textContent = msg; el.classList.toggle("hidden", !msg); }

  function verifyMsg(kind, text) {
    const map = { ok: ["check_circle", "text-primary"], bad: ["error", "text-error"], wait: ["progress_activity", "text-on-surface-variant"], warn: ["warning", "text-tertiary"] };
    const el = $("verify");
    if (!text) { el.innerHTML = ""; return; }
    const [icon, tone] = map[kind];
    el.innerHTML = `<p class="flex items-center gap-1.5 font-medium ${tone}"><span class="material-symbols-outlined text-[18px]">${icon}</span>${esc(text)}</p>`;
  }
  let verifySeq = 0;
  async function onToInput() {
    const el = $("to-number");
    el.value = el.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const v = el.value;
    S.verify = null; $("save-payee-wrap").classList.add("hidden"); verifyMsg("", "");
    if (!v) return;
    if (!/^VL\d{10}$/.test(v)) { if (v.length >= 12) verifyMsg("bad", "Account numbers look like VL0123456789."); return; }
    const seq = ++verifySeq; verifyMsg("wait", "Checking account...");
    try {
      const r = await api("/lookup?account_number=" + v);
      if (seq !== verifySeq) return;
      if (!r.found) return verifyMsg("bad", "No account found with this number. Check it and try again.");
      if (r.frozen) { verifyMsg("warn", `${r.holder}'s account can't receive payments right now.`); return; }
      S.verify = { number: v, holder: r.holder, type: r.type, is_mine: r.is_mine };
      verifyMsg("ok", r.is_mine ? `Your own ${r.type} account` : `Verified: ${r.holder} (${r.type} account)`);
      if (!r.is_mine && !S.payees.some((p) => p.account_number === v)) {
        $("save-payee-wrap").classList.remove("hidden"); $("save-payee").checked = false;
        $("payee-name").value = r.holder;
      }
    } catch (err) { if (seq === verifySeq) verifyMsg("bad", err.message); }
  }
  $("to-number").addEventListener("input", onToInput);

  $("amount").addEventListener("input", (e) => {
    let v = e.target.value.replace(/[^0-9.]/g, "");
    const i = v.indexOf("."); if (i !== -1) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, "").slice(0, 2);
    e.target.value = v;
  });

  $("move-form").addEventListener("submit", (e) => {
    e.preventDefault(); formError("");
    const mode = S.mode, a = selAcc();
    const amount = $("amount").value.trim(), num = parseFloat(amount);
    const p = { mode, account_id: a ? a.id : 0, amount, note: $("note").value.trim(), to: MODES[mode].to ? $("to-number").value.trim() : "", freq: $("sched-freq").value, date: $("sched-date").value };
    if (!a) return formError("Choose an account first.");
    if (a.status === "frozen") return formError("This account is frozen. Unfreeze it under Security first.");
    if (!(num > 0)) return formError("Enter an amount greater than zero.");
    if ((mode === "transfer" || mode === "withdraw") && num > a.balance) return formError("That is more than the available balance.");
    if (mode === "transfer" || mode === "schedule") {
      if (!/^VL\d{10}$/.test(p.to)) return formError("Enter the full receiving account number, like VL0123456789.");
      if (!S.verify || S.verify.number !== p.to) return formError("We couldn't verify that account number. Check it and try again.");
      if (S.verify.number === a.account_number) return formError("Choose a different receiving account.");
    }
    if (mode === "schedule" && (!p.date || p.date < todayUTC())) return formError("Choose a first payment date from today onwards.");
    if (mode === "deposit") return execute(p);

    const f = { once: "Just once", weekly: "Every week", monthly: "Every month" };
    let html = kv("From", `${esc(accName(a))}<br><span class="font-normal text-on-surface-variant">${esc(a.account_number)}</span>`);
    if (p.to) html += kv("To", `${esc(S.verify.holder)}<br><span class="font-normal text-on-surface-variant">${esc(p.to)}</span>`);
    html += kv("Amount", `<span class="font-display text-lg">${money(num)}</span>`);
    if (mode === "schedule") html += kv("Repeat", f[p.freq]) + kv("First payment", fmtDay(p.date));
    if (p.note) html += kv("Note", esc(p.note));
    html += `<p class="mt-3 text-sm text-on-surface-variant">${mode === "withdraw" ? "The money leaves this account straight away." : "We'll check this payment for fraud first. Large or unusual payments may be held for review."}</p>`;
    openModal({
      title: mode === "schedule" ? "Confirm schedule" : mode === "withdraw" ? "Confirm withdrawal" : "Confirm payment", html,
      actions: [
        { label: mode === "schedule" ? "Schedule payment" : mode === "withdraw" ? "Withdraw money" : "Send money", cls: "btn-primary", onClick: (b) => { b.disabled = true; closeModal(); execute(p); } },
        { label: "Go back and edit", cls: "btn-soft", onClick: closeModal },
      ],
    });
  });

  async function execute(p) {
    const btn = $("move-submit"), label = btn.textContent;
    btn.disabled = true; btn.textContent = "Processing...";
    try {
      let r;
      if (p.mode === "transfer") r = await api("/transfer", { method: "POST", body: { from_account_id: p.account_id, to_account_number: p.to, amount: p.amount, note: p.note } });
      else if (p.mode === "schedule") r = await api("/scheduled", { method: "POST", body: { from_account_id: p.account_id, to_account_number: p.to, amount: p.amount, note: p.note, frequency: p.freq, start_date: p.date } });
      else r = await api("/" + p.mode, { method: "POST", body: { account_id: p.account_id, amount: p.amount, note: p.note } });
      toast(r.message, r.status === "blocked" || r.flagged ? "warn" : "ok");
      if (p.mode === "transfer" && !$("save-payee-wrap").classList.contains("hidden") && $("save-payee").checked) {
        try { await api("/payees", { method: "POST", body: { name: $("payee-name").value.trim() || S.verify.holder, account_number: p.to } }); toast("Recipient saved"); await loadPayees(); }
        catch (err) { toast(err.message, "error"); }
      }
      $("amount").value = ""; $("note").value = ""; $("to-number").value = ""; onToInput();
      await refresh(false);
      if (p.mode === "schedule") loadScheduled();
    } catch (err) {
      formError(err.message); toast(err.message, "error");
    } finally {
      btn.disabled = false; btn.textContent = label;
    }
  }

  /* ---------- clicks ---------- */
  document.addEventListener("click", async (e) => {
    const go = e.target.closest("[data-go]");
    if (go) {
      show(go.dataset.go);
      if (go.dataset.mode) setMode(go.dataset.mode);
      if (go.dataset.acc) { $("acc-select").value = go.dataset.acc; updateAvail(); }
      return;
    }
    const fo = e.target.closest("[data-focus]");
    if (fo) { const el = $(fo.dataset.focus); el.scrollIntoView({ behavior: "smooth", block: "center" }); el.focus(); return; }
    if (e.target.closest("[data-onb-hide]")) { localStorage.setItem("vl_onb_hide", "1"); return renderOnboarding(); }
    const mode = e.target.closest("#view-move [data-mode]");
    if (mode) return setMode(mode.dataset.mode);
    const tx = e.target.closest("[data-tx]");
    if (tx) return showReceipt(tx.dataset.tx);

    const payee = e.target.closest("[data-payee]");
    if (payee) { if (S.mode !== "transfer" && S.mode !== "schedule") setMode("transfer"); $("to-number").value = payee.dataset.payee; onToInput(); return $("amount").focus(); }
    const psend = e.target.closest("[data-payee-send]");
    if (psend) { setMode("transfer"); $("to-number").value = psend.dataset.payeeSend; onToInput(); window.scrollTo({ top: 0, behavior: "smooth" }); return $("amount").focus(); }
    const pdel = e.target.closest("[data-payee-del]");
    if (pdel) {
      if (!confirm("Remove this saved recipient?")) return;
      try { await api("/payees/" + pdel.dataset.payeeDel, { method: "DELETE" }); toast("Recipient removed"); await loadPayees(); } catch (err) { toast(err.message, "error"); }
      return;
    }
    const sc = e.target.closest("[data-sched-cancel]");
    if (sc) {
      if (!confirm("Cancel this scheduled payment?")) return;
      try { await api("/scheduled/" + sc.dataset.schedCancel, { method: "DELETE" }); toast("Scheduled payment cancelled"); await loadScheduled(); } catch (err) { toast(err.message, "error"); }
      return;
    }

    const add = e.target.closest("[data-add]");
    if (add) {
      if (add.dataset.add === "max") { const a = selAcc(); if (a) $("amount").value = a.balance.toFixed(2); }
      else $("amount").value = ((parseFloat($("amount").value) || 0) + Number(add.dataset.add)).toFixed(2);
      return;
    }
    const tp = e.target.closest("[data-type]");
    if (tp) { S.type = tp.dataset.type; document.querySelectorAll("[data-type]").forEach((b) => b.setAttribute("aria-pressed", String(b === tp))); return renderActivity(); }
    const ap = e.target.closest("[data-astatus]");
    if (ap) { S.astatus = ap.dataset.astatus; document.querySelectorAll("[data-astatus]").forEach((b) => b.setAttribute("aria-pressed", String(b === ap))); return renderAlerts(); }
    const at = e.target.closest("[data-atab]");
    if (at) { S.atab = at.dataset.atab; document.querySelectorAll("[data-atab]").forEach((b) => b.setAttribute("aria-pressed", String(b === at))); return loadAdmin(); }

    const copy = e.target.closest("[data-copy]");
    if (copy) {
      try { await navigator.clipboard.writeText(copy.dataset.copy); toast("Account number copied"); }
      catch { toast("Copy failed. Select the number and copy it manually.", "error"); }
      return;
    }
    const rn = e.target.closest("[data-rename]");
    if (rn) {
      const name = prompt("Account name (up to 30 characters)", rn.dataset.name || "");
      if (name === null) return;
      try { await api(`/accounts/${rn.dataset.rename}/rename`, { method: "POST", body: { nickname: name } }); toast("Account renamed"); await refresh(false); }
      catch (err) { toast(err.message, "error"); }
      return;
    }
    const fz = e.target.closest("[data-freeze]");
    if (fz) {
      fz.disabled = true;
      try {
        await api(`/accounts/${fz.dataset.freeze}/freeze`, { method: "POST", body: { frozen: fz.dataset.to === "1" } });
        toast(fz.dataset.to === "1" ? "Account frozen" : "Account unfrozen"); await refresh(false);
      } catch (err) { toast(err.message, "error"); fz.disabled = false; }
      return;
    }
    const rv = e.target.closest("[data-review]");
    if (rv) {
      rv.disabled = true;
      try {
        await api(`/admin/alerts/${rv.dataset.id}`, { method: "POST", body: { status: rv.dataset.review } });
        toast({ confirmed: "Marked as fraud. The account is frozen.", released: "Payment released.", rejected: "Payment rejected. No money moved.", dismissed: "Alert dismissed." }[rv.dataset.review]);
        await refresh(false);
      } catch (err) { toast(err.message, "error"); rv.disabled = false; }
      return;
    }
    const ul = e.target.closest("[data-unlock]");
    if (ul) { try { await api(`/admin/users/${ul.dataset.unlock}/unlock`, { method: "POST" }); toast("Customer unlocked"); loadAdmin(); } catch (err) { toast(err.message, "error"); } return; }
    const uf = e.target.closest("[data-ufreeze]");
    if (uf) {
      const freezing = uf.dataset.to === "1";
      if (!confirm(freezing ? "Freeze all of this customer's accounts?" : "Unfreeze this customer's accounts?")) return;
      try { await api(`/admin/users/${uf.dataset.ufreeze}/freeze`, { method: "POST", body: { frozen: freezing } }); toast(freezing ? "Accounts frozen" : "Accounts unfrozen"); loadAdmin(); } catch (err) { toast(err.message, "error"); }
    }
  });

  $("open-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await api("/accounts", { method: "POST", body: { type: $("new-type").value, nickname: $("new-name").value } }); $("new-name").value = ""; toast("Account opened"); await refresh(false); }
    catch (err) { toast(err.message, "error"); }
  });
  $("acc-select").addEventListener("change", updateAvail);
  $("search").addEventListener("input", renderActivity);
  $("filter-acc").addEventListener("change", renderActivity);
  $("load-more").addEventListener("click", async () => {
    const btn = $("load-more"); btn.disabled = true;
    try {
      const before = S.txs[S.txs.length - 1].id;
      const r = await api("/transactions?limit=50&before_id=" + before);
      S.extra = S.extra.concat(r.transactions); S.extraNext = r.next_before; S.txs = S.page1.concat(S.extra);
      renderActivity();
    } catch (err) { toast(err.message, "error"); } finally { btn.disabled = false; }
  });

  /* ---------- security center ---------- */
  const EVENT_LABEL = {
    login: ["Signed in", "login"], login_failed: ["Failed sign-in attempt", "warning"], register: ["Account created", "person_add"],
    password_changed: ["Password changed", "key"], sessions_revoked: ["Signed out of all devices", "devices"],
    freeze_all: ["All accounts frozen", "ac_unit"], unfreeze_all: ["All accounts unfrozen", "lock_open"],
  };
  async function loadEvents() {
    try {
      const d = await api("/security/activity");
      $("events").innerHTML = d.events.length ? d.events.map((ev) => {
        const [text, icon] = EVENT_LABEL[ev.action] || [ev.action, "info"];
        return `<div class="py-3 flex items-center gap-3"><span class="material-symbols-outlined ${ev.action === "login_failed" ? "text-error" : "text-primary"}">${icon}</span>
          <div class="min-w-0"><p class="font-semibold text-sm">${esc(text)}</p><p class="text-xs text-on-surface-variant truncate">${when(ev.created_at)}${ev.ip ? " \u00b7 " + esc(ev.ip) : ""}</p></div></div>`;
      }).join("") : empty("history", "No activity yet.");
    } catch { /* ignore */ }
  }
  $("freeze-all").addEventListener("click", async (e) => {
    const freezing = e.currentTarget.dataset.to === "1";
    if (freezing && !confirm("Freeze every account? Payments in and out will stop until you unfreeze.")) return;
    try { await api("/accounts/freeze-all", { method: "POST", body: { frozen: freezing } }); toast(freezing ? "All accounts frozen" : "All accounts unfrozen"); await refresh(false); loadEvents(); }
    catch (err) { toast(err.message, "error"); }
  });
  $("pw-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const r = await api("/security/password", { method: "POST", body: { current_password: $("pw-current").value, new_password: $("pw-new").value } });
      setToken(r.token); $("pw-current").value = ""; $("pw-new").value = ""; toast(r.message); loadEvents();
    } catch (err) { toast(err.message, "error"); }
  });
  $("profile-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await api("/profile", { method: "POST", body: { full_name: $("profile-name").value } }); toast("Name updated"); await refresh(false); }
    catch (err) { toast(err.message, "error"); }
  });
  $("revoke").addEventListener("click", async () => {
    if (!confirm("Sign out of every other device?")) return;
    try { const r = await api("/security/revoke-sessions", { method: "POST" }); setToken(r.token); toast("Signed out of all other devices"); loadEvents(); }
    catch (err) { toast(err.message, "error"); }
  });
  $("st-download").addEventListener("click", async () => {
    const id = $("filter-acc").value;
    if (!id) return toast("Choose an account above to download its statement.", "error");
    const q = new URLSearchParams({ account_id: id });
    if ($("st-from").value) q.set("from", $("st-from").value);
    if ($("st-to").value) q.set("to", $("st-to").value);
    try {
      const res = await fetch("/api/statement?" + q, { headers: { Authorization: "Bearer " + getToken() } });
      if (!res.ok) { let m = "Could not create the statement."; try { m = (await res.json()).error || m; } catch { /* ignore */ } throw new Error(m); }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a"); const acc = S.me.accounts.find((x) => String(x.id) === id);
      a.href = url; a.download = `vaultline-statement-${acc ? acc.account_number : id}.csv`;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
      toast("Statement downloaded");
    } catch (err) { toast(err.message, "error"); }
  });

  /* ---------- admin ---------- */
  async function loadAdmin() {
    if (!S.me || S.me.user.role !== "admin") return;
    ["alerts", "users", "audit"].forEach((t) => $("atab-" + t).classList.toggle("hidden", t !== S.atab));
    try {
      const d = await api("/admin/overview");
      const s = d.stats;
      const stat = (label, val, icon) => `<div class="bg-surface-container-lowest rounded-xl shadow-sm p-4"><p class="flex items-center gap-1.5 text-sm text-on-surface-variant"><span class="material-symbols-outlined text-[18px] text-primary">${icon}</span>${label}</p><p class="font-display font-semibold text-xl mt-1 break-words">${val}</p></div>`;
      $("admin-stats").innerHTML = stat("Customers", s.users, "group") + stat("Accounts", s.accounts, "account_balance") + stat("Payments", s.transactions, "receipt_long") +
        stat("Volume", money(s.volume), "payments") + stat("Held", s.blocked, "pan_tool") + stat("Open alerts", s.open_alerts, "notifications");
      $("admin-alerts").innerHTML = d.alerts.length ? d.alerts.map((a) => {
        const [cls, text, icon] = STATUS[a.status];
        const actions = a.status !== "open" ? "" : a.tx_status === "blocked"
          ? `<div class="mt-3 grid grid-cols-2 gap-2"><button class="btn btn-primary btn-sm" data-review="released" data-id="${a.id}" type="button">Release payment</button>
              <button class="btn btn-soft btn-sm" data-review="rejected" data-id="${a.id}" type="button">Reject payment</button>
              <button class="btn btn-danger btn-sm col-span-2" data-review="confirmed" data-id="${a.id}" type="button">Confirm fraud and freeze</button></div>`
          : `<div class="mt-3 grid grid-cols-2 gap-2"><button class="btn btn-soft btn-sm" data-review="dismissed" data-id="${a.id}" type="button">Dismiss</button>
              <button class="btn btn-danger btn-sm" data-review="confirmed" data-id="${a.id}" type="button">Confirm fraud and freeze</button></div>`;
        return `<div class="bg-surface-container-lowest rounded-xl shadow-sm p-4">
          <div class="flex items-start justify-between gap-3"><p class="font-semibold">${esc(a.reason)}</p>${chip(cls, text, icon)}</div>
          <p class="text-sm text-on-surface-variant mt-1">${esc(a.full_name)} (${esc(a.email)})</p>
          <p class="text-sm text-on-surface-variant">${a.amount ? money(a.amount) + " " + esc(a.kind) + " \u00b7 " : ""}${when(a.created_at)}</p>
          <div class="mt-2">${chip(a.risk_score >= 70 ? "chip-bad" : "chip-warn", "Risk " + a.risk_score + " / 100", "warning")}</div>${actions}</div>`;
      }).join("") : `<div class="bg-surface-container-lowest rounded-xl shadow-sm">${empty("verified_user", "No alerts yet.")}</div>`;
      $("admin-tx").innerHTML = d.recent.length ? d.recent.map((r) => `<div class="p-4 flex items-center justify-between gap-3">
        <div class="min-w-0"><p class="font-semibold capitalize truncate">${esc(r.kind)} ${r.from_number ? "from " + esc(r.from_number) : ""} ${r.to_number ? "to " + esc(r.to_number) : ""}</p>
        <p class="text-sm text-on-surface-variant">${when(r.created_at)} \u00b7 risk ${r.risk_score}</p></div>
        <div class="text-right shrink-0"><p class="font-display font-semibold">${money(r.amount)}</p>${r.status === "blocked" ? chip("chip-bad", "Held") : r.status === "rejected" ? chip("chip-muted", "Rejected") : ""}</div></div>`).join("") : empty("receipt_long", "No payments yet.");

      if (S.atab === "users") {
        const u = (await api("/admin/users")).users;
        $("atab-users").innerHTML = u.map((x) => {
          const allFrozen = x.accounts > 0 && x.frozen === x.accounts;
          return `<div class="bg-surface-container-lowest rounded-xl shadow-sm p-4">
            <div class="flex items-start justify-between gap-2"><div class="min-w-0"><p class="font-semibold truncate">${esc(x.full_name)}</p><p class="text-sm text-on-surface-variant truncate">${esc(x.email)}</p></div>
              <div class="flex gap-1 flex-wrap justify-end">${x.role === "admin" ? chip("chip-muted", "Admin") : ""}${x.locked ? chip("chip-bad", "Locked", "lock") : ""}</div></div>
            <p class="text-sm mt-2">${x.accounts} account${x.accounts === 1 ? "" : "s"} \u00b7 ${money(x.balance)}${x.frozen ? " \u00b7 " + x.frozen + " frozen" : ""}</p>
            <p class="text-xs text-on-surface-variant">Joined ${when(x.created_at)}</p>
            <div class="mt-3 grid grid-cols-2 gap-2">
              ${x.locked ? `<button class="btn btn-soft btn-sm" data-unlock="${x.id}" type="button">Unlock sign-in</button>` : ""}
              ${x.id !== S.me.user.id && x.accounts ? `<button class="btn ${allFrozen ? "btn-primary" : "btn-danger"} btn-sm" data-ufreeze="${x.id}" data-to="${allFrozen ? "0" : "1"}" type="button">${allFrozen ? "Unfreeze accounts" : "Freeze accounts"}</button>` : ""}
            </div></div>`;
        }).join("") || empty("group", "No customers yet.");
      } else if (S.atab === "audit") {
        const ev = (await api("/admin/audit")).events;
        $("atab-audit").innerHTML = ev.map((x) => `<div class="p-3 sm:p-4 flex items-start justify-between gap-3 text-sm">
          <div class="min-w-0"><p class="font-semibold capitalize">${esc(x.action.replace(/_/g, " "))}</p><p class="text-on-surface-variant truncate">${esc(x.email || "system")}${x.detail ? " \u00b7 " + esc(x.detail) : ""}</p></div>
          <div class="text-right text-xs text-on-surface-variant shrink-0">${when(x.created_at)}${x.ip ? "<br>" + esc(x.ip) : ""}</div></div>`).join("") || empty("history", "No events yet.");
      }
    } catch (err) { /* polled quietly */ }
  }

  /* ---------- start ---------- */
  $("sched-date").min = todayUTC(); $("sched-date").value = todayUTC();
  setMode("transfer");
  show("accounts");
  refresh(false);
  setInterval(() => { if (!document.hidden) refresh(true); }, 10000);
})();
