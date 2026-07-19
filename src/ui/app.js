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

// ---------- App state ----------
const state = {
  files: [], // [{relativePath, basename, humanizedLabel, kind, ...}]
  tree: null, // tree root
  selectedPath: null, // currently open file
  theme: localStorage.getItem("serve-md-theme") || "light",
};

// ---------- Theme ----------
const themeIcon = document.getElementById("theme-icon");
function updateThemeIcon() {
  if (state.theme === "dark") {
    // Sun icon
    themeIcon.innerHTML =
      '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>';
  } else {
    // Moon icon
    themeIcon.innerHTML = '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>';
  }
}
document.documentElement.setAttribute("data-theme", state.theme);
updateThemeIcon();
document.getElementById("theme-toggle").addEventListener("click", () => {
  state.theme = state.theme === "light" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", state.theme);
  // Switch highlight.js theme
  const hljsLink = document.getElementById("hljs-theme");
  hljsLink.href = state.theme === "dark" ? "/ui/hljs-dark.css" : "/ui/hljs-light.css";
  updateThemeIcon();
  localStorage.setItem("serve-md-theme", state.theme);
  // Reinitialize mermaid with new theme
  if (typeof mermaid !== "undefined") {
    mermaid.initialize({
      startOnLoad: false,
      theme: state.theme === "dark" ? "dark" : "default",
    });
    // Re-render all mermaid diagrams with new theme
    const diagrams = document.querySelectorAll(".mermaid-diagram");
    diagrams.forEach(async (diagram) => {
      const pre = diagram.querySelector("pre.mermaid-original");
      if (pre) {
        const code = pre.textContent || "";
        const isFullscreen = diagram.classList.contains("mermaid-fullscreen");
        try {
          const newDiagram = await createMermaidDiagram(code);
          diagram.replaceWith(newDiagram);
          if (isFullscreen) {
            newDiagram.classList.add("mermaid-fullscreen");
            if (document.fullscreenElement) {
              newDiagram.requestFullscreen?.();
            }
          }
        } catch (e) {
          console.warn("mermaid re-render error:", e);
        }
      }
    });
  }
});

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
    renderTree();
  } catch (e) {
    showError(`Failed to load file list: ${e.message}`);
  }
}

// ---------- Browse pane with search filter ----------
const searchInput = document.getElementById("search-input");
const browseTree = document.getElementById("browse-tree");
const browseEmpty = document.getElementById("browse-empty");

// SVG icons for file types
const FILE_ICONS = {
  markdown:
    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/><line x1="10" x2="8" y1="9" y2="9"/></svg>',
  html:
    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="9" x2="15" y1="13" y2="13"/><line x1="9" x2="15" y1="17" y2="17"/></svg>',
  plain:
    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>',
};

function getFileIcon(kind) {
  return FILE_ICONS[kind] || FILE_ICONS.plain;
}

function renderTree() {
  browseTree.innerHTML = "";
  if (!state.tree || !state.tree.children || state.tree.children.length === 0) {
    browseEmpty.classList.remove("hidden");
    return;
  }
  browseEmpty.classList.add("hidden");

  const query = searchInput.value.trim().toLowerCase();

  // Skip root — show its children at top level
  for (const child of state.tree.children) {
    const node = buildNode(child, query);
    if (node) browseTree.appendChild(node);
  }
}

/**
 * Build a tree node. Returns null if the node (and all descendants) don't match the query.
 */
function buildNode(node, query) {
  if (node.type === "file") {
    // Match against basename only
    const basename = node.name.replace(/\.[^.]+$/, "");
    if (query && score(query, basename) <= 0) return null;

    const el = document.createElement("a");
    el.className = "file";
    el.innerHTML = `${getFileIcon(node.kind || "plain")}<span>${node.name}</span>`;
    el.dataset.path = node.relativePath;
    if (node.relativePath === state.selectedPath) el.classList.add("selected");
    el.addEventListener("click", (e) => {
      e.preventDefault();
      openFile(node.relativePath);
    });
    return el;
  }

  // Directory: recursively build children, filter out empty dirs
  const children = [];
  for (const child of node.children || []) {
    const built = buildNode(child, query);
    if (built) children.push(built);
  }

  // If no children match and the dir itself doesn't match, skip it
  if (children.length === 0) return null;

  const det = document.createElement("details");
  // Auto-open if query matches or if a descendant is selected
  if (query || (state.selectedPath && state.selectedPath.startsWith(node.relativePath + "/"))) {
    det.open = true;
  }
  const sum = document.createElement("summary");
  // Folder icon
  sum.innerHTML =
    `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-1.5"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>${node.name}`;
  det.appendChild(sum);
  for (const child of children) {
    det.appendChild(child);
  }
  return det;
}

