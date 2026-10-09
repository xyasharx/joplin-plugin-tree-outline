/* global webviewApi */

var api = typeof webviewApi !== 'undefined' ? webviewApi : (window.webviewApi || null);

var renderedNoteId = '';
var renderedBodyLength = -1;
var allHeadings = [];
var isAllCollapsed = false;
var activeHeadingId = null;

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
  var dir = isRtl ? 'rtl' : 'ltr';
  document.body.setAttribute('dir', dir);
  var container = document.getElementById('outline-container');
  if (container) container.setAttribute('dir', dir);
}

function escapeHtml(text) {
  var div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
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
  var count = 0;
  for (var i = 0; i < nodes.length; i++) {
    count += 1;
    if (nodes[i].children && nodes[i].children.length > 0) {
      count += countTotalHeadings(nodes[i].children);
    }
  }
  return count;
}

function applyFontPreset(presetKey) {
  var container = document.getElementById('outline-container');
  if (!container) return;

  var classes = Array.from(container.classList);
  for (var i = 0; i < classes.length; i++) {
    if (classes[i].indexOf('override-') === 0) {
      container.classList.remove(classes[i]);
    }
  }

  if (presetKey && presetKey !== 'auto') {
    container.classList.add('override-' + presetKey);
  }

  var items = document.querySelectorAll('.font-menu-item');
  for (var j = 0; j < items.length; j++) {
    items[j].classList.toggle('is-selected', items[j].getAttribute('data-font') === presetKey);
  }
}

function initEventHandlers() {
  var searchToggleBtn = document.getElementById('search-toggle-btn');
  var searchContainer = getSearchContainer();
  var searchInput = getSearchInput();
  var searchClearBtn = document.getElementById('search-clear-btn');
  var collapseAllBtn = document.getElementById('collapse-all-btn');
  var wrapToggleBtn = document.getElementById('wrap-toggle-btn');
  var fontToggleBtn = document.getElementById('font-toggle-btn');
  var fontMenu = document.getElementById('font-menu');
  var container = document.getElementById('outline-container');

  // Load Saved Wrap Preference
  if (container) {
    var savedWrap = localStorage.getItem('treeOutline_isWrapped');
    var isWrapped = savedWrap !== null ? savedWrap === 'true' : window.innerWidth <= 650;

    if (isWrapped) {
      container.classList.add('is-wrapped');
      if (wrapToggleBtn) wrapToggleBtn.classList.add('is-active');
    }

    if (wrapToggleBtn && !wrapToggleBtn.dataset.bound) {
      wrapToggleBtn.dataset.bound = 'true';
      wrapToggleBtn.addEventListener('click', function () {
        var currentlyWrapped = container.classList.toggle('is-wrapped');
        wrapToggleBtn.classList.toggle('is-active', currentlyWrapped);
        localStorage.setItem('treeOutline_isWrapped', currentlyWrapped ? 'true' : 'false');
      });
    }
  }

  // Typography Preset Menu
  var savedFontPreset = localStorage.getItem('treeOutline_fontPreset') || 'auto';
  applyFontPreset(savedFontPreset);

  if (fontToggleBtn && !fontToggleBtn.dataset.bound) {
    fontToggleBtn.dataset.bound = 'true';
    fontToggleBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (fontMenu) fontMenu.classList.toggle('is-visible');
    });

    document.addEventListener('click', function () {
      if (fontMenu) fontMenu.classList.remove('is-visible');
    });

    var menuItems = document.querySelectorAll('.font-menu-item');
    for (var m = 0; m < menuItems.length; m++) {
      menuItems[m].addEventListener('click', function (e) {
        e.stopPropagation();
        var font = this.getAttribute('data-font');
        applyFontPreset(font);
        localStorage.setItem('treeOutline_fontPreset', font);
        if (fontMenu) fontMenu.classList.remove('is-visible');
      });
    }
  }

  // Toggle Search Bar
  if (searchToggleBtn && !searchToggleBtn.dataset.bound) {
    searchToggleBtn.dataset.bound = 'true';
    searchToggleBtn.addEventListener('click', function () {
      searchContainer.classList.toggle('is-visible');
      if (searchContainer.classList.contains('is-visible')) {
        searchInput.focus();
      } else {
        searchInput.value = '';
        renderTree(allHeadings);
      }
    });
  }

  // Live filter input
  if (searchInput && !searchInput.dataset.bound) {
    searchInput.dataset.bound = 'true';
    searchInput.addEventListener('input', function () {
      var query = searchInput.value.trim();
      if (searchClearBtn) searchClearBtn.style.display = query ? 'block' : 'none';
      renderTree(allHeadings, query);
    });
  }

  // Clear search input
  if (searchClearBtn && !searchClearBtn.dataset.bound) {
    searchClearBtn.dataset.bound = 'true';
    searchClearBtn.addEventListener('click', function () {
      if (searchInput) searchInput.value = '';
      searchClearBtn.style.display = 'none';
      renderTree(allHeadings);
      if (searchInput) searchInput.focus();
    });
  }

  // Collapse / Expand All
  if (collapseAllBtn && !collapseAllBtn.dataset.bound) {
    collapseAllBtn.dataset.bound = 'true';
    collapseAllBtn.addEventListener('click', function () {
      isAllCollapsed = !isAllCollapsed;
      var treeItems = document.querySelectorAll('.tree-item');
      for (var t = 0; t < treeItems.length; t++) {
        if (treeItems[t].querySelector('.tree-item-children')) {
          treeItems[t].classList.toggle('is-collapsed', isAllCollapsed);
        }
      }
    });
  }
}

