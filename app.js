/**
 * app.js — основная логика PMO Dashboard
 * Рендер иерархической таблицы, KPI-карточек, фильтров, экрана рисков, инлайн-редактирования
 */

// ─── Состояние приложения ─────────────────────────────────────────────────────
let appData = null;           // данные из API
let activeTab = 'portfolio';  // текущий активный экран
let filterType = '';          // фильтр по типу (Проект/Продукт)
let filterOwner = '';         // фильтр по ответственному
let filterStatus = '';        // фильтр по статусу

// ─── Инициализация ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  setupNavigation();
  await loadData();
});

/**
 * Загружает данные из API и рендерит все экраны
 */
async function loadData(forceRefresh = false) {
  showLoader(true);
  try {
    const raw = await fetchData(forceRefresh);
    appData = raw;
    renderAll();
  } catch (err) {
    showError('Не удалось загрузить данные: ' + err.message);
  } finally {
    showLoader(false);
  }
}

/**
 * Рендерит всё: KPI, таблицу портфеля, Гантт, риски
 */
function renderAll() {
  renderKPI();
  populateOwnerFilter();
  renderPortfolio();
  renderGantt(document.getElementById('gantt-container'), getFilteredItems());
  renderRisks();
}

// ─── Навигация ────────────────────────────────────────────────────────────────
function setupNavigation() {
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      switchTab(target);
    });
  });

  // Кнопка обновления данных
  document.getElementById('btn-refresh').addEventListener('click', () => loadData(true));

  // Фильтры
  document.getElementById('filter-type').addEventListener('change', e => {
    filterType = e.target.value;
    renderPortfolio();
    renderGantt(document.getElementById('gantt-container'), getFilteredItems());
    renderRisks();
  });
  document.getElementById('filter-owner').addEventListener('change', e => {
    filterOwner = e.target.value;
    renderPortfolio();
    renderGantt(document.getElementById('gantt-container'), getFilteredItems());
    renderRisks();
  });
  document.getElementById('filter-status').addEventListener('change', e => {
    filterStatus = e.target.value;
    renderPortfolio();
    renderGantt(document.getElementById('gantt-container'), getFilteredItems());
    renderRisks();
  });
}

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('hidden', s.id !== `screen-${tab}`));
}

// ─── KPI-карточки ─────────────────────────────────────────────────────────────
function renderKPI() {
  if (!appData) return;
  const items = appData.items || [];

  let totalTasks = 0, redCount = 0, yellowCount = 0, greenCount = 0;
  let projectCount = 0, productCount = 0;

  items.forEach(item => {
    if (item.type === 'Проект') projectCount++;
    else productCount++;

    item.subgroups.forEach(sg => {
      sg.tasks.forEach(task => {
        totalTasks++;
        if (task.status === '🔴') redCount++;
        else if (task.status === '🟡') yellowCount++;
        else if (task.status === '🟢') greenCount++;
      });
    });
  });

  document.getElementById('kpi-total').textContent = totalTasks;
  document.getElementById('kpi-red').textContent = redCount;
  document.getElementById('kpi-yellow').textContent = yellowCount;
  document.getElementById('kpi-green').textContent = greenCount;
  document.getElementById('kpi-projects').textContent = projectCount;
  document.getElementById('kpi-products').textContent = productCount;

  // Круговая диаграмма статусов через Chart.js
  renderStatusChart(redCount, yellowCount, greenCount);
}

let statusChart = null;

function renderStatusChart(red, yellow, green) {
  const ctx = document.getElementById('status-chart');
  if (!ctx) return;

  if (statusChart) statusChart.destroy();

  statusChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Критично', 'Контроль', 'В норме'],
      datasets: [{
        data: [red, yellow, green],
        backgroundColor: ['#dc2626', '#d97706', '#16a34a'],
        borderWidth: 2,
        borderColor: '#ffffff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
            position: 'bottom',
            labels: {
              font: { size: 12 },
              color: '#64748b',
              usePointStyle: true,
              pointStyle: 'circle',
              padding: 16
            }
          }
      }
    }
  });
}

// ─── Фильтры ──────────────────────────────────────────────────────────────────
function getFilteredItems() {
  if (!appData) return [];
  return appData.items.map(item => {
    if (filterType && item.type !== filterType) return null;

    const filteredSubgroups = item.subgroups.map(sg => {
      const filteredTasks = sg.tasks.filter(task => {
        if (filterOwner && task.owner !== filterOwner) return false;
        if (filterStatus && task.status !== filterStatus) return false;
        return true;
      });
      if (filteredTasks.length === 0) return null;
      return { ...sg, tasks: filteredTasks };
    }).filter(Boolean);

    if (filteredSubgroups.length === 0) return null;
    return { ...item, subgroups: filteredSubgroups };
  }).filter(Boolean);
}

