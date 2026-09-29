/**
 * app.js — основная логика PMO Dashboard
 * Рендер иерархической таблицы, KPI-карточек, фильтров, экрана рисков, инлайн-редактирования
 */

// ─── Состояние приложения ─────────────────────────────────────────────────────
let appData = null;           // данные из API
let activeTab = 'calendar';  // текущий активный экран
let filterType = '';          // фильтр по типу (Проект/Продукт)
let filterOwner = '';         // фильтр по ответственному
let filterStatus = '';        // фильтр по статусу
let ganttFocusTask = null;    // задача для перехода в Гантт

// ─── Инициализация ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  setupNavigation();
  renderCurrentDate();
  setInterval(renderCurrentDate, 60_000);   // обновляем каждую минуту
  await loadData();
});

/**
 * Отображает текущую дату в формате ДД.ММ.ГГГГ в шапке
 */
function renderCurrentDate() {
  const el = document.getElementById('current-date');
  if (!el) return;
  const now = new Date();
  const dd   = String(now.getDate()).padStart(2, '0');
  const mm   = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  el.textContent = `${dd}.${mm}.${yyyy}`;
}

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

// ─── Вспомогательная функция: задача «Выполнена» если статус 🟢
// и в последнем плановом месяце (хронологически) зафиксирован факт ────────────
const _MSEQ = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function _monthIdx(key) {
  const p = key.split('-');
  return parseInt('20' + p[1]) * 12 + _MSEQ.indexOf(p[0]);
}
function isTaskDone(task) {
  if (task.status !== '🟢') return false;
  const tl = task.timeline || {};
  // Сортируем месяцы хронологически — Object.keys() не гарантирует порядок
  const planMonths = Object.keys(tl)
    .filter(m => tl[m] && tl[m].plan)
    .sort((a, b) => _monthIdx(a) - _monthIdx(b));
  if (!planMonths.length) return false;
  const lastPlan = planMonths[planMonths.length - 1];
  return !!(tl[lastPlan] && tl[lastPlan].fact);
}

// ─── KPI-карточки ─────────────────────────────────────────────────────────────
function renderKPI() {
  if (!appData) return;
  const items = appData.items || [];

  let totalTasks = 0, redCount = 0, yellowCount = 0, greenCount = 0, doneCount = 0;
  let projectCount = 0, productCount = 0;

  items.forEach(item => {
    if (item.type === 'Проект') projectCount++;
    else productCount++;

    item.subgroups.forEach(sg => {
      sg.tasks.forEach(task => {
        totalTasks++;
        if (task.status === '🔴') redCount++;
        else if (task.status === '🟡') yellowCount++;
        else if (isTaskDone(task)) doneCount++;
        else greenCount++; // 🟢 без закрытого факта + пустой/иной статус → В работе
      });
    });
  });

  document.getElementById('kpi-total').textContent = totalTasks;
  document.getElementById('kpi-done').textContent = doneCount;
  document.getElementById('kpi-green').textContent = greenCount;
  document.getElementById('kpi-yellow').textContent = yellowCount;
  document.getElementById('kpi-red').textContent = redCount;
  document.getElementById('kpi-projects').textContent = projectCount;
  document.getElementById('kpi-products').textContent = productCount;

  // Доля выполненных — от всех ценностей
  const activeTasks = totalTasks - doneCount;   // ещё не выполнено
  const _shareTotal  = (n) => totalTasks  ? `${n} из ${totalTasks}  (${Math.round(n / totalTasks  * 100)}%)` : '';
  // Доля «В работе / Контроль / Критично» — от невыполненных (без учёта Done)
  const _shareActive = (n) => activeTasks ? `${n} из ${activeTasks} (${Math.round(n / activeTasks * 100)}%)` : '';
  const _typeShare = (n) => (projectCount + productCount)
    ? `${n} из ${projectCount + productCount} (${Math.round(n / (projectCount + productCount) * 100)}%)` : '';
  document.getElementById('kpi-done-share').textContent   = _shareTotal(doneCount);
  document.getElementById('kpi-green-share').textContent  = _shareActive(greenCount);
  document.getElementById('kpi-yellow-share').textContent = _shareActive(yellowCount);
  document.getElementById('kpi-red-share').textContent    = _shareActive(redCount);
  const _plural = (n, one, few, many) => {
    const mod10 = n % 10, mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 14) return `${n} ${many}`;
    if (mod10 === 1) return `${n} ${one}`;
    if (mod10 >= 2 && mod10 <= 4) return `${n} ${few}`;
    return `${n} ${many}`;
  };
  document.getElementById('kpi-total-share').innerHTML =
    `${_plural(projectCount,'проект','проекта','проектов')}<br>${_plural(productCount,'продукт','продукта','продуктов')}`;
  document.getElementById('kpi-projects-share').textContent = _typeShare(projectCount);
  document.getElementById('kpi-products-share').textContent = _typeShare(productCount);

  // Круговая диаграмма статусов через Chart.js
  renderStatusChart(redCount, yellowCount, greenCount, doneCount);
}

