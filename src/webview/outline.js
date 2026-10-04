/* global webviewApi */

const api = typeof webviewApi !== 'undefined' ? webviewApi : (window.webviewApi || null);

let renderedNoteId = '';
let renderedBodyLength = -1;
let allHeadings = [];
let isAllCollapsed = false;
let activeHeadingId = null;

function getTreeContainer() {
  return document.getElementById('outline-tree');
}
function getSearchInput() {
  return document.getElementById('search-input');
}
function getSearchContainer() {
  return document.getElementById('search-container');
}

function setDirection(isRtl) {
  const dir = isRtl ? 'rtl' : 'ltr';
  document.body.setAttribute('dir', dir);
  const container = document.getElementById('outline-container');
  if (container) container.setAttribute('dir', dir);
}

function normalizeForSearch(str) {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[يى]/g, 'ی')
    .replace(/[ك]/g, 'ک')
    .replace(/[ة]/g, 'ه')
    .toLowerCase()
    .trim();
}

function countTotalHeadings(nodes) {
  let count = 0;
  for (const n of nodes) {
    count += 1;
    if (n.children && n.children.length > 0) {
      count += countTotalHeadings(n.children);
    }
  }
  return count;
}

function initEventHandlers() {
  const searchToggleBtn = document.getElementById('search-toggle-btn');
  const searchContainer = getSearchContainer();
  const searchInput = getSearchInput();
  const searchClearBtn = document.getElementById('search-clear-btn');
  const collapseAllBtn = document.getElementById('collapse-all-btn');
  const closePanelBtn = document.getElementById('close-panel-btn');

  if (closePanelBtn && !closePanelBtn.dataset.bound) {
    closePanelBtn.dataset.bound = 'true';
    closePanelBtn.addEventListener('click', () => {
      if (api && api.postMessage) {
        api.postMessage({ type: 'closePanel' });
      }
    });
  }

  if (searchToggleBtn && !searchToggleBtn.dataset.bound) {
    searchToggleBtn.dataset.bound = 'true';
    searchToggleBtn.addEventListener('click', () => {
      searchContainer.classList.toggle('is-visible');
      if (searchContainer.classList.contains('is-visible')) {
        searchInput.focus();
      } else {
        searchInput.value = '';
        renderTree(allHeadings);
      }
    });
  }

  if (searchInput && !searchInput.dataset.bound) {
    searchInput.dataset.bound = 'true';
    searchInput.addEventListener('input', () => {
      const query = searchInput.value.trim();
      if (searchClearBtn) searchClearBtn.style.display = query ? 'block' : 'none';
      renderTree(allHeadings, query);
    });
  }

  if (searchClearBtn && !searchClearBtn.dataset.bound) {
    searchClearBtn.dataset.bound = 'true';
    searchClearBtn.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      searchClearBtn.style.display = 'none';
      renderTree(allHeadings);
      if (searchInput) searchInput.focus();
    });
  }

  if (collapseAllBtn && !collapseAllBtn.dataset.bound) {
    collapseAllBtn.dataset.bound = 'true';
    collapseAllBtn.addEventListener('click', () => {
      isAllCollapsed = !isAllCollapsed;
      const treeItems = document.querySelectorAll('.tree-item');
      treeItems.forEach((item) => {
        if (item.querySelector('.tree-item-children')) {
          item.classList.toggle('is-collapsed', isAllCollapsed);
        }
      });
    });
  }
}