function createNodeElement(node, searchQuery) {
  var item = document.createElement('div');
  item.className = 'tree-item';
  item.id = node.id;
  item.setAttribute('data-level', node.level);

  var self = document.createElement('div');
  self.className = 'tree-item-self';
  self.setAttribute('data-level', node.level);
  self.setAttribute('data-script', node.script || 'latin');

  if (activeHeadingId === node.id) {
    self.classList.add('is-active');
  }

  var icon = document.createElement('div');
  icon.className = 'collapse-icon';
  if (!node.children || node.children.length === 0) {
    icon.classList.add('is-hidden');
  }
  icon.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;min-width:12px;max-width:12px;display:block;"><polyline points="6 9 12 15 18 9"></polyline></svg>';

  icon.addEventListener('click', function (e) {
    e.stopPropagation();
    item.classList.toggle('is-collapsed');
  });

  var inner = document.createElement('bdi');
  inner.className = 'tree-item-inner';
  inner.title = node.text + ' (H' + node.level + ')';

  if (searchQuery) {
    var normText = normalizeForSearch(node.text);
    var normQuery = normalizeForSearch(searchQuery);
    var matchIndex = normText.indexOf(normQuery);

    if (matchIndex !== -1) {
      var matchLength = searchQuery.length;
      var before = escapeHtml(node.text.slice(0, matchIndex));
      var matchText = escapeHtml(node.text.slice(matchIndex, matchIndex + matchLength));
      var after = escapeHtml(node.text.slice(matchIndex + matchLength));
      inner.innerHTML = before + '<span class="highlight-match">' + matchText + '</span>' + after;
    } else {
      inner.textContent = node.text;
    }
  } else {
    inner.textContent = node.text;
  }

  self.addEventListener('click', function (e) {
    if (e.target && e.target.closest('.collapse-icon')) {
      return;
    }

    var actives = document.querySelectorAll('.tree-item-self.is-active');
    for (var a = 0; a < actives.length; a++) {
      actives[a].classList.remove('is-active');
    }
    self.classList.add('is-active');
    activeHeadingId = node.id;

    if (api && api.postMessage) {
      api.postMessage({
        type: 'jumpToHeading',
        line: node.line,
        slug: node.slug,
        text: node.text,
      });
    }
  });

  self.appendChild(icon);
  self.appendChild(inner);
  item.appendChild(self);

  if (node.children && node.children.length > 0) {
    var childrenContainer = document.createElement('div');
    childrenContainer.className = 'tree-item-children';
    for (var c = 0; c < node.children.length; c++) {
      childrenContainer.appendChild(createNodeElement(node.children[c], searchQuery));
    }
    item.appendChild(childrenContainer);
  }

  return item;
}

function renderTree(headings, query) {
  query = query || '';
  initEventHandlers();
  var treeContainer = getTreeContainer();
  var searchInput = getSearchInput();
  if (!treeContainer) return;

  treeContainer.innerHTML = '';

  var totalCount = countTotalHeadings(headings || []);
  if (searchInput && !query) {
    searchInput.placeholder = totalCount > 0 ? ('Filter ' + totalCount + ' headings...') : 'Filter headings...';
  }

  if (!headings || headings.length === 0) {
    treeContainer.innerHTML = '<div class="outline-status">No headings found in this note</div>';
    return;
  }

  var normalizedQuery = normalizeForSearch(query);

  function filterNodes(nodes) {
    var filtered = [];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var match = normalizeForSearch(n.text).indexOf(normalizedQuery) !== -1;
      var childMatches = filterNodes(n.children || []);
      if (match || childMatches.length > 0) {
        var copyNode = Object.assign({}, n);
        copyNode.children = childMatches;
        filtered.push(copyNode);
      }
    }
    return filtered;
  }

  var nodesToRender = query ? filterNodes(headings) : headings;
  if (nodesToRender.length === 0) {
    treeContainer.innerHTML = '<div class="outline-status">No matching headings found</div>';
    return;
  }

  for (var k = 0; k < nodesToRender.length; k++) {
    treeContainer.appendChild(createNodeElement(nodesToRender[k], query));
  }
}

async function syncOutline(force) {
  force = force || false;
  if (!api || !api.postMessage) return;

  try {
    var data = await api.postMessage({
      type: 'pollNote',
      clientNoteId: renderedNoteId,
      clientBodyLength: renderedBodyLength,
      force: force,
    });

    if (data && data.changed) {
      renderedNoteId = data.noteId;
      renderedBodyLength = data.bodyLength !== undefined ? data.bodyLength : -1;
      activeHeadingId = null;

      setDirection(data.isRtl);
      allHeadings = data.headings || [];

      var searchInput = getSearchInput();
      renderTree(allHeadings, searchInput ? searchInput.value.trim() : '');
    }
  } catch (err) {}
}

if (api && api.onMessage) {
  api.onMessage(function (msg) {
    if (msg.type === 'noteSwitched') {
      syncOutline(true);
    }
  });
}

syncOutline(true);

setInterval(function () {
  syncOutline(false);
}, 350);
