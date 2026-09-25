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
let ganttFocusTask = null;    // задача для перехода в Гантт

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
  renderCalendar();
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

  // Фильтры (только для Портфеля и Гантта)
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

  // Фильтр-бар только на Портфеле и Гантте
  const filtersBar = document.getElementById('filters-bar');
  if (filtersBar) {
    filtersBar.classList.toggle('hidden', !['portfolio', 'gantt'].includes(tab));
  }
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

// ─── Агрегация данных по проекту/продукту ────────────────────────────────────
function getItemSummary(item) {
  const tasks = [];
  item.subgroups.forEach(sg => sg.tasks.forEach(t => tasks.push(t)));

  // PM — уникальные ответственные
  const pms = [...new Set(tasks.map(t => t.owner).filter(Boolean))];

  // Приоритет — наивысший (наименьший номер)
  const priorities = tasks.map(t => t.priority).filter(p => p != null && !isNaN(p));
  const minPriority = priorities.length ? Math.min(...priorities) : null;
  const priorityLabel = minPriority === 1 ? 'Высокий' : minPriority === 2 ? 'Средний' : minPriority != null ? 'Низкий' : '—';

  // Итоговый статус
  const hasRed    = tasks.some(t => t.status === '🔴');
  const hasYellow = tasks.some(t => t.status === '🟡');
  const overallStatus = hasRed ? '🔴' : hasYellow ? '🟡' : '🟢';

  // Тренд — наихудший
  const overallTrend = tasks.some(t => t.trend === '↓') ? '↓'
                     : tasks.some(t => t.trend === '→') ? '→' : '↑';

  // Риски и причины: если красный — собираем из всех жёлтых и красных; если только жёлтый — из жёлтых
  const problemTasks = hasRed
    ? tasks.filter(t => t.status === '🔴' || t.status === '🟡')
    : tasks.filter(t => t.status === '🟡');

  const risks      = [...new Set(problemTasks.map(t => t.risk).filter(r => r && r !== '-'))];
  const deviations = [...new Set(problemTasks.map(t => t.deviationReason).filter(d => d && d !== '-'))];

  return { pms, priorityLabel, overallStatus, overallTrend, risks, deviations };
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
    <div class="portfolio-table-wrap">
    <table class="portfolio-table">
      <thead>
        <tr>
          <th>Тип / Наименование</th>
          <th>Ценность</th>
          <th>Отв. (PM)</th>
          <th>Приоритет</th>
          <th>Статус</th>
          <th>Тренд</th>
          <th>Ключевой риск</th>
          <th>Период запуска</th>
        </tr>
      </thead>
      <tbody>
  `;

  items.forEach(item => {
    // Цвет полосы по худшему статусу прикреплённых ценностей
    const _allTasks = item.subgroups.flatMap(sg => sg.tasks);
    const _hasRed    = _allTasks.some(t => t.status === '🔴');
    const _hasYellow = _allTasks.some(t => t.status === '🟡');
    const _headerColor = _hasRed ? 'header-red' : _hasYellow ? 'header-yellow' : 'header-green';

    html += `
      <tr class="row-level1 row-project-header ${_headerColor}">
        <td colspan="8">
          <span class="type-badge ${item.type === 'Проект' ? 'badge-project' : 'badge-product'}">${item.type}</span>
          <strong>${escHtml(item.name)}</strong>
          ${item.businessNote ? `<span class="biz-note">${item.businessNote.split(/\.\s+|\n/).filter(Boolean).map((s2,i,a) => escHtml(s2) + (i < a.length-1 ? '.' : '')).join('<br>')}</span>` : ''}
        </td>
      </tr>
    `;

    item.subgroups.forEach(sg => {
      if (sg.subgroupName) {
        html += `
          <tr class="row-level2">
            <td colspan="8">
              <span class="subgroup-label">${escHtml(sg.subgroupName)}</span>
            </td>
          </tr>
        `;
      }

      sg.tasks.forEach(task => {
        html += `
          <tr class="row-level3 ${statusToClass(task.status)}">
            <td class="td-empty"></td>
            <td class="task-name" data-tip-desc="${escHtml(task.description||'')}"
                data-tip-kpi="${escHtml(task.kpi||'')}"
                data-tip-task="${escHtml(task.task)}">${escHtml(task.task)}</td>
            <td>${escHtml(task.owner)}</td>
            <td><span class="prio-badge prio-${prioLabel(task.priority)}">${prioLabel(task.priority)}</span></td>
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
            <td class="period-cell" data-task="${escHtml(task.task)}">
              <span class="period-label">${getPeriodLabel(task.timeline)}</span>
            </td>
          </tr>
        `;
      });
    });
  });

  html += `</tbody></table></div>`;
  container.innerHTML = html;
  attachEditHandlers(container);
  attachTooltipHandlers(container);
  attachPeriodHandlers(container);
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
// ─── Приоритет: число → текст ────────────────────────────────────
function prioLabel(p) {
  if (p === 1) return 'Высокий';
  if (p === 2) return 'Средний';
  if (p != null && !isNaN(p) && p >= 3) return 'Низкий';
  return '—';
}


function attachEditHandlers(container) {
  // Клик по статусу → переход в Гантт для данной задачи
  container.querySelectorAll('.status-selector').forEach(el => {
    el.style.cursor = 'pointer';
    el.title = 'Нажмите — открыть в Гантте';
    el.addEventListener('click', e => {
      e.stopPropagation();
      navigateToGanttTask(el.dataset.task);
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

// ─── Навигация в Гантт по задаче ────────────────────────────────────
function navigateToGanttTask(taskName) {
  ganttFocusTask = taskName;
  switchTab('gantt');
  renderGantt(document.getElementById('gantt-container'), getFilteredItems());
  setTimeout(() => {
    const focused = document.querySelector('.gantt-focused');
    if (focused) focused.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 120);
}

// ─── Всплывающие подсказки по ценностям ────────────────────────────
function attachTooltipHandlers(container) {
  const tooltip = document.getElementById('task-tooltip');
  if (!tooltip) return;

  container.querySelectorAll('td.task-name[data-tip-task]').forEach(el => {
    const desc = el.dataset.tipDesc;
    const kpi  = el.dataset.tipKpi;
    const name = el.dataset.tipTask;
    if (!desc && !kpi) return;

    el.classList.add('has-tooltip');

    el.addEventListener('mouseenter', e => {
      tooltip.querySelector('.tooltip-title').textContent = name;
      const descEl = tooltip.querySelector('.tooltip-desc');
      const kpiEl  = tooltip.querySelector('.tooltip-kpi');
      descEl.textContent = desc || '';
      descEl.style.display = desc ? '' : 'none';
      kpiEl.textContent = kpi ? 'КПЭ: ' + kpi : '';
      kpiEl.style.display = kpi ? '' : 'none';
      tooltip.classList.remove('hidden');
      positionTooltip(e, tooltip);
    });
    el.addEventListener('mousemove', e => positionTooltip(e, tooltip));
    el.addEventListener('mouseleave', () => tooltip.classList.add('hidden'));
  });
}

function positionTooltip(e, tooltip) {
  const x = e.clientX + 14, y = e.clientY + 14;
  const w = tooltip.offsetWidth  || 280;
  const h = tooltip.offsetHeight || 80;
  tooltip.style.left = (x + w > window.innerWidth  ? x - w - 28 : x) + 'px';
  tooltip.style.top  = (y + h > window.innerHeight ? y - h - 28 : y) + 'px';
}

// ─── Период запуска: вспомогательные функции ───────────────────────
const MONTH_RU = {Sep:'Сен',Oct:'Окт',Nov:'Ноя',Dec:'Дек',
  Jan:'Янв',Feb:'Фев',Mar:'Мар',Apr:'Апр',May:'Май',Jun:'Июн',Jul:'Июл',Aug:'Авг'};

function formatMonth(m) {
  const p = m.split('-');
  return (MONTH_RU[p[0]] || p[0]) + '\'' + p[1];
}

function getPeriodLabel(timeline) {
  const planMonths = Object.keys(timeline || {}).filter(m => timeline[m].plan);
  if (!planMonths.length) return '—';
  return formatMonth(planMonths[planMonths.length - 1]);
}

function buildPeriodGantt(task) {
  const months = Object.keys(task.timeline || {});
  if (!months.length) return '<p class="pg-nodata">Нет данных</p>';
  const cols = months.map(m => {
    const tl = task.timeline[m];
    return `<div class="pg-col">
      <div class="pg-mlbl">${formatMonth(m)}</div>
      <div class="pg-bar pg-plan${tl.plan ? ' pg-on' : ''}"></div>
      <div class="pg-bar pg-fact${tl.fact ? ' pg-on' : ''}"></div>
    </div>`;
  }).join('');
  return `<div class="pg-title">${escHtml(task.task)}</div>
    <div class="pg-grid">${cols}</div>
    <div class="pg-legend">
      <span class="pg-leg pg-plan-leg">▬ План</span>
      <span class="pg-leg pg-fact-leg">▬ Факт</span>
    </div>`;
}

function attachPeriodHandlers(container) {
  const popup = document.getElementById('period-popup');
  if (!popup) return;
  container.querySelectorAll('td.period-cell[data-task]').forEach(el => {
    el.addEventListener('mouseenter', e => {
      const name = el.dataset.task;
      let task = null;
      if (appData) appData.items.forEach(it =>
        it.subgroups.forEach(sg =>
          sg.tasks.forEach(t => { if (t.task === name) task = t; })));
      if (!task) return;
      popup.innerHTML = buildPeriodGantt(task);
      popup.classList.remove('hidden');
      positionPeriodPopup(e, popup);
    });
    el.addEventListener('mousemove', e => positionPeriodPopup(e, popup));
    el.addEventListener('mouseleave', () => popup.classList.add('hidden'));
  });
}

function positionPeriodPopup(e, popup) {
  const w = popup.offsetWidth || 380, h = popup.offsetHeight || 90;
  const x = e.clientX - w / 2;
  const y = e.clientY + 18;
  popup.style.left = Math.max(8, Math.min(x, window.innerWidth - w - 8)) + 'px';
  popup.style.top  = (y + h > window.innerHeight ? e.clientY - h - 12 : y) + 'px';
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

// ─── Экран: Календарь запуска ─────────────────────────────────────────────────

function renderCalendar() {
  renderFunnelBoard(document.getElementById('funnel-board'));
  renderLaunchGrid(document.getElementById('cal-grid'), getFilteredItems());
}

/**
 * Рисует верхнюю доску — те же KPI-карточки, что и на вкладке «Портфель»
 */
function renderFunnelBoard(container) {
  if (!appData || !container) return;
  const items = appData.items;

  let projCount = 0, prodCount = 0;
  let gTask = 0, yTask = 0, rTask = 0, totalTasks = 0;

  items.forEach(item => {
    if (item.type === 'Проект') projCount++; else prodCount++;
    item.subgroups.forEach(sg => {
      sg.tasks.forEach(t => {
        totalTasks++;
        if (t.status === '🟢') gTask++;
        else if (t.status === '🟡') yTask++;
        else if (t.status === '🔴') rTask++;
      });
    });
  });

  container.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-value">${projCount}</div>
        <div class="kpi-label">Проектов</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-value">${prodCount}</div>
        <div class="kpi-label">Продуктов</div>
      </div>
      <div class="kpi-card kpi-accent">
        <div class="kpi-value">${totalTasks}</div>
        <div class="kpi-label">Всего ценностей</div>
      </div>
      <div class="kpi-card kpi-green">
        <div class="kpi-value">${gTask}</div>
        <div class="kpi-label">🟢 В норме</div>
      </div>
      <div class="kpi-card kpi-yellow">
        <div class="kpi-value">${yTask}</div>
        <div class="kpi-label">🟡 Контроль</div>
      </div>
      <div class="kpi-card kpi-red">
        <div class="kpi-value">${rTask}</div>
        <div class="kpi-label">🔴 Критично</div>
      </div>
    </div>
  `;
}

