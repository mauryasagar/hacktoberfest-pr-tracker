const GOAL = 4;
const USERNAME_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;

const form = document.getElementById("tracker-form");
const usernameInput = document.getElementById("username");
const excludeOwn = document.getElementById("exclude-own");
const trackBtn = document.getElementById("track-btn");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const progressLabel = document.getElementById("progress-label");
const progressFill = document.getElementById("progress-fill");
const progressTrack = document.querySelector(".progress-track");
const completeBanner = document.getElementById("complete-banner");
const prList = document.getElementById("pr-list");
const statMerged = document.getElementById("stat-merged");
const statOpen = document.getElementById("stat-open");
const statClosed = document.getElementById("stat-closed");
const themeToggle = document.getElementById("theme-toggle");
const themeLabel = themeToggle.querySelector(".theme-label");

let lastItems = null;
let lastUsername = "";
let lastYear = new Date().getFullYear();

function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === "light"
    ? "light"
    : "dark";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const next = theme === "dark" ? "light" : "dark";
  themeToggle.setAttribute("aria-label", `Switch to ${next} mode`);
  themeLabel.textContent = theme === "dark" ? "Dark" : "Light";
  try {
    localStorage.setItem("hf-theme", theme);
  } catch (err) {
    // Ignore storage failures (private mode).
  }
}

applyTheme(currentTheme());

themeToggle.addEventListener("click", () => {
  applyTheme(currentTheme() === "dark" ? "light" : "dark");
});

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function showStatus(message, kind) {
  statusEl.hidden = false;
  statusEl.className = `status${kind ? ` ${kind}` : ""}`;
  statusEl.innerHTML = message;
}

function hideStatus() {
  statusEl.hidden = true;
  statusEl.textContent = "";
  statusEl.className = "status";
}

function setLoading(isLoading) {
  trackBtn.disabled = isLoading;
  usernameInput.disabled = isLoading;
  if (isLoading) {
    resultsEl.hidden = true;
    showStatus('<span class="spinner" aria-hidden="true"></span>Looking up pull requests…');
  }
}

function octoberRange(year) {
  return `${year}-10-01..${year}-10-31`;
}

function repoFromUrl(repositoryUrl) {
  if (!repositoryUrl) return "unknown/repo";
  const parts = repositoryUrl.split("/");
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

function repoOwner(repositoryUrl) {
  if (!repositoryUrl) return "";
  const parts = repositoryUrl.split("/");
  return parts[parts.length - 2] || "";
}

function prState(item) {
  const mergedAt = item.pull_request && item.pull_request.merged_at;
  if (mergedAt) return "merged";
  return item.state === "open" ? "open" : "closed";
}

function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function isRateLimited(response, payload) {
  if (response.status === 429) return true;
  if (response.status === 403) return true;
  const remaining = response.headers.get("x-ratelimit-remaining");
  if (remaining === "0") return true;
  const message = (payload && payload.message) || "";
  return /rate limit/i.test(message);
}

function isUnknownAuthor(payload) {
  const errors = (payload && payload.errors) || [];
  return errors.some((error) => {
    const message = (error && error.message) || "";
    return /listed users and repositories cannot be searched/i.test(message);
  });
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
    },
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch (err) {
    payload = null;
  }

  return { response, payload };
}

async function userExists(username) {
  const { response, payload } = await fetchJson(
    `https://api.github.com/users/${encodeURIComponent(username)}`
  );

  if (response.status === 404) return { exists: false, rateLimited: false };
  if (isRateLimited(response, payload)) {
    return { exists: null, rateLimited: true };
  }
  if (!response.ok) {
    throw new Error((payload && payload.message) || "Could not verify that GitHub user.");
  }
  return { exists: true, rateLimited: false };
}

function animateNumber(el, target) {
  const duration = 600;
  const start = performance.now();
  function tick(now) {
    const t = Math.min((now - start) / duration, 1);
    el.textContent = String(Math.round(target * t));
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function renderProgress(count) {
  const capped = Math.min(count, GOAL);
  const percent = Math.round((capped / GOAL) * 100);
  progressLabel.textContent = `${count}/4 PRs done`;
  progressFill.style.width = "0%";
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      progressFill.style.width = `${percent}%`;
    });
  });
  progressFill.classList.toggle("complete", count >= GOAL);
  progressTrack.setAttribute("aria-valuenow", String(capped));
  completeBanner.hidden = count < GOAL;
}

