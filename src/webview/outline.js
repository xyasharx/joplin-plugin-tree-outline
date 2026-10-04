/* global webviewApi */

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

function initEventHandlers() {
  const searchToggleBtn = document.getElementById('search-toggle-btn');
  const searchContainer = getSearchContainer();
  const searchInput = getSearchInput();
  const searchClearBtn = document.getElementById('search-clear-btn');
  const collapseAllBtn = document.getElementById('collapse-all-btn');

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
      const query = searchInput.value.trim().toLowerCase();
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

  const self = document.createElement('div');
  self.className = 'tree-item-self';

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

  const inner = document.createElement('div');
  inner.className = 'tree-item-inner';
  inner.title = node.text;

  if (searchQuery && node.text.toLowerCase().includes(searchQuery)) {
    const idx = node.text.toLowerCase().indexOf(searchQuery);
    inner.innerHTML = `${node.text.slice(0, idx)}<span class="highlight-match">${node.text.slice(idx, idx + searchQuery.length)}</span>${node.text.slice(idx + searchQuery.length)}`;
  } else {
    inner.textContent = node.text;
  }

  self.addEventListener('click', () => {
    document.querySelectorAll('.tree-item-self.is-active').forEach((el) => el.classList.remove('is-active'));
    self.classList.add('is-active');
    activeHeadingId = node.id;

    webviewApi.postMessage({
      type: 'jumpToHeading',
      line: node.line,
      slug: node.slug,
    });
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
  if (!treeContainer) return;

  treeContainer.innerHTML = '';

  if (!headings || headings.length === 0) {
    treeContainer.innerHTML = '<div class="outline-status">No headings in note</div>';
    return;
  }

  function filterNodes(nodes) {
    const filtered = [];
    for (const n of nodes) {
      const match = n.text.toLowerCase().includes(query);
      const childMatches = filterNodes(n.children || []);
      if (match || childMatches.length > 0) {
        filtered.push({ ...n, children: childMatches });
      }
    }
    return filtered;
  }

  const nodesToRender = query ? filterNodes(headings) : headings;
  if (nodesToRender.length === 0) {
    treeContainer.innerHTML = '<div class="outline-status">No matching headings</div>';
    return;
  }

  for (const node of nodesToRender) {
    treeContainer.appendChild(createNodeElement(node, query));
  }
}

// 1. Receive note updates pushed from Joplin
if (window.webviewApi && window.webviewApi.onMessage) {
  window.webviewApi.onMessage((message) => {
    if (message.type === 'setHeadings') {
      setDirection(message.isRtl);
      allHeadings = message.headings || [];
      const searchInput = getSearchInput();
      renderTree(allHeadings, searchInput ? searchInput.value.trim().toLowerCase() : '');
    }
  });
}

// 2. Initial fetch on load
async function fetchHeadings() {
  initEventHandlers();
  if (window.webviewApi && window.webviewApi.postMessage) {
    try {
      const response = await window.webviewApi.postMessage({ type: 'getHeadings' });
      if (response) {
        setDirection(response.isRtl);
        allHeadings = response.headings || [];
        renderTree(allHeadings);
      }
    } catch (e) {
      console.error('[TreeOutline] fetchHeadings error:', e);
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', fetchHeadings);
} else {
  fetchHeadings();
}
