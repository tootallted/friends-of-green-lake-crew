// Friends of Green Lake Crew — shared page behavior.
// Renders the cause picker + give panel from causes.js / payment.js,
// and the RAC exec team roster from team.js.

(function () {
  function el(tag, className, html) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function initCausePicker() {
    var grid = document.getElementById("cause-grid");
    var panel = document.getElementById("give-panel");
    if (!grid || !panel || !window.FOGLC_CAUSES) return;

    var causes = window.FOGLC_CAUSES;

    causes.forEach(function (cause, i) {
      var wrap = el("div", "cause-card");
      var input = document.createElement("input");
      input.type = "radio";
      input.name = "cause";
      input.id = "cause-" + cause.id;
      input.value = cause.id;
      if (i === 0) input.checked = true;

      var label = document.createElement("label");
      label.setAttribute("for", "cause-" + cause.id);
      label.innerHTML =
        '<span class="cause-name">' + cause.name + '<span class="cause-check"></span></span>' +
        '<p class="cause-blurb">' + cause.blurb + "</p>";

      wrap.appendChild(input);
      wrap.appendChild(label);
      grid.appendChild(wrap);

      input.addEventListener("change", function () {
        if (input.checked) updateGivePanel(cause);
      });
    });

    updateGivePanel(causes[0]);
  }

  function updateGivePanel(cause) {
    var selectedEl = document.getElementById("give-selected-cause");
    if (selectedEl) selectedEl.textContent = cause.name;

    var noteEl = document.getElementById("give-note-text");
    var noteText = "FOGLC – " + cause.name;
    if (noteEl) {
      noteEl.textContent =
        'Add this note to your payment so it reaches the right fund: "' + noteText + '"';
    }

    var pay = window.FOGLC_PAYMENT || {};

    var venmoBtn = document.getElementById("venmo-pay-btn");
    if (venmoBtn && pay.venmo) {
      if (pay.venmo.configured) {
        var handle = (pay.venmo.handle || "").replace(/^@/, "");
        venmoBtn.href =
          "https://venmo.com/" + encodeURIComponent(handle) +
          "?txn=pay&note=" + encodeURIComponent(noteText);
      } else {
        venmoBtn.removeAttribute("href");
      }
    }
  }

  function initCopyButtons() {
    document.querySelectorAll("[data-copy]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var text = btn.getAttribute("data-copy");
        var feedback = btn.parentElement.querySelector(".copy-feedback");
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () {
            if (feedback) {
              feedback.textContent = "Copied!";
              setTimeout(function () { feedback.textContent = ""; }, 1800);
            }
          });
        }
      });
    });
  }

  function initPaymentPanel() {
    var pay = window.FOGLC_PAYMENT;
    if (!pay) return;

    if (pay.paypal) {
      var paypalLink = document.getElementById("paypal-pay-btn");
      var paypalHandle = document.getElementById("paypal-handle");
      if (paypalHandle) paypalHandle.textContent = pay.paypal.display;
      if (paypalLink) {
        if (!pay.paypal.configured) {
          paypalLink.setAttribute("disabled", "disabled");
          paypalLink.removeAttribute("href");
        } else {
          paypalLink.href = pay.paypal.url;
        }
      }
    }

    if (pay.venmo) {
      var venmoHandleEl = document.getElementById("venmo-handle");
      if (venmoHandleEl) venmoHandleEl.textContent = pay.venmo.handle;
      var venmoBtn = document.getElementById("venmo-pay-btn");
      if (venmoBtn && !pay.venmo.configured) {
        venmoBtn.setAttribute("disabled", "disabled");
      }
    }

    if (pay.zelle) {
      var zelleHandleEl = document.getElementById("zelle-handle");
      if (zelleHandleEl) zelleHandleEl.textContent = pay.zelle.handle;
    }

    document.querySelectorAll(".setup-flag[data-if-unconfigured]").forEach(function (flag) {
      var key = flag.getAttribute("data-if-unconfigured");
      if (pay[key] && pay[key].configured) {
        flag.style.display = "none";
      }
    });
  }

  function initTeamRoster() {
    var list = document.getElementById("team-list");
    if (!list || !window.FOGLC_RAC_TEAM) return;

    window.FOGLC_RAC_TEAM.forEach(function (person) {
      var initials = (person.name || "")
        .replace(/REPLACE_WITH_NAME/i, "?")
        .split(/\s+/)
        .map(function (p) { return p.charAt(0); })
        .join("")
        .slice(0, 2)
        .toUpperCase();

      var card = el("div", "team-card");
      card.innerHTML =
        '<div class="team-avatar">' + (initials || "?") + "</div>" +
        '<div class="team-info">' +
        '<div class="team-name">' + person.name + "</div>" +
        '<div class="team-role">' + person.role + "</div>" +
        '<a class="team-email" href="mailto:' + person.email + '">' + person.email + "</a>" +
        "</div>";
      list.appendChild(card);
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initCausePicker();
    initPaymentPanel();
    initCopyButtons();
    initTeamRoster();
  });
})();
