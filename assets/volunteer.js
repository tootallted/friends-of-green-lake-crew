// Friends of Green Lake Crew — volunteer sign-up page.
// Loads open slots from the Apps Script web app (see volunteer-config.js),
// lets a volunteer pick one or more non-overlapping slots, and submits them.

(function () {
  var cfg = window.FOGLC_VOLUNTEER || {};
  var demo = new URLSearchParams(window.location.search).get("demo") === "1";
  var configured = demo || (cfg.configured && /^https:\/\//.test(cfg.apiUrl || ""));
  var api = demo ? demoApi() : liveApi();
  var STORE_KEY = "foglc-volunteer-info";

  var state = {
    slots: [], byId: {}, selected: {}, mine: [], lookedUp: "",
    // ?role=Concessions pre-filters the list, so organizers can link to one job.
    role: new URLSearchParams(window.location.search).get("role") || ""
  };
  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function overlaps(a, b) {
    return a.startMs < b.endMs && b.startMs < a.endMs;
  }

  function isEmail(s) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
  }

  /* ---------- API ---------- */

  function liveApi() {
    function parse(r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }
    return {
      slots: function () { return fetch(cfg.apiUrl).then(parse); },
      // text/plain body keeps this a "simple" CORS request (no preflight),
      // which Apps Script web apps require.
      post: function (payload) {
        return fetch(cfg.apiUrl, { method: "POST", body: JSON.stringify(payload) }).then(parse);
      }
    };
  }

  function demoApi() {
    var base = new Date();
    base.setDate(base.getDate() + ((6 - base.getDay() + 7) % 7 || 7));
    function at(dayOffset, h, m) {
      var d = new Date(base);
      d.setDate(d.getDate() + dayOffset);
      d.setHours(h, m || 0, 0, 0);
      return d;
    }
    function fmt(d) {
      return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(":00", "");
    }
    var people = ["Alex Rivera", "Jordan Lee", "Sam Patel", "Casey Morgan"];
    function slot(id, role, day, sh, eh, cap, filled, location, description) {
      var s = at(day, sh), e = at(day, eh);
      return {
        id: id, role: role, startMs: +s, endMs: +e, capacity: cap, filled: filled,
        remaining: cap - filled, location: location, description: description,
        names: people.slice(0, filled),
        dateKey: s.toDateString(),
        dateLabel: s.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
        timeLabel: fmt(s) + " – " + fmt(e)
      };
    }
    var slots = [
      slot("D1", "Setup crew", 0, 7, 9, 4, 1, "Green Lake boathouse", "Tents, tables, and signage."),
      slot("D2", "Parking & traffic", 0, 7, 11, 2, 2, "North lot", "Safety vest provided."),
      slot("D3", "Concessions", 0, 9, 11, 3, 0, "Snack tent", ""),
      slot("D4", "Concessions", 0, 11, 13, 3, 1, "Snack tent", ""),
      slot("D5", "Finish-line timer", 0, 10, 12, 2, 0, "Finish dock", "Bring a phone with a stopwatch."),
      slot("D6", "Cleanup crew", 0, 13, 15, 5, 0, "Green Lake boathouse", ""),
      slot("D7", "Bake sale table", 1, 10, 12, 2, 0, "Boathouse lobby", "")
    ];
    var mine = {};
    function delay(v) { return new Promise(function (r) { setTimeout(function () { r(v); }, 450); }); }
    return {
      slots: function () { return delay({ ok: true, slots: slots }); },
      post: function (p) {
        if (p.action === "lookup") return delay({ ok: true, mySlotIds: mine[p.email.toLowerCase()] || [] });
        var list = mine[p.email.toLowerCase()] = (mine[p.email.toLowerCase()] || []).concat(p.slotIds);
        var picked = slots.filter(function (s) { return p.slotIds.indexOf(s.id) !== -1; });
        picked.forEach(function (s) { s.filled++; s.remaining--; s.names.push(p.firstName + " " + p.lastName); });
        return delay({ ok: true, signedUp: picked, mySlotIds: list, slots: slots });
      }
    };
  }

  /* ---------- Slot list ---------- */

  function setSlots(slots) {
    state.slots = slots || [];
    state.byId = {};
    state.slots.forEach(function (s) { state.byId[s.id] = s; });
    Object.keys(state.selected).forEach(function (id) {
      if (!state.byId[id]) delete state.selected[id];
    });
    renderSlots();
  }

  function renderSlots() {
    var list = $("slot-list");
    if (!state.slots.length) {
      list.innerHTML = '<div class="story-empty"><p class="story-empty-title">No open slots right now</p>' +
        "<p>Check back soon &mdash; new volunteer slots are added as events come up.</p></div>";
      renderRoleFilter();
      updateBar();
      return;
    }

    var html = "";
    var lastDay = null;
    state.slots.forEach(function (s) {
      if (s.dateKey !== lastDay) {
        if (lastDay !== null) html += "</div></div>";
        html += '<div class="slot-day-block"><h3 class="slot-day">' + esc(s.dateLabel) + '</h3><div class="slot-group">';
        lastDay = s.dateKey;
      }
      var meta = [s.location, s.description].filter(Boolean).map(esc).join(" &middot; ");
      html +=
        '<label class="slot" data-id="' + esc(s.id) + '">' +
        '<input type="checkbox" class="slot-check" value="' + esc(s.id) + '">' +
        '<span class="slot-box" aria-hidden="true"></span>' +
        '<span class="slot-time">' + esc(s.timeLabel) + "</span>" +
        '<span class="slot-main"><span class="slot-role">' + esc(s.role) + "</span>" +
        (meta ? '<span class="slot-meta">' + meta + "</span>" : "") +
        (s.names && s.names.length ? '<span class="slot-names"><span class="slot-names-label">Signed up:</span> ' +
          s.names.map(esc).join(", ") + "</span>" : "") +
        '<span class="slot-note"></span></span>' +
        '<span class="slot-spots"></span>' +
        "</label>";
    });
    html += "</div></div>";
    list.innerHTML = html;
    renderRoleFilter();
    refreshSlots();
  }

  /* ---------- Role filter ---------- */

  // Filled/total spots across a set of slots (a slot over capacity counts as full).
  function tally(slots) {
    return slots.reduce(function (t, s) {
      t.filled += Math.min(s.filled || 0, s.capacity);
      t.total += s.capacity;
      return t;
    }, { filled: 0, total: 0 });
  }

  function renderRoleFilter() {
    var bar = $("role-filter");
    var roles = [];
    var byRole = {};
    state.slots.forEach(function (s) {
      if (!byRole[s.role]) { byRole[s.role] = []; roles.push(s.role); }
      byRole[s.role].push(s);
    });
    roles.sort(function (a, b) { return a.localeCompare(b); });
    // Match a ?role= link case-insensitively; drop a filter whose role is gone.
    state.role = roles.filter(function (r) { return r.toLowerCase() === state.role.toLowerCase(); })[0] || "";
    state.tallies = { "": tally(state.slots) };
    roles.forEach(function (r) { state.tallies[r] = tally(byRole[r]); });

    if (!state.slots.length) {
      bar.style.display = "none";
      bar.innerHTML = "";
      return;
    }
    function chip(value, label) {
      var t = state.tallies[value];
      return '<button type="button" class="role-chip" data-role="' + esc(value) + '" aria-pressed="false"' +
        ' aria-label="' + esc(label) + ": " + t.filled + " of " + t.total + ' spots filled">' +
        esc(label) + ' <span class="role-chip-count">' + t.filled + "/" + t.total + "</span></button>";
    }
    bar.innerHTML =
      '<div class="fill-summary"><p class="fill-summary-text" id="fill-summary-text" aria-live="polite"></p>' +
      '<div class="fill-meter" aria-hidden="true"><span id="fill-meter-bar"></span></div></div>' +
      (roles.length < 2 ? "" :
        '<span class="role-filter-label" id="role-filter-label">Filter by role &middot; spots filled</span>' +
        '<div class="role-chips" role="group" aria-labelledby="role-filter-label">' +
        chip("", "All roles") +
        roles.map(function (r) { return chip(r, r); }).join("") +
        "</div>");
    bar.style.display = "block";
  }

  function applyRoleFilter() {
    document.querySelectorAll("#role-filter .role-chip").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-role") === state.role));
    });
    document.querySelectorAll("#slot-list .slot").forEach(function (row) {
      var s = state.byId[row.getAttribute("data-id")];
      row.hidden = !!state.role && s.role !== state.role;
    });
    document.querySelectorAll("#slot-list .slot-day-block").forEach(function (block) {
      block.hidden = !block.querySelector(".slot:not([hidden])");
    });

    var t = state.tallies && state.tallies[state.role];
    if (!t || !$("fill-summary-text")) return;
    $("fill-summary-text").innerHTML = "<strong>" + t.filled + " of " + t.total + "</strong> " +
      (state.role ? esc(state.role) + " " : "") + (t.total === 1 ? "spot" : "spots") + " filled" +
      (t.total > t.filled ? ' <span class="fill-open">&middot; ' + (t.total - t.filled) + " still open</span>" : "");
    $("fill-meter-bar").style.width = (t.total ? Math.round(100 * t.filled / t.total) : 0) + "%";
  }

  // Update each slot's checked/disabled state in place so keyboard focus survives.
  function refreshSlots() {
    var mineSlots = state.mine.map(function (id) { return state.byId[id]; }).filter(Boolean);
    var picked = Object.keys(state.selected).map(function (id) { return state.byId[id]; });

    document.querySelectorAll("#slot-list .slot").forEach(function (row) {
      var s = state.byId[row.getAttribute("data-id")];
      var box = row.querySelector("input");
      var note = row.querySelector(".slot-note");
      var spots = row.querySelector(".slot-spots");
      var isMine = state.mine.indexOf(s.id) !== -1;
      var isPicked = !!state.selected[s.id];
      var full = s.remaining <= 0;
      var clash = isMine || isPicked ? null :
        mineSlots.concat(picked).filter(function (o) { return o.id !== s.id && overlaps(o, s); })[0];

      box.checked = isMine || isPicked;
      box.disabled = isMine || (!isPicked && (full || !!clash));
      row.className = "slot" +
        (isMine ? " is-mine" : "") +
        (isPicked ? " is-picked" : "") +
        (box.disabled && !isMine ? " is-unavailable" : "");

      if (isMine) {
        spots.textContent = "You're in";
      } else if (full) {
        spots.textContent = "Full";
      } else {
        spots.textContent = s.remaining + " of " + s.capacity + " open";
      }
      note.textContent = clash && !full
        ? "Overlaps with " + clash.role + " (" + clash.timeLabel + ")"
        : "";
    });

    var mineNote = $("mine-note");
    if (mineSlots.length) {
      mineNote.textContent = "You're already signed up for " + mineSlots.length +
        (mineSlots.length === 1 ? " slot" : " slots") + " (marked below). Pick more if you like!";
      mineNote.style.display = "block";
    } else {
      mineNote.style.display = "none";
    }
    applyRoleFilter();
    updateBar();
  }

  function updateBar() {
    var n = Object.keys(state.selected).length;
    $("selected-count").textContent = n === 0 ? "Pick one or more slots" :
      n + (n === 1 ? " slot" : " slots") + " selected";
    $("submit-btn").disabled = n === 0 || !configured;
    $("action-bar").classList.toggle("has-selection", n > 0);
  }

  function loadSlots() {
    $("slot-list").innerHTML = '<p class="slot-loading">Loading volunteer slots&hellip;</p>';
    return api.slots().then(function (res) {
      if (!res.ok) throw new Error(res.error || "Could not load slots");
      setSlots(res.slots);
    }).catch(function () {
      $("slot-list").innerHTML = '<div class="story-empty"><p class="story-empty-title">We couldn\'t load the slots</p>' +
        '<p>Please refresh the page in a minute. Still stuck? Email <a href="mailto:' + esc(cfg.contactEmail) + '">' +
        esc(cfg.contactEmail) + "</a>.</p></div>";
    });
  }

  /* ---------- Volunteer info ---------- */

  function lookupMine() {
    var email = $("email").value.trim().toLowerCase();
    if (!configured || !isEmail(email) || email === state.lookedUp) return;
    state.lookedUp = email;
    api.post({ action: "lookup", email: email }).then(function (res) {
      if (state.lookedUp !== email || !res.ok) return;
      state.mine = res.mySlotIds || [];
      state.mine.forEach(function (id) { delete state.selected[id]; });
      refreshSlots();
    }).catch(function () {});
  }

  function saveInfo() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        firstName: $("first-name").value.trim(), lastName: $("last-name").value.trim(),
        email: $("email").value.trim(), phone: $("phone").value.trim()
      }));
    } catch (e) {}
  }

  function restoreInfo() {
    try {
      var info = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (!info) return;
      $("first-name").value = info.firstName || "";
      $("last-name").value = info.lastName || "";
      $("email").value = info.email || "";
      $("phone").value = info.phone || "";
    } catch (e) {}
  }

  function checkPhone() {
    var input = $("phone");
    var digits = input.value.replace(/\D/g, "");
    input.setCustomValidity(input.value && (digits.length < 10 || digits.length > 15)
      ? "Please enter a mobile number with area code." : "");
  }

  /* ---------- Submit ---------- */

  function showError(msg) {
    var el = $("form-error");
    el.textContent = msg;
    el.style.display = msg ? "block" : "none";
  }

  function onSubmit(e) {
    e.preventDefault();
    showError("");
    checkPhone();
    var form = $("vol-form");
    if (!form.reportValidity()) return;
    var slotIds = Object.keys(state.selected);
    if (!slotIds.length) return showError("Pick at least one slot to volunteer for.");

    var btn = $("submit-btn");
    btn.disabled = true;
    btn.textContent = "Signing you up…";

    api.post({
      action: "signup",
      firstName: $("first-name").value,
      lastName: $("last-name").value,
      email: $("email").value,
      phone: $("phone").value,
      website: $("website").value,
      slotIds: slotIds
    }).then(function (res) {
      if (!res.ok) {
        showError(res.error || "Something went wrong. Please try again.");
        if (res.refresh) {
          state.selected = {};
          loadSlots();
        }
        return;
      }
      saveInfo();
      state.selected = {};
      state.mine = res.mySlotIds || state.mine;
      state.lookedUp = $("email").value.trim().toLowerCase();
      if (res.slots) setSlots(res.slots);
      showSuccess(res.signedUp || []);
    }).catch(function () {
      showError("We couldn't reach the sign-up sheet. Check your connection and try again.");
    }).then(function () {
      btn.textContent = "Sign me up";
      updateBar();
    });
  }

  function showSuccess(slots) {
    $("success-name").textContent = $("first-name").value.trim();
    $("success-list").innerHTML = slots.map(function (s) {
      return "<li><strong>" + esc(s.role) + "</strong> &mdash; " + esc(s.dateLabel) + ", " + esc(s.timeLabel) +
        (s.location ? " &middot; " + esc(s.location) : "") + "</li>";
    }).join("");
    $("vol-form").style.display = "none";
    $("vol-success").style.display = "block";
    window.scrollTo({ top: $("vol-success").getBoundingClientRect().top + window.scrollY - 90, behavior: "smooth" });
  }

  function backToForm() {
    $("vol-success").style.display = "none";
    $("vol-form").style.display = "block";
    refreshSlots();
    $("slots-heading").scrollIntoView({ behavior: "smooth" });
  }

  /* ---------- Wire up ---------- */

  document.addEventListener("DOMContentLoaded", function () {
    if (demo) $("demo-banner").style.display = "block";
    restoreInfo();

    $("slot-list").addEventListener("change", function (e) {
      if (!e.target.classList.contains("slot-check")) return;
      if (e.target.checked) state.selected[e.target.value] = true;
      else delete state.selected[e.target.value];
      showError("");
      refreshSlots();
    });
    $("role-filter").addEventListener("click", function (e) {
      var chip = e.target.closest(".role-chip");
      if (!chip) return;
      state.role = chip.getAttribute("data-role");
      applyRoleFilter();
    });
    $("email").addEventListener("change", lookupMine);
    $("phone").addEventListener("input", checkPhone);
    $("vol-form").addEventListener("submit", onSubmit);
    $("another-btn").addEventListener("click", backToForm);

    if (!configured) {
      $("slot-list").innerHTML = '<div class="story-empty"><p class="story-empty-title">Volunteer sign-ups open soon</p>' +
        '<p>We\'re getting the sign-up sheet ready. Questions? Email <a href="mailto:' + esc(cfg.contactEmail) + '">' +
        esc(cfg.contactEmail) + "</a>.</p></div>";
      updateBar();
      return;
    }
    loadSlots().then(lookupMine);
  });
})();
