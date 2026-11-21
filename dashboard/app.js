// Token Radar dashboard. Reads window.TOKEN_RADAR (zz-data.js), renders the
// board, a per-protocol detail view, and filtered views — all offline.
// Routes: #/ board, #/protocol/<slug> detail, #/filter/<status>/<category>.
(function () {
  "use strict";
  var DATA = window.TOKEN_RADAR || { rows: [], watchlist: [], as_of: "" };
  var ROWS = DATA.rows || [];
  var BY_SLUG = {};
  ROWS.forEach(function (r) { BY_SLUG[r.slug] = r; });

  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function money(n) {
    if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
    return "$" + Math.round(n).toLocaleString("en-US");
  }
  function pct(c) {
    if (c === null || c === undefined) return "—";
    var cls = c >= 0 ? "up" : "down";
    return '<span class="' + cls + '">' + (c >= 0 ? "+" : "") + c.toFixed(1) + "%</span>";
  }

  // Header + stats + method line.
  var pre = ROWS.filter(function (r) { return r.status === "pre-token"; });
  var lau = ROWS.filter(function (r) { return r.status === "launched"; });
  var topValue = ROWS.length ? ROWS[0].value : 0;
  el("asof").innerHTML = "Snapshot <b>" + esc(DATA.as_of) + "</b><br>" +
    "Watchlist floor <b>$50M TVL</b>";
  el("methodText").textContent =
    "Implied value = TVL × 0.30 × growth (7d change, clamped −50%…+100%) × " +
    "age (days listed with no token, capped at 4 years) × breadth (chains, capped at 10).";
  el("stats").innerHTML =
    stat(pre.length, "pre-token protocols") +
    stat(lau.length, "tokens already trading") +
    stat((DATA.watchlist || []).length, "on the watchlist") +
    stat(money(topValue), "top implied value") +
    stat(ROWS.length, "protocols ranked");
  function stat(n, label) {
    return '<div class="stat"><div class="n">' + esc(n) + '</div><div class="l">' + esc(label) + "</div></div>";
  }

  // Category filter options.
  var cats = {};
  ROWS.forEach(function (r) { if (r.category) cats[r.category] = true; });
  var catSel = el("category");
  Object.keys(cats).sort().forEach(function (c) {
    var o = document.createElement("option");
    o.value = c; o.textContent = c; catSel.appendChild(o);
  });

  var state = { q: "", status: "all", category: "all", sort: "rank" };

  function currentRows() {
    var out = ROWS.filter(function (r) {
      if (state.status !== "all" && r.status !== state.status) return false;
      if (state.category !== "all" && r.category !== state.category) return false;
      if (state.q) {
        var q = state.q.toLowerCase();
        if (r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      }
      return true;
    });
    var key = state.sort;
    out.sort(function (a, b) {
      if (key === "value") return b.value - a.value;
      if (key === "tvl") return b.tvl - a.tvl;
      if (key === "change") return (b.change_7d || 0) - (a.change_7d || 0);
      if (key === "age") return b.age_days - a.age_days;
      return a.rank - b.rank;
    });
    return out;
  }

  function renderBoard() {
    var rows = currentRows();
    var h = '<p class="count">' + rows.length + " of " + ROWS.length +
      " protocols — click a row for its detail view and farm plan.</p>";
    h += "<table><thead><tr>" +
      "<th data-sort='rank'>#</th><th>Protocol</th><th>Category</th><th>Chains</th>" +
      "<th class='num' data-sort='tvl'>TVL</th><th class='num' data-sort='change'>7d</th>" +
      "<th class='num' data-sort='age'>Days listed</th>" +
      "<th class='num' data-sort='value'>Implied value</th><th>Status</th>" +
      "</tr></thead><tbody>";
    rows.forEach(function (r) {
      var badge = r.status === "pre-token"
        ? '<span class="badge pre">Pre-token</span>'
        : '<span class="badge lau">Launched</span>';
      h += "<tr class='rowlink' data-slug='" + esc(r.slug) + "'>" +
        "<td>" + r.rank + "</td>" +
        '<td class="namecell"><b>' + esc(r.name) + "</b><span>" + esc(r.slug) + "</span></td>" +
        "<td>" + esc(r.category || "—") + "</td>" +
        "<td>" + esc((r.chains || []).join(", ")) + "</td>" +
        '<td class="num">' + money(r.tvl) + "</td>" +
        '<td class="num">' + pct(r.change_7d) + "</td>" +
        '<td class="num">' + r.age_days + "</td>" +
        '<td class="num"><b>' + money(r.value) + "</b></td>" +
        "<td>" + badge + "</td></tr>";
    });
    h += "</tbody></table>";
    if (!rows.length) h = '<p class="empty">No protocols match this filter.</p>';
    el("view").innerHTML = h;
    el("view").querySelectorAll("tr.rowlink").forEach(function (tr) {
      tr.addEventListener("click", function () {
        location.hash = "#/protocol/" + tr.getAttribute("data-slug");
      });
    });
    el("view").querySelectorAll("th[data-sort]").forEach(function (th) {
      th.addEventListener("click", function () {
        state.sort = th.getAttribute("data-sort");
        el("sort").value = state.sort;
        renderBoard();
      });
    });
  }

  function renderDetail(slug) {
    var r = BY_SLUG[slug];
    if (!r) {
      el("view").innerHTML = '<p class="empty">Unknown protocol: ' + esc(slug) + "</p>";
      return;
    }
    var watch = (DATA.watchlist || []).indexOf(slug) >= 0;
    var badge = r.status === "pre-token"
      ? '<span class="badge pre">Pre-token — records no token</span>'
      : '<span class="badge lau">Token already trades</span>';
    var steps = (r.farm_steps || []).map(function (s) {
      return "<li>" + esc(s) + "</li>";
    }).join("");
    var h = '<a class="back" href="#/">← Back to the board</a><div class="detail">' +
      "<h2>" + esc(r.name) + "</h2>" +
      '<p class="meta">' + esc(r.slug) + " · " + esc(r.category || "Uncategorised") +
      " · " + esc((r.chains || []).join(", ")) +
      (watch ? " · <b>On the watchlist</b>" : "") + " · Rank #" + r.rank + "</p>" +
      '<div class="grid">' +
      cell(money(r.value), "Implied value") +
      cell(money(r.tvl), "TVL") +
      cell(r.change_7d === null ? "—" : (r.change_7d >= 0 ? "+" : "") + r.change_7d.toFixed(2) + "%", "TVL change, 7d") +
      cell(String(r.age_days), "Days listed, no token") +
      cell(r.mcap === null ? "—" : money(r.mcap), "Token market cap") +
      cell(r.symbol || "—", "Token symbol") +
      "</div>" +
      '<div class="modelbox"><h3>Why this value</h3>' +
      "<p>TVL <b>" + money(r.tvl) + "</b> × growth <b>" + r.growth.toFixed(2) +
      "</b> × age <b>" + r.age_factor.toFixed(2) + "</b> × breadth <b>" +
      r.chain_factor.toFixed(2) + "</b> × 0.30 = <b>" + money(r.value) + "</b>.</p>" +
      "<p>Growth comes from the 7-day TVL change; age from days since listing with no token recorded; " +
      "breadth from the number of chains. " +
      (r.status === "launched"
        ? "This protocol's token already trades, so its band value is its market cap rescaled below every pre-token protocol."
        : "This protocol records no token, so it is ranked as a launch candidate.") +
      "</p></div>" +
      '<div class="steps"><h3>Farm plan — what to do, what it costs, how long it takes</h3><ol>' +
      steps + "</ol></div></div>";
    el("view").innerHTML = h;
  }
  function cell(v, k) {
    return '<div class="cell"><div class="v">' + esc(v) + '</div><div class="k">' + esc(k) + "</div></div>";
  }

  function route() {
    var hash = location.hash || "#/";
    var m = hash.match(/^#\/protocol\/([\w-]+)/);
    if (m) { renderDetail(m[1]); return; }
    var f = hash.match(/^#\/filter\/([\w-]+)\/(.+)$/);
    if (f) {
      state.status = decodeURIComponent(f[1]);
      state.category = decodeURIComponent(f[2]);
      el("status").value = state.status;
      el("category").value = state.category;
      renderBoard();
      return;
    }
    renderBoard();
  }

  el("q").addEventListener("input", function (e) { state.q = e.target.value; renderBoard(); });
  el("status").addEventListener("change", function (e) {
    state.status = e.target.value;
    location.hash = "#/filter/" + encodeURIComponent(state.status) + "/" + encodeURIComponent(state.category);
    renderBoard();
  });
  el("category").addEventListener("change", function (e) {
    state.category = e.target.value;
    location.hash = "#/filter/" + encodeURIComponent(state.status) + "/" + encodeURIComponent(state.category);
    renderBoard();
  });
  el("sort").addEventListener("change", function (e) { state.sort = e.target.value; renderBoard(); });
  window.addEventListener("hashchange", route);
  route();
})();
