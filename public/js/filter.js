// ===== CLIENT-SIDE FILTER, SEARCH & PAGINATION HELPERS =====

(function () {

  // Registry of active paginators
  const activePaginators = new Map();

  // ===== CLIENT-SIDE PAGINATION =====
  function initPagination(options = {}) {
    const {
      containerSelector,    // e.g. '.data-table tbody' or '.projects-grid'
      itemSelector,         // e.g. 'tr' or '.project-card'
      pageSize = 10,        // default items per page
      paginationMount,      // container where pagination controls should be inserted
      itemLabel = 'records' // text label
    } = options;

    const container = document.querySelector(containerSelector);
    if (!container) return null;

    let items = Array.from(container.querySelectorAll(itemSelector)).filter(el => {
      // Exclude empty-state row if present
      return !el.classList.contains('empty-state') && !el.querySelector('.empty-state');
    });

    if (items.length === 0) return null;

    let currentPage = 1;
    let currentLimit = pageSize;

    // Find or create pagination mount element
    let mountEl = typeof paginationMount === 'string' ? document.querySelector(paginationMount) : paginationMount;
    if (!mountEl) {
      // Check if already created
      mountEl = container.closest('.table-card')?.querySelector('.pagination-container') ||
                container.parentElement.querySelector('.pagination-container');
      
      if (!mountEl) {
        mountEl = document.createElement('div');
        mountEl.className = 'pagination-container';
        const cardParent = container.closest('.table-card') || container.parentElement;
        cardParent.appendChild(mountEl);
      }
    }

    function getVisibleItems() {
      return items.filter(it => it.dataset.searchHidden !== 'true');
    }

    function render() {
      const visible = getVisibleItems();
      const total = visible.length;
      const limit = currentLimit === 'all' ? (total || 1) : currentLimit;
      const totalPages = Math.max(1, Math.ceil(total / limit));

      if (currentPage > totalPages) currentPage = totalPages;
      if (currentPage < 1) currentPage = 1;

      const startIdx = currentLimit === 'all' ? 0 : (currentPage - 1) * limit;
      const endIdx = currentLimit === 'all' ? total : Math.min(startIdx + limit, total);

      // Show/hide items
      items.forEach(it => {
        if (it.dataset.searchHidden === 'true') {
          it.style.display = 'none';
        } else {
          const idx = visible.indexOf(it);
          if (idx >= startIdx && idx < endIdx) {
            it.style.display = '';
          } else {
            it.style.display = 'none';
          }
        }
      });

      // If very few items, hide pagination controls but keep rows visible
      if (total <= (currentLimit === 'all' ? 10 : currentLimit) && totalPages <= 1 && items.length <= 10) {
        mountEl.style.display = 'none';
        return;
      }

      mountEl.style.display = 'flex';

      let pagesHtml = '';
      const createPageBtn = (p, text = p) => `
        <button type="button" class="pagination-btn ${p === currentPage ? 'active' : ''}" data-page="${p}">
          ${text}
        </button>
      `;

      // Previous button
      pagesHtml += `<button type="button" class="pagination-btn" data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''} title="Previous Page">‹</button>`;

      let startP = Math.max(1, currentPage - 2);
      let endP = Math.min(totalPages, currentPage + 2);

      if (startP > 1) {
        pagesHtml += createPageBtn(1);
        if (startP > 2) pagesHtml += `<span style="padding:0 4px;color:var(--text-muted)">...</span>`;
      }

      for (let p = startP; p <= endP; p++) {
        pagesHtml += createPageBtn(p);
      }

      if (endP < totalPages) {
        if (endP < totalPages - 1) pagesHtml += `<span style="padding:0 4px;color:var(--text-muted)">...</span>`;
        pagesHtml += createPageBtn(totalPages);
      }

      // Next button
      pagesHtml += `<button type="button" class="pagination-btn" data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''} title="Next Page">›</button>`;

      mountEl.innerHTML = `
        <div class="pagination-info">
          Showing <strong>${total === 0 ? 0 : startIdx + 1}</strong> to <strong>${endIdx}</strong> of <strong>${total}</strong> ${itemLabel}
        </div>
        <div class="pagination-controls">
          ${pagesHtml}
          <select class="pagination-size-select" title="Items per page" aria-label="Items per page">
            <option value="10" ${currentLimit == 10 ? 'selected' : ''}>10 / page</option>
            <option value="25" ${currentLimit == 25 ? 'selected' : ''}>25 / page</option>
            <option value="50" ${currentLimit == 50 ? 'selected' : ''}>50 / page</option>
            <option value="all" ${currentLimit === 'all' ? 'selected' : ''}>Show all</option>
          </select>
        </div>
      `;

      // Wire page button listeners
      mountEl.querySelectorAll('.pagination-btn[data-page]').forEach(btn => {
        btn.addEventListener('click', () => {
          if (btn.disabled) return;
          const p = parseInt(btn.dataset.page);
          if (p && p >= 1 && p <= totalPages && p !== currentPage) {
            currentPage = p;
            render();
            // Scroll to top of table
            const topEl = container.closest('.table-card') || container;
            const rect = topEl.getBoundingClientRect();
            if (rect.top < 0) {
              topEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          }
        });
      });

      // Wire page size selector
      const sizeSel = mountEl.querySelector('.pagination-size-select');
      if (sizeSel) {
        sizeSel.addEventListener('change', () => {
          currentLimit = sizeSel.value === 'all' ? 'all' : parseInt(sizeSel.value);
          currentPage = 1;
          render();
        });
      }
    }

    render();

    const paginator = {
      setPage: (p) => { currentPage = p; render(); },
      recalculate: () => { render(); },
      refreshItems: () => {
        items = Array.from(container.querySelectorAll(itemSelector)).filter(el => !el.classList.contains('empty-state'));
        render();
      }
    };

    activePaginators.set(container, paginator);
    return paginator;
  }

  // ===== LIVE SEARCH (filters a list without page reload) =====
  function initLiveSearch(inputSelector, cardSelector, fields) {
    const input = document.querySelector(inputSelector);
    if (!input) return;

    input.addEventListener('input', function () {
      const term = this.value.toLowerCase().trim();
      const cards = document.querySelectorAll(cardSelector);
      let container = null;

      cards.forEach(card => {
        if (!container) container = card.parentElement;
        if (!term) {
          delete card.dataset.searchHidden;
          card.style.display = '';
          return;
        }
        const text = fields
          .map(f => card.dataset[f] || card.querySelector(f)?.textContent || '')
          .join(' ')
          .toLowerCase();

        const match = text.includes(term);
        card.dataset.searchHidden = match ? 'false' : 'true';
        card.style.display = match ? '' : 'none';
      });

      // If container has pagination, recalculate
      if (container && activePaginators.has(container)) {
        activePaginators.get(container).recalculate();
      }

      updateResultCount(cardSelector);
    });
  }

  // ===== RESULT COUNT =====
  function updateResultCount(cardSelector) {
    const counter = document.getElementById('resultCount');
    if (!counter) return;
    const visible = document.querySelectorAll(`${cardSelector}:not([style*="display: none"])`).length;
    counter.textContent = visible;
  }

  // ===== TAG FILTER =====
  function initTagFilter(tagSelector, cardSelector, tagDataAttr) {
    const tags = document.querySelectorAll(tagSelector);
    tags.forEach(tag => {
      tag.addEventListener('click', function () {
        const activeTag = document.querySelector(`${tagSelector}.tag-active`);
        if (activeTag === this) {
          this.classList.remove('tag-active');
          document.querySelectorAll(cardSelector).forEach(c => {
            delete c.dataset.searchHidden;
            c.style.display = '';
          });
          return;
        }
        if (activeTag) activeTag.classList.remove('tag-active');
        this.classList.add('tag-active');

        const filterVal = this.dataset.filter || this.textContent.trim().toLowerCase();
        let container = null;
        document.querySelectorAll(cardSelector).forEach(card => {
          if (!container) container = card.parentElement;
          const val = card.dataset[tagDataAttr] || '';
          const match = val.toLowerCase().includes(filterVal);
          card.dataset.searchHidden = match ? 'false' : 'true';
          card.style.display = match ? '' : 'none';
        });

        if (container && activePaginators.has(container)) {
          activePaginators.get(container).recalculate();
        }

        updateResultCount(cardSelector);
      });
    });
  }

  // ===== SORT CARDS IN-PAGE =====
  function initClientSort(selectSelector, containerSelector, cardSelector) {
    const select = document.querySelector(selectSelector);
    if (!select) return;
    select.addEventListener('change', function () {
      const container = document.querySelector(containerSelector);
      if (!container) return;
      const cards = Array.from(container.querySelectorAll(cardSelector));
      const [field, dir] = this.value.split(':');

      cards.sort((a, b) => {
        const aVal = a.dataset[field] || a.querySelector(`[data-sort="${field}"]`)?.textContent || '';
        const bVal = b.dataset[field] || b.querySelector(`[data-sort="${field}"]`)?.textContent || '';
        const aNum = parseFloat(aVal.replace(/[^0-9.]/g, ''));
        const bNum = parseFloat(bVal.replace(/[^0-9.]/g, ''));
        if (!isNaN(aNum) && !isNaN(bNum)) {
          return dir === 'asc' ? aNum - bNum : bNum - aNum;
        }
        return dir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      });

      cards.forEach(c => container.appendChild(c));

      if (activePaginators.has(container)) {
        activePaginators.get(container).refreshItems();
      }
    });
  }

  // ===== BUDGET RANGE SLIDER SYNC =====
  function initRangeSync(rangeId, displayId, prefix) {
    const range = document.getElementById(rangeId);
    const display = document.getElementById(displayId);
    if (!range || !display) return;
    range.addEventListener('input', () => {
      display.textContent = (prefix || '') + Number(range.value).toLocaleString('en-IN');
    });
  }

  // ===== AUTO-SUBMIT FILTER FORM ON SELECT CHANGE =====
  function initAutoSubmitFilters(formId) {
    const form = document.getElementById(formId);
    if (!form) return;
    form.querySelectorAll('select').forEach(sel => {
      sel.addEventListener('change', () => form.submit());
    });
  }

  // ===== SKILL CHIPS INPUT =====
  function initSkillChipsInput(inputId, containerId) {
    const input = document.getElementById(inputId);
    const container = document.getElementById(containerId);
    if (!input || !container) return;

    function renderChips() {
      const skills = input.value.split(',').map(s => s.trim()).filter(Boolean);
      container.innerHTML = skills.map((sk, i) => `
        <span class="skill-tag-pill">
          ${sk}
          <button type="button" onclick="removeSkillAt(${i}, '${inputId}', '${containerId}')" class="skill-tag-remove">×</button>
        </span>
      `).join('');
    }

    window.removeSkillAt = function (idx, inId, conId) {
      const inp = document.getElementById(inId);
      const con = document.getElementById(conId);
      if (!inp) return;
      const skills = inp.value.split(',').map(s => s.trim()).filter(Boolean);
      skills.splice(idx, 1);
      inp.value = skills.join(', ');
      if (con) initSkillChipsInput(inId, conId);
    };

    input.addEventListener('input', renderChips);
    renderChips();
  }

  // ===== EXPOSE TO GLOBAL SCOPE =====
  window.FilterHelpers = {
    initPagination,
    initLiveSearch,
    initTagFilter,
    initClientSort,
    initRangeSync,
    initAutoSubmitFilters,
    initSkillChipsInput,
    updateResultCount
  };

  // ===== AUTO-INIT from data attributes & tables =====
  function autoInitAll() {
    // 1. Auto-paginate tables with > 8 rows
    document.querySelectorAll('.data-table').forEach(table => {
      const tbody = table.querySelector('tbody');
      if (!tbody) return;
      const rows = tbody.querySelectorAll('tr:not(.empty-state)');
      if (rows.length > 8) {
        initPagination({
          containerSelector: '.data-table tbody',
          itemSelector: 'tr',
          pageSize: 10,
          itemLabel: 'records'
        });
      }
    });

    // 2. Auto-paginate card grids with > 8 cards
    document.querySelectorAll('.projects-grid, .freelancers-grid').forEach(grid => {
      const cards = grid.querySelectorAll('.project-card, .freelancer-card');
      if (cards.length > 8) {
        initPagination({
          containerSelector: grid.classList.contains('projects-grid') ? '.projects-grid' : '.freelancers-grid',
          itemSelector: grid.classList.contains('projects-grid') ? '.project-card' : '.freelancer-card',
          pageSize: 8,
          itemLabel: grid.classList.contains('projects-grid') ? 'projects' : 'freelancers'
        });
      }
    });

    // 3. Auto-submit filter forms that have data-auto-submit
    document.querySelectorAll('form[data-auto-submit]').forEach(form => {
      form.querySelectorAll('select').forEach(sel => {
        sel.addEventListener('change', () => form.submit());
      });
    });

    // 4. Debounce search inputs in filter forms
    document.querySelectorAll('input[data-debounce-submit]').forEach(input => {
      let timer;
      input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          input.closest('form')?.submit();
        }, 500);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInitAll);
  } else {
    autoInitAll();
  }

})();