searchInput.addEventListener("input", renderTree);

// ---------- Content view ----------
const contentHost = document.getElementById("content-host");

function showError(message) {
  contentHost.innerHTML = "";
  const el = document.createElement("div");
  el.className = "error-panel";
  el.textContent = message;
  contentHost.appendChild(el);
}

/** Render frontmatter metadata as a styled HTML block. */
function renderFrontmatter(fm) {
  const fields = [];
  const order = ["title", "date", "author", "tags", "category", "description"];
  // Render known fields first in order
  for (const key of order) {
    if (key in fm) {
      fields.push({ key, value: fm[key] });
    }
  }
  // Then render remaining fields
  for (const key of Object.keys(fm)) {
    if (!order.includes(key)) {
      fields.push({ key, value: fm[key] });
    }
  }

  const items = fields.map(({ key, value }) => {
    const displayValue = Array.isArray(value)
      ? value.map((v) => `<span class="frontmatter-tag">${escapeHtmlStr(v)}</span>`).join("")
      : escapeHtmlStr(String(value));
    return `<div class="frontmatter-item"><span class="frontmatter-key">${
      capitalize(key)
    }</span><span class="frontmatter-value">${displayValue}</span></div>`;
  }).join("");

  return `<div class="frontmatter">${items}</div>`;
}

function escapeHtmlStr(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(
    /"/g,
    "&quot;",
  );
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Render mermaid diagrams in the content area. */
async function renderMermaid() {
  if (typeof mermaid === "undefined") {
    // Mermaid not loaded yet, wait and retry
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (typeof mermaid === "undefined") {
      console.warn("mermaid library not loaded");
      return;
    }
  }
  const diagrams = document.querySelectorAll(".markdown-body pre.mermaid");
  if (diagrams.length === 0) return;
  try {
    for (const pre of diagrams) {
      const code = pre.textContent || "";
      const container = await createMermaidDiagram(code);
      pre.replaceWith(container);
    }
  } catch (e) {
    console.warn("mermaid render error:", e);
  }
}

/** Create a fully wired mermaid diagram container from source code. */
async function createMermaidDiagram(code) {
  const { svg } = await mermaid.render("mermaid-" + Math.random().toString(36).slice(2), code);

  // Create a container with the original code stored for theme switching
  const container = document.createElement("div");
  container.className = "mermaid-diagram";

  // Store original code in a hidden pre for theme switching
  const originalPre = document.createElement("pre");
  originalPre.className = "mermaid-original";
  originalPre.style.display = "none";
  originalPre.textContent = code;
  container.appendChild(originalPre);

  container.innerHTML += svg;

  // Wrap SVG in a transformable viewport for pan/zoom
  const viewport = document.createElement("div");
  viewport.className = "mermaid-viewport";
  const svgEl = container.querySelector("svg");
  if (svgEl) {
    viewport.appendChild(svgEl);
    container.appendChild(viewport);
  }

  // Store pan/zoom state on the container
  attachPanZoom(viewport);

  // Add fullscreen button
  const fsBtn = document.createElement("button");
  fsBtn.className = "mermaid-fullscreen-btn";
  fsBtn.title = "Fullscreen";
  fsBtn.innerHTML =
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="2" x2="6" y2="4"/><line x1="18" y1="2" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="22"/><line x1="18" y1="20" x2="18" y2="22"/></svg>`;
  fsBtn.addEventListener("click", () => toggleFullscreen(container));
  container.appendChild(fsBtn);

  // Add reset button for pan/zoom
  const resetBtn = document.createElement("button");
  resetBtn.className = "mermaid-reset-btn";
  resetBtn.title = "Reset view";
  resetBtn.innerHTML =
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h18M12 3v18"/><circle cx="12" cy="12" r="10"/></svg>`;
  resetBtn.addEventListener("click", () => {
    if (viewport._panZoomState) {
      viewport._panZoomState.scale = 1;
      viewport._panZoomState.x = 0;
      viewport._panZoomState.y = 0;
      applyPanZoomTransform(viewport);
    }
  });
  container.appendChild(resetBtn);

  return container;
}

/** Attach pan/zoom mouse interactions to a mermaid viewport. */
function attachPanZoom(viewport) {
  const state = { scale: 1, x: 0, y: 0 };
  viewport._panZoomState = state;
  let dragging = false;
  let start = { x: 0, y: 0 };

  viewport.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(0.1, Math.min(5, state.scale * zoomFactor));
    // Zoom towards mouse pointer
    state.x = mouseX - (mouseX - state.x) * (newScale / state.scale);
    state.y = mouseY - (mouseY - state.y) * (newScale / state.scale);
    state.scale = newScale;
    applyPanZoomTransform(viewport);
  }, { passive: false });

  viewport.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    dragging = true;
    start = { x: e.clientX - state.x, y: e.clientY - state.y };
    viewport.style.cursor = "grabbing";
  });

  globalThis.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    state.x = e.clientX - start.x;
    state.y = e.clientY - start.y;
    applyPanZoomTransform(viewport);
  });

  globalThis.addEventListener("mouseup", () => {
    dragging = false;
    viewport.style.cursor = "grab";
  });

  viewport.style.cursor = "grab";
}