/**
 * Рисует сетку запусков по месяцам (строка = проект/продукт, колонка = месяц)
 * Ячейка месяца: список ценностей со светофором и цветовой заливкой по статусу
 */
function renderLaunchGrid(container, items) {
  if (!container) return;
  if (!items || !items.length) {
    container.innerHTML = '<p class="no-data">Нет данных по выбранным фильтрам</p>';
    return;
  }

  // Собираем все месяцы из полного датасета
  const months = [];
  const seenM  = new Set();
  (appData ? appData.items : items).forEach(item =>
    item.subgroups.forEach(sg =>
      sg.tasks.forEach(t =>
        Object.keys(t.timeline).forEach(m => {
          if (!seenM.has(m)) { seenM.add(m); months.push(m); }
        })
      )
    )
  );

  let html = `
    <div class="cal-header-row">
      <span class="cal-section-title">Запуски по месяцам</span>
      <div class="cal-legend">
        <span class="cal-leg"><span class="cal-lb" style="background:rgba(220,38,38,0.18)"></span>Критично</span>
        <span class="cal-leg"><span class="cal-lb" style="background:rgba(217,119,6,0.18)"></span>Контроль</span>
        <span class="cal-leg"><span class="cal-lb" style="background:rgba(22,163,74,0.14)"></span>В норме</span>
        <span class="cal-leg"><span class="cal-lb cal-lb-done"></span>Выполнено ✓</span>
      </div>
    </div>
    <div class="cal-table-wrap">
      <table class="cal-table">
        <thead>
          <tr>
            <th class="cal-th cal-th-name">Наименование</th>
            <th class="cal-th cal-th-cnt">Ценностей</th>
            ${months.map(m => `<th class="cal-th cal-th-m">${formatMonth(m)}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
  `;

  items.forEach(item => {
    const allTasks = item.subgroups.flatMap(sg => sg.tasks);
    const hasR = allTasks.some(t => t.status === '🔴');
    const hasY = allTasks.some(t => t.status === '🟡');
    const rowCls = hasR ? 'cal-row-r' : hasY ? 'cal-row-y' : 'cal-row-g';

    // Для каждой задачи определяем её «последний месяц запуска»
    // (последний месяц с планом; если плана нет — последний с фактом)
    const taskLaunchMonth = new Map();
    allTasks.forEach(t => {
      const planMonths = months.filter(m => (t.timeline[m] || {}).plan);
      if (planMonths.length) {
        taskLaunchMonth.set(t.task, planMonths[planMonths.length - 1]);
        return;
      }
      const factMonths = months.filter(m => (t.timeline[m] || {}).fact);
      if (factMonths.length) {
        taskLaunchMonth.set(t.task, factMonths[factMonths.length - 1]);
      }
    });

    html += `
      <tr class="cal-item-row ${rowCls}">
        <td class="cal-td cal-td-name">
          <span class="type-badge ${item.type === 'Проект' ? 'badge-project' : 'badge-product'}">${item.type}</span>
          <strong>${escHtml(item.name)}</strong>
          ${item.businessNote ? `<span class="cal-biz-note">${escHtml(item.businessNote.split(/\.\s+|\n/)[0])}</span>` : ''}
        </td>
        <td class="cal-td cal-td-cnt">${allTasks.length}</td>
        ${months.map(m => {
          // Только задачи, чей последний плановый месяц — именно этот
          const tasksInMonth = allTasks.filter(t => taskLaunchMonth.get(t.task) === m);

          if (!tasksInMonth.length) return `<td class="cal-td cal-td-m cal-td-empty"></td>`;

          // Цвет ячейки по наихудшему статусу
          const cHasR = tasksInMonth.some(t => t.status === '🔴');
          const cHasY = tasksInMonth.some(t => t.status === '🟡');
          const cellCls = cHasR ? 'cal-cell-r' : cHasY ? 'cal-cell-y' : 'cal-cell-g';

          const lines = tasksInMonth.map(t => {
            const tl = t.timeline[m] || {};
            const done = tl.plan && tl.fact;
            const stColor = t.status === '🔴' ? 'cst-r' : t.status === '🟡' ? 'cst-y' : 'cst-g';
            return `<div class="cal-task-line${done ? ' cal-task-done' : ''}">
              <span class="cal-task-st ${stColor}">${t.status}</span>
              <span class="cal-task-nm">${escHtml(t.task)}${done ? ' <span class="cal-check">✓</span>' : ''}</span>
            </div>`;
          }).join('');

          return `<td class="cal-td cal-td-m ${cellCls}">${lines}</td>`;
        }).join('')}
      </tr>
    `;
  });

  html += `</tbody></table></div>`;
  container.innerHTML = html;
}