let statusChart = null;

function renderStatusChart(red, yellow, green, done) {
  const ctx = document.getElementById('status-chart');
  if (!ctx) return;

  if (statusChart) statusChart.destroy();

  statusChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Критично', 'Контроль', 'В работе', 'Выполнено'],
      datasets: [{
        data: [red, yellow, green, done],
        backgroundColor: ['#e53935', '#d97706', '#64748b', '#16a34a'],  /* red / yellow / gray / green */
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

  const legendHtml = `
    <div class="portfolio-legend">
      <span class="pl-item">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" fill="#e53935"/><line x1="12" y1="9" x2="12" y2="13" stroke="white" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="17.5" r="1.2" fill="white"/></svg>
        Критично
      </span>
      <span class="pl-item">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" fill="#d97706"/><line x1="12" y1="9" x2="12" y2="13" stroke="white" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="17.5" r="1.2" fill="white"/></svg>
        Контроль
      </span>
      <span class="pl-item">
        <svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="#64748b"/></svg>
        В работе
      </span>
      <span class="pl-item">
        <svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="#16a34a"/><path d="M5 8l2.2 2.2 3.8-3.8" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>
        Выполнено
      </span>
    </div>
  `;

  let html = legendHtml + `
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
              <span class="status-selector" data-task="${escHtml(task.task)}" data-field="status" title="${task.status === '🔴' ? 'Критично' : task.status === '🟡' ? 'Контроль' : isTaskDone(task) ? 'Выполнено' : 'В работе'}">
                ${statusIcon(task.status, isTaskDone(task))}
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
    const severityLabel = task.status === '🔴' ? 'Критично' : task.status === '🟡' ? 'Контроль' : 'В работе';
    const severityCls   = task.status === '🔴' ? 'risk-severity-red' : task.status === '🟡' ? 'risk-severity-yellow' : 'risk-severity-green';
    html += `
      <div class="risk-card ${statusToClass(task.status)}">
        <div class="risk-header">
          <span class="risk-status">${task.status}</span>
          <span class="risk-task">${escHtml(task.task)}</span>
          <span class="risk-owner">${escHtml(task.owner)}</span>
          <span class="risk-breadcrumb">${escHtml(task.itemName)}${task.subgroupName ? ' / ' + escHtml(task.subgroupName) : ''}</span>
          <span class="risk-severity ${severityCls}">${severityLabel}</span>
        </div>
        ${task.risk !== '-' ? `<div class="risk-row"><span class="risk-label">⚠️ Риск:</span> <span class="risk-text">${escHtml(task.risk)}</span></div>` : ''}
        ${task.deviationReason !== '-' ? `<div class="risk-row"><span class="risk-label">↩ Причина:</span> <span class="risk-text">${escHtml(task.deviationReason)}</span></div>` : ''}
      </div>
    `;
  });
  html += `</div>`;
  container.innerHTML = html;
}

// ─── SVG-иконки статуса ───────────────────────────────────────────────────────
function statusIcon(status, isDone) {
  if (status === '🔴')
    return `<svg class="status-icon" width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" fill="#e53935"/>
      <line x1="12" y1="9" x2="12" y2="13" stroke="white" stroke-width="2.2" stroke-linecap="round"/>
      <circle cx="12" cy="17.5" r="1.2" fill="white"/>
    </svg>`;
  if (status === '🟡')
    return `<svg class="status-icon" width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" fill="#d97706"/>
      <line x1="12" y1="9" x2="12" y2="13" stroke="white" stroke-width="2.2" stroke-linecap="round"/>
      <circle cx="12" cy="17.5" r="1.2" fill="white"/>
    </svg>`;
  if (isDone)
    return `<svg class="status-icon" width="16" height="16" viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="7" fill="#16a34a"/>
      <path d="M5 8l2.2 2.2 3.8-3.8" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    </svg>`;
  // 🟢 В работе
  return `<svg class="status-icon" width="16" height="16" viewBox="0 0 16 16">
    <circle cx="8" cy="8" r="7" fill="#64748b"/>
  </svg>`;
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
  attachCalendarTooltips(document.getElementById('cal-grid'));
}

/**
 * Рисует верхнюю доску — те же KPI-карточки, что и на вкладке «Портфель»
 */
function renderFunnelBoard(container) {
  if (!appData || !container) return;
  const items = appData.items;

  let projCount = 0, prodCount = 0;
  let gTask = 0, yTask = 0, rTask = 0, totalTasks = 0;

  let dTask = 0; // Выполнено
  items.forEach(item => {
    if (item.type === 'Проект') projCount++; else prodCount++;
    item.subgroups.forEach(sg => {
      sg.tasks.forEach(t => {
        totalTasks++;
        if (t.status === '🔴') rTask++;
        else if (t.status === '🟡') yTask++;
        else if (isTaskDone(t)) dTask++;
        else gTask++; // 🟢 без закрытого факта + пустой/иной статус → В работе
      });
    });
  });

  // Вспомогательные функции долей
  const activeTask = totalTasks - dTask;   // невыполненные
  const _shTotal  = (n) => totalTasks  ? `${n} из ${totalTasks}  (${Math.round(n / totalTasks  * 100)}%)` : '';
  // В работе / Контроль / Критично — доля от невыполненных
  const _shActive = (n) => activeTask  ? `${n} из ${activeTask}  (${Math.round(n / activeTask  * 100)}%)` : '';
  const _tsh = (n) => (projCount + prodCount)
    ? `${n} из ${projCount + prodCount} (${Math.round(n / (projCount + prodCount) * 100)}%)` : '';
  const _plur = (n, one, few, many) => {
    const m10 = n % 10, m100 = n % 100;
    if (m100 >= 11 && m100 <= 14) return `${n} ${many}`;
    if (m10 === 1) return `${n} ${one}`;
    if (m10 >= 2 && m10 <= 4) return `${n} ${few}`;
    return `${n} ${many}`;
  };

  container.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">Проектов</div>
        <div class="kpi-value">${projCount}</div>
        <div class="kpi-share">${_tsh(projCount)}</div>
        <div class="kpi-bar"></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Продуктов</div>
        <div class="kpi-value">${prodCount}</div>
        <div class="kpi-share">${_tsh(prodCount)}</div>
        <div class="kpi-bar"></div>
      </div>
      <div class="kpi-card kpi-accent">
        <div class="kpi-label">Всего ценностей</div>
        <div class="kpi-value">${totalTasks}</div>
        <div class="kpi-share">${_plur(projCount,'проект','проекта','проектов')}<br>${_plur(prodCount,'продукт','продукта','продуктов')}</div>
        <div class="kpi-bar"></div>
      </div>
      <div class="kpi-card kpi-done">
        <div class="kpi-label">Выполнено</div>
        <div class="kpi-value">${dTask}</div>
        <div class="kpi-share">${_shTotal(dTask)}</div>
        <div class="kpi-bar"></div>
      </div>
      <div class="kpi-card kpi-green">
        <div class="kpi-label">В работе</div>
        <div class="kpi-value">${gTask}</div>
        <div class="kpi-share">${_shActive(gTask)}</div>
        <div class="kpi-bar"></div>
      </div>
      <div class="kpi-card kpi-yellow">
        <div class="kpi-label">Контроль</div>
        <div class="kpi-value">${yTask}</div>
        <div class="kpi-share">${_shActive(yTask)}</div>
        <div class="kpi-bar"></div>
      </div>
      <div class="kpi-card kpi-red">
        <div class="kpi-label">Критично</div>
        <div class="kpi-value">${rTask}</div>
        <div class="kpi-share">${_shActive(rTask)}</div>
        <div class="kpi-bar"></div>
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

  // Собираем месяцы из полного датасета, затем дополняем до 8
  const rawMonths = [];
  const seenM  = new Set();
  (appData ? appData.items : items).forEach(item =>
    item.subgroups.forEach(sg =>
      sg.tasks.forEach(t =>
        Object.keys(t.timeline).forEach(m => {
          if (!seenM.has(m)) { seenM.add(m); rawMonths.push(m); }
        })
      )
    )
  );
  // Сортируем хронологически, чтобы «последний плановый месяц»
  // в taskLaunchMonth совпадал с логикой isTaskDone() и KPI-карточек
  rawMonths.sort((a, b) => _monthIdx(a) - _monthIdx(b));
  const months = padToEightMonths(rawMonths);

  // ── Определяем текущий месяц для подсветки ──
  const _NOW   = new Date();
  const _MABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const _curKey = _MABBR[_NOW.getMonth()] + '-' + String(_NOW.getFullYear()).slice(2);
  // Преобразует "Sep-26" → числовой индекс для сравнения
  const _mToIdx = key => {
    const p = key.split('-');
    return parseInt('20' + p[1]) * 12 + _MABBR.indexOf(p[0]);
  };
  const _curIdx = _mToIdx(_curKey);
  const _monthCls = m => {
    const d = _mToIdx(m) - _curIdx;
    if (d === 0) return 'cal-col-current';
    if (d < 0)  return 'cal-col-past';
    return '';
  };

  let html = `
    <div class="cal-header-row">
      <span class="cal-section-title">Запуски по месяцам</span>
      <div class="cal-legend">
        <span class="cal-leg"><span class="cal-lb" style="background:rgba(220,38,38,0.18)"></span>Критично</span>
        <span class="cal-leg"><span class="cal-lb" style="background:rgba(217,119,6,0.18)"></span>Контроль</span>
        <span class="cal-leg"><span class="cal-lb" style="background:rgba(100,116,139,0.40)"></span>В работе</span>
        <span class="cal-leg"><span class="cal-lb cal-lb-done"></span>✓ Выполнено</span>
        <span class="cal-leg"><span class="cal-lb" style="background:rgba(26,108,255,0.25)"></span>Текущий месяц</span>
      </div>
    </div>
    <div class="cal-table-wrap">
      <table class="cal-table">
        <thead>
          <tr>
            <th class="cal-th cal-th-name">Наименование</th>
            <th class="cal-th cal-th-cnt">Ценности</th>
            ${months.map(m => {
              const tc = _monthCls(m);
              return `<th class="cal-th cal-th-m ${tc === 'cal-col-current' ? 'cal-th-current' : tc === 'cal-col-past' ? 'cal-th-past' : ''}"><span class="cal-month-badge">${formatMonth(m)}</span></th>`;
            }).join('')}
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

    // Подсчёт статусов для мини-бара (после taskLaunchMonth чтобы определить «Выполнено»)
    const total    = allTasks.length;
    const yCnt     = allTasks.filter(t => t.status === '🟡').length;
    const rCnt     = allTasks.filter(t => t.status === '🔴').length;
    // «Выполнено» = не 🔴, не 🟡 + в месяце запуска есть и план и факт + статус 🟢
    const doneCnt  = allTasks.filter(t => {
      if (t.status !== '🟢') return false;
      const lm = taskLaunchMonth.get(t.task);
      if (!lm) return false;
      const tl = t.timeline[lm] || {};
      return !!(tl.plan && tl.fact);
    }).length;
    // «В работе» = не 🔴, не 🟡, не выполнено (пустой статус сюда тоже входит)
    const gCnt     = total - yCnt - rCnt - doneCnt;

    // Считаем проценты прямо по каждому счётчику
    const donePct  = total && doneCnt ? Math.round(doneCnt / total * 100) : 0;
    const gPct     = total && gCnt    ? Math.round(gCnt    / total * 100) : 0;
    const yPct     = total && yCnt    ? Math.round(yCnt    / total * 100) : 0;
    const rPct     = total && rCnt    ? Math.round(rCnt    / total * 100) : 0;

    const typeCls = item.type === 'Проект' ? 'cal-type-project' : 'cal-type-product';
    html += `
      <tr class="cal-item-row ${rowCls} ${typeCls}">
        <td class="cal-td cal-td-name${item.businessNote ? ' has-biz-tip' : ''}"
            data-name="${escHtml(item.name)}"
            data-biz="${escHtml(item.businessNote || '')}">
          <span class="type-badge ${item.type === 'Проект' ? 'badge-project' : 'badge-product'}">${item.type}</span>
          <strong>${escHtml(item.name)}</strong>
        </td>
        <td class="cal-td cal-td-cnt">
          <div class="mini-stat">
            <span class="mini-stat-num">${total}</span>
            <div class="mini-bar" title="✓ ${doneCnt} / В работе ${gCnt} / 🟡 ${yCnt} / 🔴 ${rCnt}">
              ${doneCnt ? `<div class="mini-seg mini-done" style="width:${donePct}%"></div>` : ''}
              ${gCnt    ? `<div class="mini-seg mini-g"    style="width:${gPct}%"></div>`    : ''}
              ${yCnt    ? `<div class="mini-seg mini-y"    style="width:${yPct}%"></div>`    : ''}
              ${rCnt    ? `<div class="mini-seg mini-r"    style="width:${rPct}%"></div>`    : ''}
            </div>
            <div class="mini-counts">
              ${doneCnt ? `<span class="mc-done">${doneCnt}</span>` : ''}
              ${gCnt    ? `<span class="mc-g">${gCnt}</span>`       : ''}
              ${yCnt    ? `<span class="mc-y">${yCnt}</span>`       : ''}
              ${rCnt    ? `<span class="mc-r">${rCnt}</span>`       : ''}
            </div>
          </div>
        </td>
        ${months.map(m => {
          // Только задачи, чей последний плановый месяц — именно этот
          const tasksInMonth = allTasks.filter(t => taskLaunchMonth.get(t.task) === m);
          // Класс по временной позиции (текущий / прошлый / будущий)
          const timeCls = _monthCls(m);
          // Прошлый месяц + есть незакрытый план → «просрочено»
          const isOverdue = timeCls === 'cal-col-past' &&
            tasksInMonth.some(t => { const tl = t.timeline[m]||{}; return tl.plan && !tl.fact; });
          const finalTimeCls = isOverdue ? 'cal-col-overdue' : timeCls;

          if (!tasksInMonth.length) return `<td class="cal-td cal-td-m cal-td-empty ${finalTimeCls}"></td>`;

          // Цвет ячейки по наихудшему статусу
          const cHasR = tasksInMonth.some(t => t.status === '🔴');
          const cHasY = tasksInMonth.some(t => t.status === '🟡');
          const cellCls = cHasR ? 'cal-cell-r' : cHasY ? 'cal-cell-y' : 'cal-cell-g';

          const lines = tasksInMonth.map(t => {
            const tl = t.timeline[m] || {};
            const done = tl.plan && tl.fact && t.status === '🟢';
            /* done (факт закрыт) → зелёный «Выполнено»; 🟢 но не done → серый «В норме» */
            const barCls = t.status === '🔴' ? 'bar-r' : t.status === '🟡' ? 'bar-y' : done ? 'bar-done' : 'bar-g';
            return `<div class="cal-task-line ${barCls}${done ? ' cal-task-done' : ''}"
              data-task="${escHtml(t.task)}"
              data-desc="${escHtml(t.description || '')}"
              data-owner="${escHtml(t.owner || '')}"
              data-risk="${escHtml(t.risk && t.risk !== '-' ? t.risk : '')}">
              <span class="cal-task-nm">${done ? '<span class="cal-check">✓ </span>' : ''}${escHtml(t.task)}</span>
            </div>`;
          }).join('');

          return `<td class="cal-td cal-td-m ${cellCls} ${finalTimeCls}">${lines}</td>`;
        }).join('')}
      </tr>
    `;
  });

  html += `</tbody></table></div>`;
  container.innerHTML = html;
}

