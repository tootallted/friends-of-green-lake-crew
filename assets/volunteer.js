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
      slot("D3", "Concessions", 0, 9, 11, 3, 2, "Snack tent", ""),
      slot("D4", "Concessions", 0, 11, 13, 3, 1, "Snack tent", ""),
      slot("D5", "Finish-line timer", 0, 10, 12, 2, 0, "Finish dock", "Bring a phone with a stopwatch."),
      slot("D6", "Cleanup crew", 0, 13, 15, 5, 0, "Green Lake boathouse", ""),
      slot("D7", "Bake sale table", 1, 10, 12, 2, 1, "Boathouse lobby", "")
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
      renderGantt();
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

  // Filter value for the "My slots" chip (shows only slots you're signed up for).
  var MINE = "::mine";

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
    if (state.role !== MINE) {
      state.role = roles.filter(function (r) { return r.toLowerCase() === state.role.toLowerCase(); })[0] || "";
    }
    state.roleCount = roles.length;
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
      '<div id="role-chips-wrap"><span class="role-filter-label" id="role-filter-label">Filter by role &middot; spots filled</span>' +
      '<div class="role-chips" role="group" aria-labelledby="role-filter-label">' +
      '<button type="button" class="role-chip role-chip-mine" data-role="' + MINE + '" aria-pressed="false" hidden>' +
      'My slots <span class="role-chip-count"></span></button>' +
      chip("", "All roles") +
      (roles.length < 2 ? "" : roles.map(function (r) { return chip(r, r); }).join("")) +
      "</div></div>";
    bar.style.display = "block";
  }

  function applyRoleFilter() {
    var mineIds = state.mine.filter(function (id) { return state.byId[id]; });
    if (state.role === MINE && !mineIds.length) state.role = "";
    var mineMode = state.role === MINE;

    // "My slots" only appears once we know this visitor's signups.
    var mineChip = document.querySelector("#role-filter .role-chip-mine");
    if (mineChip) {
      mineChip.hidden = !mineIds.length;
      mineChip.querySelector(".role-chip-count").textContent = mineIds.length;
    }
    var chipsWrap = $("role-chips-wrap");
    if (chipsWrap) chipsWrap.hidden = state.roleCount < 2 && !mineIds.length;

    document.querySelectorAll("#role-filter .role-chip").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-role") === state.role));
    });
    document.querySelectorAll("#slot-list .slot").forEach(function (row) {
      var s = state.byId[row.getAttribute("data-id")];
      row.hidden = mineMode ? mineIds.indexOf(s.id) === -1 : !!state.role && s.role !== state.role;
    });
    document.querySelectorAll("#slot-list .slot-day-block").forEach(function (block) {
      block.hidden = !block.querySelector(".slot:not([hidden])");
    });

    if (!$("fill-summary-text")) return;
    $("fill-meter-bar").parentNode.style.display = mineMode ? "none" : "";
    if (mineMode) {
      var days = mineIds.map(function (id) { return state.byId[id].dateKey; }).filter(function (d, i, a) { return a.indexOf(d) === i; });
      $("fill-summary-text").innerHTML = "<strong>Your plan:</strong> " + mineIds.length +
        (mineIds.length === 1 ? " slot" : " slots") + (days.length > 1 ? " across " + days.length + " days" : "") +
        ' <span class="fill-open">&middot; tap All roles to pick more</span>';
      return;
    }
    var t = state.tallies && state.tallies[state.role];
    if (!t) return;
    $("fill-summary-text").innerHTML = "<strong>" + t.filled + " of " + t.total + "</strong> " +
      (state.role ? esc(state.role) + " " : "") + (t.total === 1 ? "spot" : "spots") + " filled" +
      (t.total > t.filled ? ' <span class="fill-open">&middot; ' + (t.total - t.filled) + " still open</span>" : "");
    $("fill-meter-bar").style.width = (t.total ? Math.round(100 * t.filled / t.total) : 0) + "%";
  }

  /* ---------- Schedule chart (Gantt) ---------- */

  var LANE_PX = 34;

  // 0% red -> 50% yellow -> 90%+ green, as an HSL hue sweep.
  function fillColor(pct) {
    var p = Math.max(0, Math.min(1, pct));
    var hue = p >= 0.9 ? 130 : p <= 0.5 ? p / 0.5 * 50 : 50 + (p - 0.5) / 0.4 * 80;
    return "hsl(" + Math.round(hue) + ", 68%, 58%)";
  }

  function hourLabel(d) {
    var h = d.getHours();
    return (h % 12 || 12) + (h < 12 ? "a" : "p");
  }

  function renderGantt() {
    var section = $("gantt-section");
    var wrap = $("gantt");
    if (!state.slots.length) {
      section.style.display = "none";
      return;
    }

    var days = [];
    var byDay = {};
    state.slots.forEach(function (s) {
      if (!byDay[s.dateKey]) { byDay[s.dateKey] = []; days.push(s.dateKey); }
      byDay[s.dateKey].push(s);
    });

    wrap.innerHTML = days.map(function (key) {
      var slots = byDay[key];
      // Axis runs from the hour before the first start to the hour after the last end.
      var first = new Date(Math.min.apply(null, slots.map(function (s) { return s.startMs; })));
      first.setMinutes(0, 0, 0);
      var axisStart = +first;
      var lastEnd = Math.max.apply(null, slots.map(function (s) { return s.endMs; }));
      var hours = Math.max(1, Math.ceil((lastEnd - axisStart) / 3600000));
      var span = hours * 3600000;
      var pos = function (ms) { return ((ms - axisStart) / span * 100).toFixed(3) + "%"; };

      var ticks = "";
      for (var h = 0; h <= hours; h++) {
        var t = new Date(axisStart + h * 3600000);
        ticks += '<span class="gantt-tick" style="left:' + pos(+t) + '">' + hourLabel(t) + "</span>";
      }

      var roles = [];
      var byRole = {};
      slots.forEach(function (s) {
        if (!byRole[s.role]) { byRole[s.role] = []; roles.push(s.role); }
        byRole[s.role].push(s);
      });
      roles.sort(function (a, b) { return a.localeCompare(b); });

      var rows = roles.map(function (role) {
        // Stack slots of the same role that overlap into separate lanes.
        var laneEnds = [];
        var bars = byRole[role].slice().sort(function (a, b) { return a.startMs - b.startMs; }).map(function (s) {
          var lane = 0;
          while (laneEnds[lane] > s.startMs) lane++;
          laneEnds[lane] = s.endMs;
          var filled = Math.min(s.filled || 0, s.capacity);
          var pct = s.capacity ? filled / s.capacity : 1;
          var isMine = state.mine.indexOf(s.id) !== -1;
          var label = s.role + ", " + s.timeLabel + ": " + filled + " of " + s.capacity + " filled" +
            (s.names && s.names.length ? " (" + s.names.join(", ") + ")" : "");
          return '<button type="button" class="gantt-bar' + (isMine ? " is-mine" : "") + '" data-id="' + esc(s.id) + '"' +
            ' style="left:' + pos(s.startMs) + ";width:calc(" + ((s.endMs - s.startMs) / span * 100).toFixed(3) + "% - 4px);" +
            "top:" + (lane * LANE_PX + 4) + "px;background:" + fillColor(pct) + '"' +
            ' title="' + esc(label) + '" aria-label="' + esc(label) + '">' +
            filled + "/" + s.capacity + "</button>";
        }).join("");
        return '<div class="gantt-row"><div class="gantt-label">' + esc(role) + "</div>" +
          '<div class="gantt-track" style="height:' + (laneEnds.length * LANE_PX) + 'px">' + bars + "</div></div>";
      }).join("");

      return '<div class="gantt-day"><h3 class="slot-day">' + esc(slots[0].dateLabel) + "</h3>" +
        '<div class="gantt-scroll"><div class="gantt" style="--hours:' + hours + '">' +
        '<div class="gantt-row gantt-axis"><div class="gantt-label"></div><div class="gantt-track">' + ticks + "</div></div>" +
        rows + "</div></div></div>";
    }).join("");
    section.style.display = "block";
  }

  // Clicking a bar jumps to that slot in the list above.
  function onGanttClick(e) {
    var bar = e.target.closest(".gantt-bar");
    if (!bar) return;
    var id = bar.getAttribute("data-id");
    var s = state.byId[id];
    if (state.role && s && s.role !== state.role) {
      state.role = "";
      applyRoleFilter();
    }
    var row = Array.prototype.filter.call(document.querySelectorAll("#slot-list .slot"), function (r) {
      return r.getAttribute("data-id") === id;
    })[0];
    if (!row) return;
    if ($("vol-form").style.display === "none") backToForm();
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    row.classList.remove("is-flash");
    void row.offsetWidth;
    row.classList.add("is-flash");
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
        (mineSlots.length === 1 ? " slot" : " slots") + " (marked below). Tap “My slots” to see just your plan, or pick more!";
      mineNote.style.display = "block";
    } else {
      mineNote.style.display = "none";
    }
    applyRoleFilter();
    renderGantt();
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
        email: $("email").value.trim(), phone: $("phone").value.trim(),
        teams: teamBoxes().filter(function (b) { return b.checked; }).map(function (b) { return b.value; }),
        otherTeam: $("team-other-text").value.trim()
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
      teamBoxes().forEach(function (b) { b.checked = (info.teams || []).indexOf(b.value) !== -1; });
      $("team-other-text").value = info.otherTeam || "";
      syncOtherTeam();
    } catch (e) {}
  }

  /* ---------- Team checkboxes ---------- */

  function teamBoxes() {
    return Array.prototype.slice.call(document.querySelectorAll('input[name="team"]'));
  }

  // "Other" reveals a text box, which is then required.
  function syncOtherTeam() {
    var other = $("team-other-text");
    other.hidden = !$("team-other").checked;
    other.required = !other.hidden;
  }

  // At least one team is required; the message shows on the first checkbox.
  function checkTeams() {
    var any = teamBoxes().some(function (b) { return b.checked; });
    teamBoxes()[0].setCustomValidity(any ? "" : "Please pick at least one team.");
  }

  // e.g. ["Novice Girls", "Other: Alumni parent"]
  function selectedTeams() {
    return teamBoxes().filter(function (b) { return b.checked; }).map(function (b) {
      var other = $("team-other-text").value.trim();
      return b.value === "Other" && other ? "Other: " + other : b.value;
    });
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
    checkTeams();
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
      teams: selectedTeams(),
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
    $("gantt").addEventListener("click", onGanttClick);
    $("email").addEventListener("change", lookupMine);
    $("phone").addEventListener("input", checkPhone);
    teamBoxes().forEach(function (b) {
      b.addEventListener("change", function () { syncOtherTeam(); checkTeams(); });
    });
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
