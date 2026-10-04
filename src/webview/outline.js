/* global webviewApi */

const api = typeof webviewApi !== 'undefined' ? webviewApi : (window.webviewApi || null);

let currentNoteId = '';
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
    searchClearBtn.a