// ─── Вспомогательная: дополнить список месяцев до 8 ──────────────────────────
function padToEightMonths(months) {
  const SEQ = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const result = [...months];
  while (result.length < 8) {
    const last  = result[result.length - 1];
    const parts = last.split('-');
    const mIdx  = SEQ.indexOf(parts[0]);
    const nextM = SEQ[(mIdx + 1) % 12];
    const nextY = mIdx === 11 ? String(parseInt(parts[1]) + 1) : parts[1];
    result.push(nextM + '-' + nextY);
  }
  return result;
}

// ─── Тултипы КПЭ на ценностях в календаре ────────────────────────────────────
function attachCalendarTooltips(container) {
  if (!container) return;
  const tooltip = document.getElementById('task-tooltip');
  if (!tooltip) return;

  // Тултип на задачах (ценностях) внутри ячеек месяца
  container.querySelectorAll('.cal-task-line[data-task]').forEach(el => {
    el.style.cursor = 'help';

    el.addEventListener('mouseenter', e => {
      const name  = el.dataset.task  || '';
      const desc  = el.dataset.desc  || '';
      const owner = el.dataset.owner || '';
      const risk  = el.dataset.risk  || '';

      tooltip.querySelector('.tooltip-title').textContent = name;

      const descEl = tooltip.querySelector('.tooltip-desc');
      const rows = [];
      if (desc)  rows.push(`<div class="tip-row"><span class="tip-lbl">КПЭ:</span> ${escHtml(desc)}</div>`);
      if (owner) rows.push(`<div class="tip-row"><span class="tip-lbl">Отв.:</span> ${escHtml(owner)}</div>`);
      if (risk)  rows.push(`<div class="tip-row tip-risk"><span class="tip-lbl">⚠️ Риск:</span> ${escHtml(risk)}</div>`);
      descEl.innerHTML = rows.join('');
      descEl.style.display = rows.length ? '' : 'none';

      tooltip.querySelector('.tooltip-kpi').style.display = 'none';
      tooltip.classList.remove('hidden');
      positionTooltip(e, tooltip);
    });
    el.addEventListener('mousemove', e => positionTooltip(e, tooltip));
    el.addEventListener('mouseleave', () => tooltip.classList.add('hidden'));
  });

  // Тултип на названии проекта/продукта — показываем бизнес-нота курсивом
  container.querySelectorAll('.cal-td-name.has-biz-tip').forEach(el => {
    el.style.cursor = 'help';

    el.addEventListener('mouseenter', e => {
      const name = el.dataset.name || '';
      const biz  = el.dataset.biz  || '';

      tooltip.querySelector('.tooltip-title').textContent = name;

      const descEl = tooltip.querySelector('.tooltip-desc');
      descEl.innerHTML = biz
        ? `<div class="tip-row tip-biz"><em>${escHtml(biz)}</em></div>`
        : '';
      descEl.style.display = biz ? '' : 'none';
      tooltip.querySelector('.tooltip-kpi').style.display = 'none';

      tooltip.classList.remove('hidden');
      positionTooltip(e, tooltip);
    });
    el.addEventListener('mousemove', e => positionTooltip(e, tooltip));
    el.addEventListener('mouseleave', () => tooltip.classList.add('hidden'));
  });
}
