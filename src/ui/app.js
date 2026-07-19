// serve-md browser app — vanilla JS, no build step.

const MAX_SCORE = 1_000_000;

function score(query, target) {
  if (query.length === 0) return 1;
  if (target.length === 0) return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0, ti = 0, total = 0, lastMatchTi = -2, consecutive = 0;
  while (qi < q.length && ti < t.length) {
    if (q[qi] === t[ti]) {
      const isBoundary = ti === 0 || isSep(t[ti - 1]);
      const isLeading = ti === 0;
      const isAfterSep = lastMatchTi === ti - 1;
      if (isAfterSep) {
        consecutive++;
        total += 10 + consecutive * 5;
      } else {
        consecutive = 0;
        total += 10;
        if (isLeading) total += 50;
        if (isBoundary) total += 30;
      }
      lastMatchTi = ti;
      qi++;
    }
    ti++;
  }
  if (qi < q.length) return 0;
  total += Math.max(0, MAX_SCORE - target.length * 100);
  return total;
}
function isSep(ch) {
  return ch === "/" || ch === "-" || ch === "_" || ch === " " || ch === ".";
}
function filterFuzzy(items, query, limit = 100) {
  if (query.length === 0) return items.slice(0, limit);
  const out = [];
  for (const item of items) {
    const s = Math.max(score(query, item.path), score(query, item.label));
    if (s > 0) out.push({ item, s });
  }
  out.sort((a, b) => b.s - a.s);
  return out.slice(0, limit).map((x) => x.item);
}

// ---------- App state ----------
const state = {
  files: [], // [{relativePath, basename, humanizedLabel, kind, ...}]
  tree: null, // tree root
  selectedPath: null, // currently open file
  mode: "search", // "search" | "browse"
  theme: localStorage.getItem("serve-md-theme") || "light",
};

// ---------- Theme ----------
document.documentElement.setAttribute("data-theme", state.theme);
document.getElementById("theme-toggle").addEventListener("click", () => {
  state.theme = state.theme === "light" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", state.theme);
  localStorage.setItem("serve-md-theme", state.theme);
});

// ---------- Mode toggle ----------
const modeSearch = document.getElementById("mode-search");
const modeBrowse = document.getElementById("mode-browse");
const paneSearch = document.getElementById("search-pane");
const paneBrowse = document.getElementById("browse-pane");

function setMode(mode) {
  state.mode = mode;
  const isSearch = mode === "search";
  modeSearch.classList.toggle("active", isSearch);
  modeBrowse.classList.toggle("active", !isSearch);
  modeSearch.setAttribute("aria-selected", String(isSearch));
  modeBrowse.setAttribute("aria-selected", String(!isSearch));
  paneSearch.classList.toggle("hidden", !isSearch);
  paneBrowse.classList.toggle("hidden", isSearch);
}
modeSearch.addEventListener("click", () => setMode("search"));
modeBrowse.addEventListener("click", () => setMode("browse"));

// ---------- Data fetch ----------
async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return await res.json();
}

async function refreshLists() {
  try {
    const [files, tree] = await Promise.all([
      fetchJson("/api/files"),
      fetchJson("/api/tree"),
    ]);
    state.files = files.data;
    state.tree = tree.data;
    renderSearch();
    renderTree();
  } catch (e) {
    showError(`Failed to load file list: ${e.message}`);
  }
}

// ---------- Search pane ----------
const searchInput = document.getElementById("search-input");
const searchList = document.getElementById("search-list");
const searchEmpty = document.getElementById("search-empty");

function renderSearch() {
  const q = searchInput.value;
  const items = state.files.map((f) => ({
    path: f.relativePath,
    label: f.humanizedLabel,
    kind: f.kind,
  }));
  const filtered = filterFuzzy(items, q, 200);
  searchList.innerHTML = "";
  if (filtered.length === 0) {
    searchEmpty.classList.remove("hidden");
    return;
  }
  searchEmpty.classList.add("hidden");
  for (const it of filtered) {
    const li = document.createElement("li");
    li.textContent = it.label;
    li.dataset.path = it.path;
    if (it.path === state.selectedPath) li.classList.add("selected");
    li.addEventListener("click", () => openFile(it.path));
    searchList.appendChild(li);
  }
}
searchInput.addEventListener("input", renderSearch);