function populateOwnerFilter() {
  if (!appData) return;
  const owners = new Set();
  appData.items.forEach(item => {
    item.subgroups.forEach(sg => {
      sg.tasks.forEach(task => { if (task.owner) owners.add(task.owner); });
    });
  });

  const select = document.getElementById('filter-owner');
  const current = select.value;
  select.innerHTML = '<option value="">Все ответственные</option>';
  [...owners].sort().forEach(o => {
    const opt = document.createElement('option');
    opt.value = o;
    opt.textContent = o;
    if (o === current) opt.selected = true;
    select.appendChild(opt);
  });
}

// ─── Портфель (иерархическая таблица) ────────────────────────────────────────
function renderPortfolio() {
  const container = document.getElementById('portfolio-container');
  const items = getFilteredItems();

  if (!items.length) {
    container.innerHTML = '<p class="no-data">Нет данных по выбранным фильтрам</p>';
    return;
  }

  let html = `
    <table class="portfolio-table">
      <thead>
        <tr>
          <th>Тип / Наименование / Задача</th>
          <th>Отв. (PM)</th>
          <th>Приоритет</th>
          <th>Статус</th>
          <th>Тренд</th>
          <th>Ключевой риск</th>
          <th>Причина отклонения</th>
        </tr>
      </thead>
      <tbody>
  `;

  items.forEach(item => {
    const hasRed = itemHasStatus(item, '🔴');
    const isOpen = hasRed; // Группы с 🔴 открыты по умолчанию
    const groupId = `group-${item.id}`;

    html += `
      <tr class="row-level1 ${isOpen ? 'open' : 'closed'}" data-group="${groupId}" onclick="toggleGroup('${groupId}')">
        <td colspan="7">
          <span class="toggle-icon">${isOpen ? '▼' : '▶'}</span>
          <span class="type-badge ${item.type === 'Проект' ? 'badge-project' : 'badge-product'}">${item.type}</span>
          <strong>${escHtml(item.name)}</strong>
          ${item.businessNote ? `<span class="biz-note">${escHtml(item.businessNote)}</span>` : ''}
        </td>
      </tr>
    `;

    item.subgroups.forEach((sg, sgIdx) => {
      const sgId = `${groupId}-sg${sgIdx}`;

      if (sg.subgroupName) {
        html += `
          <tr class="row-level2 group-${groupId} ${isOpen ? '' : 'hidden'}" data-group="${sgId}" onclick="toggleGroup('${sgId}')">
            <td colspan="7">
              <span class="toggle-icon">▼</span>
              <span class="subgroup-label">${escHtml(sg.subgroupName)}</span>
            </td>
          </tr>
        `;
      }

      sg.tasks.forEach(task => {
        const parentClass = sg.subgroupName ? `group-${groupId} group-${sgId}` : `group-${groupId}`;
        html += `
          <tr class="row-level3 ${parentClass} ${isOpen ? '' : 'hidden'} ${statusToClass(task.status)}">
            <td class="task-name">${escHtml(task.task)}</td>
            <td>${escHtml(task.owner)}</td>
            <td><span class="priority-badge">${task.priority || '—'}</span></td>
            <td>
              <span class="status-selector" data-task="${escHtml(task.task)}" data-field="status">
                ${task.status}
              </span>
            </td>
            <td>
              <span class="trend-selector" data-task="${escHtml(task.task)}" data-field="trend">
                ${task.trend}
              </span>
            </td>
            <td>
              <span class="editable-field" data-task="${escHtml(task.task)}" data-field="risk">
                ${escHtml(task.risk)}
              </span>
            </td>
            <td>
              <span class="editable-field" data-task="${escHtml(task.task)}" data-field="deviationReason">
                ${escHtml(task.deviationReason)}
              </span>
            </td>
          </tr>
        `;
      });
    });
  });

  html += `</tbody></table>`;
  container.innerHTML = html;
  attachEditHandlers(container);
}

/**
 * Проверяет, есть ли в группе задачи с указанным статусом
 */
function itemHasStatus(item, status) {
  return item.subgroups.some(sg => sg.tasks.some(t => t.status === status));
}

/**
 * Разворачивает/сворачивает строки группы
 */
function toggleGroup(groupId) {
  const groupRow = document.querySelector(`[data-group="${groupId}"]`);
  if (!groupRow) return;
  const isOpen = groupRow.classList.contains('open');
  groupRow.classList.toggle('open', !isOpen);
  groupRow.classList.toggle('closed', isOpen);

  // Переключаем иконку
  const icon = groupRow.querySelector('.toggle-icon');
  if (icon) icon.textContent = isOpen ? '▶' : '▼';

  // Скрываем/показываем дочерние строки
  document.querySelectorAll(`.group-${groupId}`).forEach(row => {
    row.classList.toggle('hidden', isOpen);
  });
}