function applyPanZoomTransform(viewport) {
  const state = viewport._panZoomState;
  if (!state) return;
  viewport.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
  viewport.style.transformOrigin = "0 0";
}

/** Toggle fullscreen for a mermaid diagram. */
function toggleFullscreen(container) {
  if (!document.fullscreenElement) {
    container.requestFullscreen?.() || container.webkitRequestFullscreen?.() ||
      container.msRequestFullscreen?.();
    container.classList.add("mermaid-fullscreen");
  } else {
    document.exitFullscreen?.() || document.webkitExitFullscreen?.() ||
      document.msExitFullscreen?.();
    container.classList.remove("mermaid-fullscreen");
  }
}

// Handle fullscreen exit to clean up the class
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement) {
    document.querySelectorAll(".mermaid-diagram.mermaid-fullscreen").forEach((el) => {
      el.classList.remove("mermaid-fullscreen");
    });
  }
});

async function openFile(path, updateUrl = true) {
  state.selectedPath = path;
  // Re-render tree to update selection highlight
  renderTree();
  contentHost.innerHTML = "";

  // Sync path to URL so refresh stays on the same page
  if (updateUrl) {
    const url = new URL(globalThis.location.href);
    url.searchParams.set("file", path);
    history.pushState({ file: path }, "", url.toString());
  }

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

    // Render frontmatter as metadata
    if (meta.frontmatter && Object.keys(meta.frontmatter).length > 0) {
      const fmEl = document.createElement("div");
      fmEl.className = "frontmatter";
      const html = renderFrontmatter(meta.frontmatter);
      fmEl.innerHTML = html;
      contentHost.appendChild(fmEl);
    }

    if (meta.html) {
      wrap.innerHTML = meta.html;
      // Make internal links work with deep linking
      wrap.querySelectorAll('a[href^="/?file="]').forEach((a) => {
        a.addEventListener("click", (e) => {
          e.preventDefault();
          const fileParam = new URL(a.href).searchParams.get("file");
          if (fileParam) openFile(fileParam);
        });
      });
    } else if (meta.text) {
      wrap.textContent = meta.text;
    } else {
      wrap.textContent = "";
    }
    contentHost.appendChild(wrap);

    // Render mermaid diagrams
    renderMermaid();
  }
}

// ---------- Boot ----------
async function boot() {
  await refreshLists();

  // Check URL for file parameter (deep link / refresh)
  const urlParams = new URLSearchParams(globalThis.location.search);
  const fileParam = urlParams.get("file");
  if (fileParam) {
    openFile(fileParam, false);
  } else {
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

  // Handle back/forward navigation
  globalThis.addEventListener("popstate", (e) => {
    if (e.state?.file) {
      openFile(e.state.file, false);
    }
  });
}

boot();