function createNodeElement(node, searchQuery) {
  const item = document.createElement('div');
  item.className = 'tree-item';
  item.id = node.id;
  item.setAttribute('data-level', node.level);

  const self = document.createElement('div');
  self.className = 'tree-item-self';
  self.setAttribute('data-level', node.level);

  if (activeHeadingId === node.id) {
    self.classList.add('is-active');
  }

  const icon = document.createElement('div');
  icon.className = 'collapse-icon';
  if (!node.children || node.children.length === 0) {
    icon.classList.add('is-hidden');
  }
  icon.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="6 9 12 15 18 9"></polyline>
    </svg>`;

  icon.addEventListener('click', (e) => {
    e.stopPropagation();
    item.classList.toggle('is-collapsed');
  });

  const inner = document.createElement('bdi');
  inner.className = 'tree-item-inner';
  inner.title = `${node.text} (H${node.level})`;

  if (searchQuery) {
    const normText = normalizeForSearch(node.text);
    const normQuery = normalizeForSearch(searchQuery);
    const matchIndex = normText.indexOf(normQuery);

    if (matchIndex !== -1) {
      const matchLength = searchQuery.length;
      inner.innerHTML = `${node.text.slice(0, matchIndex)}<span class="highlight-match">${node.text.slice(matchIndex, matchIndex + matchLength)}</span>${node.text.slice(matchIndex + matchLength)}`;
    } else {
      inner.textContent = node.text;
    }
  } else {
    inner.textContent = node.text;
  }

  self.addEventListener('click', () => {
    document.querySelectorAll('.tree-item-self.is-active').forEach((el) => el.classList.remove('is-active'));
    self.classList.add('is-active');
    activeHeadingId = node.id;

    if (api && api.postMessage) {
      api.postMessage({
        type: 'jumpToHeading',
        line: node.line,
        slug: node.slug,
      });
    }
  });

  self.appendChild(icon);
  self.appendChild(inner);
  item.appendChild(self);

  if (node.children && node.children.length > 0) {
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'tree-item-children';
    for (const child of node.children) {
      childrenContainer.appendChild(createNodeElement(child, searchQuery));
    }
    item.appendChild(childrenContainer);
  }

  return item;
}

function renderTree(headings, query = '') {
  initEventHandlers();
  const treeContainer = getTreeContainer();
  const searchInput = getSearchInput();
  if (!treeContainer) return;

  treeContainer.innerHTML = '';

  const totalCount = countTotalHeadings(headings || []);
  if (searchInput && !query) {
    searchInput.placeholder = totalCount > 0 ? `Filter ${totalCount} headings...` : 'Filter headings...';
  }

  if (!headings || headings.length === 0) {
    treeContainer.innerHTML = '<div class="outline-status">No headings found in this note</div>';
    return;
  }

  const normalizedQuery = normalizeForSearch(query);

  function filterNodes(nodes) {
    const filtered = [];
    for (const n of nodes) {
      const match = normalizeForSearch(n.text).includes(normalizedQuery);
      const childMatches = filterNodes(n.children || []);
      if (match || childMatches.length > 0) {
        filtered.push({ ...n, children: childMatches });
      }
    }
    return filtered;
  }

  const nodesToRender = query ? filterNodes(headings) : headings;
  if (nodesToRender.length === 0) {
    treeContainer.innerHTML = '<div class="outline-status">No matching headings found</div>';
    return;
  }

  for (const node of nodesToRender) {
    treeContainer.appendChild(createNodeElement(node, query));
  }
}

async function syncOutline(force = false) {
  if (!api || !api.postMessage) return;

  try {
    const data = await api.postMessage({
      type: 'pollNote',
      clientNoteId: renderedNoteId,
      clientBodyLength: renderedBodyLength,
      force: force,
    });

    if (data && data.changed) {
      renderedNoteId = data.noteId;
      renderedBodyLength = data.bodyLength !== undefined ? data.bodyLength : -1;
      activeHeadingId = null;

      if (data.isMobile) {
        document.body.classList.add('is-mobile');
      }

      setDirection(data.isRtl);
      allHeadings = data.headings || [];

      const searchInput = getSearchInput();
      renderTree(allHeadings, searchInput ? searchInput.value.trim() : '');
    }
  } catch (err) {}
}

if (api && api.onMessage) {
  api.onMessage((msg) => {
    if (msg.type === 'noteSwitched') {
      syncOutline(true);
    }
  });
}

syncOutline(true);

setInterval(() => {
  syncOutline(false);
}, 350);