// ─── Инлайн-редактирование ────────────────────────────────────────────────────
function attachEditHandlers(container) {
  // Клик по статусу → циклическая смена
  container.querySelectorAll('.status-selector').forEach(el => {
    el.style.cursor = 'pointer';
    el.title = 'Нажмите для смены статуса';
    el.addEventListener('click', async e => {
      e.stopPropagation();
      const values = ['🟢', '🟡', '🔴'];
      const cur = el.textContent.trim();
      const next = values[(values.indexOf(cur) + 1) % values.length];
      el.textContent = next;
      await saveField(el.dataset.task, 'status', next);
    });
  });

  // Клик по тренду → циклическая смена
  container.querySelectorAll('.trend-selector').forEach(el => {
    el.style.cursor = 'pointer';
    el.title = 'Нажмите для смены тренда';
    el.addEventListener('click', async e => {
      e.stopPropagation();
      const values = ['↑', '→', '↓'];
      const cur = el.textContent.trim();
      const next = values[(values.indexOf(cur) + 1) % values.length];
      el.textContent = next;
      await saveField(el.dataset.task, 'trend', next);
    });
  });

  // Текстовые поля (риск, причина) → редактирование по клику, сохранение по blur
  container.querySelectorAll('.editable-field').forEach(el => {
    el.style.cursor = 'text';
    el.title = 'Нажмите для редактирования';
    el.addEventListener('click', e => {
      e.stopPropagation();
      if (el.querySelector('input')) return; // уже редактируется

      const cur = el.textContent.trim();
      const input = document.createElement('input');
      input.type = 'text';
      input.value = cur === '-' ? '' : cur;
      input.className = 'inline-input';
      el.innerHTML = '';
      el.appendChild(input);
      input.focus();

      input.addEventListener('blur', async () => {
        const val = input.value.trim() || '-';
        el.textContent = val;
        await saveField(el.dataset.task, el.dataset.field, val);
      });
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') input.blur();
        if (e.key === 'Escape') { el.textContent = cur; }
      });
    });
  });
}

/**
 * Сохраняет изменение поля через API
 */
async function saveField(taskName, field, value) {
  try {
    await updateField(taskName, field, value);
    showToast('Сохранено ✓');
  } catch (err) {
    showToast('Ошибка сохранения: ' + err.message, true);
  }
}

// ─── Экран Риски и отклонения ─────────────────────────────────────────────────
function renderRisks() {
  const container = document.getElementById('risks-container');
  const items = getFilteredItems();
  const riskyTasks = [];

  items.forEach(item => {
    item.subgroups.forEach(sg => {
      sg.tasks.forEach(task => {
        if (task.risk !== '-' || task.deviationReason !== '-') {
          riskyTasks.push({ ...task, itemName: item.name, subgroupName: sg.subgroupName });
        }
      });
    });
  });

  // Сортировка: 🔴 → 🟡 → остальные
  const order = { '🔴': 0, '🟡': 1 };
  riskyTasks.sort((a, b) => (order[a.status] ?? 2) - (order[b.status] ?? 2));

  if (!riskyTasks.length) {
    container.innerHTML = '<p class="no-data">🎉 Нет задач с рисками или отклонениями</p>';
    return;
  }

  let html = `<div class="risks-list">`;
  riskyTasks.forEach(task => {
    html += `
      <div class="risk-card ${statusToClass(task.status)}">
        <div class="risk-header">
          <span class="risk-status">${task.status}</span>
          <span class="risk-task">${escHtml(task.task)}</span>
          <span class="risk-owner">${escHtml(task.owner)}</span>
          <span class="risk-breadcrumb">${escHtml(task.itemName)}${task.subgroupName ? ' / ' + escHtml(task.subgroupName) : ''}</span>
        </div>
        ${task.risk !== '-' ? `<div class="risk-row"><span class="risk-label">⚠️ Риск:</span> <span class="risk-text">${escHtml(task.risk)}</span></div>` : ''}
        ${task.deviationReason !== '-' ? `<div class="risk-row"><span class="risk-label">↩ Причина:</span> <span class="risk-text">${escHtml(task.deviationReason)}</span></div>` : ''}
      </div>
    `;
  });
  html += `</div>`;
  container.innerHTML = html;
}

// ─── Вспомогательные функции ──────────────────────────────────────────────────
function statusToClass(status) {
  if (status === '🟢') return 'status-green';
  if (status === '🟡') return 'status-yellow';
  if (status === '🔴') return 'status-red';
  return '';
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showLoader(visible) {
  const el = document.getElementById('loader');
  if (el) el.classList.toggle('hidden', !visible);
}

function showError(msg) {
  const el = document.getElementById('error-banner');
  if (el) { el.textContent = msg; el.classList.remove('hidden'); }
}

let toastTimeout;
function showToast(msg, isError = false) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = `toast ${isError ? 'toast-error' : 'toast-ok'} show`;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('show'), 2500);
}
