/* global webviewApi */

let allHeadings = [];
let isAllCollapsed = false;
let activeHeadingId = null;

const treeContainer = document.getElementById('outline-tree');
const searchToggleBtn = document.getElementById('search-toggle-btn');
const searchContainer = document.getElementById('search-container');
const searchInput = document.getElementById('search-input');
const searchClearBtn = document.getElementById('search-clear-btn');
const collapseAllBtn = document.getElementById('collapse-all-btn');

// Toggle Search Bar
searchToggleBtn.addEventListener('click', () => {
  searchContainer.classList.toggle('is-visible');
  if (searchContainer.classList.contains('is-visible')) {
    searchInput.focus();
  } else {
    searchInput.value = '';
    renderTree(allHeadings);
  }
});

searchInput.addEventListener('input', () => {
  const query = searchInput.value.trim().toLowerCase();
  searchClearBtn.style.display = query ? 'block' : 'none';
  renderTree(allHeadings, query);
});

searchClearBtn.addEventListener('click', () => {
  searchInput.value = '';
  searchClearBtn.style.display = 'none';
  renderTree(allHeadings);
  searchInput.focus();
});

// Collapse / Expand All
collapseAllBtn.addEventListener('click', () => {
  isAllCollapsed = !isAllCollapsed;
  const treeItems = document.querySelectorAll('.tree-item');
  treeItems.forEach((item) => {
    if (item.querySelector('.tree-item-children')) {
      item.classList.toggle('is-collapsed', isAllCollapsed);
    }
  });
});

function createNodeElement(node, searchQuery = '') {
  const item = document.createElement('div');
  item.className = 'tree-item';
  item.id = node.id;

  const self = document.createElement('div');
  self.className = 'tree-item-self';
  self.dir = 'auto'; // Auto-detect RTL for Persian / Hebrew / Arabic

  if (activeHeadingId === node.id) {
    self.classList.add('is-active');
  }

  // Chevron Icon
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

  // Text title
  const inner = document.createElement('div');
  inner.className = 'tree-item-inner';
  inner.title = node.text;

  if (searchQuery && node.text.toLowerCase().includes(searchQuery)) {
    const idx = node.text.toLowerCase().indexOf(searchQuery);
    inner.innerHTML = `${node.text.slice(0, idx)}<span class="highlight-match">${node.text.slice(idx, idx + searchQuery.length)}</span>${node.text.slice(idx + searchQuery.length)}`;
  } else {
    inner.textContent = node.text;
  }

  // Jump to heading on click
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

  // Render children
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
  treeContainer.innerHTML = '';
  if (!headings || headings.length === 0) {
    treeContainer.innerHTML = '<div style="color: grey; padding: 12px; text-align: center;">No headings found</div>';
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
  for (const node of nodesToRender) {
    treeContainer.appendChild(createNodeElement(node, query));
  }
}

// Receive messages from Joplin main process
webviewApi.onMessage((message) => {
  if (message.type === 'setHeadings') {
    allHeadings = message.headings;
    renderTree(allHeadings, searchInput.value.trim().toLowerCase());
  }
});