// ---------- Browse pane ----------
const browseTree = document.getElementById("browse-tree");
const browseEmpty = document.getElementById("browse-empty");

function renderTree() {
  browseTree.innerHTML = "";
  if (!state.tree || !state.tree.children || state.tree.children.length === 0) {
    browseEmpty.classList.remove("hidden");
    return;
  }
  browseEmpty.classList.add("hidden");
  // Skip root — show its children at top level
  for (const child of state.tree.children) {
    browseTree.appendChild(renderNode(child));
  }
}
function renderNode(node) {
  if (node.type === "file") {
    const el = document.createElement("a");
    el.className = "file";
    el.textContent = node.humanizedLabel || node.name;
    el.dataset.path = node.relativePath;
    if (node.relativePath === state.selectedPath) el.classList.add("selected");
    el.addEventListener("click", (e) => {
      e.preventDefault();
      openFile(node.relativePath);
    });
    return el;
  }
  // dir
  const det = document.createElement("details");
  if (state.selectedPath && state.selectedPath.startsWith(node.relativePath + "/")) {
    det.open = true;
  }
  const sum = document.createElement("summary");
  sum.textContent = node.name;
  det.appendChild(sum);
  for (const child of node.children || []) {
    det.appendChild(renderNode(child));
  }
  return det;
}

// ---------- Content view ----------
const contentHost = document.getElementById("content-host");

function showError(message) {
  contentHost.innerHTML = "";
  const el = document.createElement("div");
  el.className = "error-panel";
  el.textContent = message;
  contentHost.appendChild(el);
}

async function openFile(path) {
  state.selectedPath = path;
  // update selection highlight
  for (const li of searchList.querySelectorAll("li")) {
    li.classList.toggle("selected", li.dataset.path === path);
  }
  for (const a of browseTree.querySelectorAll(".file")) {
    a.classList.toggle("selected", a.dataset.path === path);
  }
  contentHost.innerHTML = "";

  let meta;
  try {
    const res = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `${res.status}`);
    }
    const body = await res.json();
    meta = body.data;
  } catch (e) {
    showError(`Failed to open: ${e.message}`);
    return;
  }

  if (meta.largeFile) {
    const warn = document.createElement("div");
    warn.className = "warning-banner";
    warn.textContent = `This file is larger than 2MB (${
      (meta.size / 1024 / 1024).toFixed(2)
    } MB). Rendering may be slow.`;
    contentHost.appendChild(warn);
  }

  if (meta.kind === "html") {
    const iframe = document.createElement("iframe");
    iframe.src = `/content/${meta.relativePath}`;
    iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");
    contentHost.appendChild(iframe);
  } else {
    // markdown or plain
    const wrap = document.createElement("div");
    wrap.className = "markdown-body";
    if (meta.html) {
      wrap.innerHTML = meta.html;
    } else if (meta.text) {
      wrap.textContent = meta.text;
    } else {
      wrap.textContent = "";
    }
    contentHost.appendChild(wrap);
  }
}

// ---------- Boot ----------
async function boot() {
  await refreshLists();
  // Check meta for watch availability
  let watchEnabled = false;
  try {
    const res = await fetch("/api/meta");
    if (res.ok) {
      const body = await res.json();
      watchEnabled = Boolean(body.data?.watch);
    }
  } catch {
    // ignore
  }
  if (watchEnabled) {
    setupSSE();
  }
  // Try to open default file
  try {
    const res = await fetch("/api/default-file");
    const body = await res.json();
    const path = body.data.path;
    if (path) {
      openFile(path);
    }
  } catch {
    // ignore
  }
}

function setupSSE() {
  try {
    const es = new EventSource("/api/events");
    es.addEventListener("reload", () => {
      // Re-fetch lists and re-open current file
      const current = state.selectedPath;
      refreshLists().then(() => {
        if (current) openFile(current);
      });
    });
    es.onerror = () => {
      // Try to reconnect after a delay
      es.close();
      setTimeout(setupSSE, 2000);
    };
  } catch {
    // SSE not supported; ignore
  }
}

boot();