function renderStats(items) {
  const counts = { merged: 0, open: 0, closed: 0 };
  items.forEach((item) => {
    counts[prState(item)] += 1;
  });
  animateNumber(statMerged, counts.merged);
  animateNumber(statOpen, counts.open);
  animateNumber(statClosed, counts.closed);
}

function renderPrs(items) {
  prList.innerHTML = items
    .map((item, index) => {
      const state = prState(item);
      const repo = repoFromUrl(item.repository_url);
      const title = escapeHtml(item.title || "Untitled pull request");
      const url = escapeHtml(item.html_url || "#");
      const date = escapeHtml(formatDate(item.created_at));
      return `
        <li class="pr-card ${state}" style="--i:${index}">
          <a class="pr-title" href="${url}" target="_blank" rel="noopener noreferrer">${title}</a>
          <div class="pr-meta">
            <span class="pr-repo">${escapeHtml(repo)}</span>
            <span class="badge ${state}">${state}</span>
            <time datetime="${escapeHtml(item.created_at)}">${date}</time>
          </div>
        </li>
      `;
    })
    .join("");
}

function renderAll(username, items, year) {
  const filtered = excludeOwn.checked
    ? items.filter(
        (item) => repoOwner(item.repository_url).toLowerCase() !== username.toLowerCase()
      )
    : items;

  if (filtered.length === 0) {
    resultsEl.hidden = true;
    showStatus(
      `Found ${items.length} PR${items.length === 1 ? "" : "s"} for ${escapeHtml(
        username
      )} in October ${year}, but all are on their own repos. Uncheck the filter to see them, or contribute to someone else's repo.`,
      "empty"
    );
    return;
  }

  // Hacktoberfest counts open and merged PRs, not ones closed without merging.
  const valid = filtered.filter((item) => prState(item) !== "closed").length;

  hideStatus();
  resultsEl.hidden = false;
  renderProgress(valid);
  renderStats(filtered);
  renderPrs(filtered);
}

async function trackUsername(rawUsername) {
  const username = rawUsername.trim().replace(/^@/, "");

  if (!USERNAME_PATTERN.test(username)) {
    resultsEl.hidden = true;
    showStatus("Enter a valid GitHub username.", "error");
    return;
  }

  const year = new Date().getFullYear();
  const query = `author:${username}+type:pr+created:${octoberRange(year)}`;
  const searchUrl = `https://api.github.com/search/issues?q=${query}&per_page=100`;

  setLoading(true);

  try {
    const { response, payload } = await fetchJson(searchUrl);

    if (isRateLimited(response, payload)) {
      resultsEl.hidden = true;
      showStatus(
        "GitHub API rate limit reached. Unauthenticated search is limited — wait a few minutes and try again.",
        "error"
      );
      return;
    }

    if (response.status === 422 || isUnknownAuthor(payload)) {
      resultsEl.hidden = true;
      showStatus(`GitHub user “${escapeHtml(username)}” was not found.`, "error");
      return;
    }

    if (!response.ok) {
      resultsEl.hidden = true;
      showStatus(
        escapeHtml((payload && payload.message) || "Could not fetch pull requests from GitHub."),
        "error"
      );
      return;
    }

    const items = Array.isArray(payload.items) ? payload.items : [];
    const total = typeof payload.total_count === "number" ? payload.total_count : items.length;

    if (total === 0) {
      const user = await userExists(username);
      if (user.rateLimited) {
        resultsEl.hidden = true;
        showStatus(
          "GitHub API rate limit reached. Unauthenticated search is limited — wait a few minutes and try again.",
          "error"
        );
        return;
      }
      if (!user.exists) {
        resultsEl.hidden = true;
        showStatus(`GitHub user “${escapeHtml(username)}” was not found.`, "error");
        return;
      }
      resultsEl.hidden = true;
      showStatus(
        `No pull requests found for ${escapeHtml(username)} in October ${year}.`,
        "empty"
      );
      return;
    }

    lastItems = items;
    lastUsername = username;
    lastYear = year;
    renderAll(username, items, year);
  } catch (err) {
    resultsEl.hidden = true;
    showStatus("Network error while talking to GitHub. Check your connection and try again.", "error");
  } finally {
    setLoading(false);
    if (!statusEl.hidden && statusEl.textContent.includes("Looking up")) {
      hideStatus();
    }
  }
}

excludeOwn.addEventListener("change", () => {
  if (lastItems) renderAll(lastUsername, lastItems, lastYear);
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  trackUsername(usernameInput.value);
});