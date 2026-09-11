// Friends of Green Lake Crew — shared page behavior.
// Renders the cause list from causes.js, wires up the Givebutter
// donation links from payment.js, and the RAC exec team roster from team.js.

(function () {
  function el(tag, className, html) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function initCauseList() {
    var grid = document.getElementById("cause-grid");
    if (!grid || !window.FOGLC_CAUSES) return;

    window.FOGLC_CAUSES.forEach(function (cause) {
      var card = el("div", "cause-card");
      card.innerHTML =
        '<p class="cause-name">' + cause.name + "</p>" +
        '<p class="cause-blurb">' + cause.blurb + "</p>";
      grid.appendChild(card);
    });
  }

  function initGivebutterLinks() {
    var pay = window.FOGLC_PAYMENT;
    if (!pay || !pay.givebutter) return;

    document.querySelectorAll("[data-givebutter-link]").forEach(function (link) {
      if (pay.givebutter.configured) {
        link.href = pay.givebutter.url;
      } else {
        link.setAttribute("disabled", "disabled");
        link.removeAttribute("href");
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

  function initStories() {
    var grid = document.getElementById("story-grid");
    var empty = document.getElementById("story-empty");
    if (!grid) return;

    var stories = window.FOGLC_STORIES || [];

    if (stories.length === 0) {
      if (empty) empty.style.display = "block";
      return;
    }
    if (empty) empty.style.display = "none";

    stories.forEach(function (story) {
      var card = el("div", "story-card");
      card.innerHTML =
        '<p class="story-quote">“' + story.quote + '”</p>' +
        '<p class="story-attribution">' +
        '<span class="story-name">' + story.name + '</span>' +
        (story.relation ? '<span class="story-relation">' + story.relation + '</span>' : '') +
        '</p>';
      grid.appendChild(card);
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initCauseList();
    initGivebutterLinks();
    initTeamRoster();
    initStories();
  });
})();
