/**
 * gantt.js — компонент Гантт-диаграммы по месяцам (план/факт)
 * Группировка: Наименование → Направление → Задачи
 */

/**
 * Рендерит Гантт-диаграмму в переданный DOM-элемент
 * @param {HTMLElement} container — контейнер для отрисовки
 * @param {Array}       items     — массив items из JSON API
 */
function renderGantt(container, items) {
  if (!items || items.length === 0) {
    container.innerHTML = '<p class="no-data">Нет данных для отображения</p>';
    return;
  }

  // Собираем все месяцы из данных
  const months = collectMonths(items);

  let html = `
    <div class="gantt-wrapper">
      <table class="gantt-table">
        <thead>
          <tr>
            <th class="gantt-task-col">Задача</th>
            ${months.map(m => `<th class="gantt-month-col">${m}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
  `;

  items.forEach(item => {
    // Строка заголовка продукта/проекта
    html += `
      <tr class="gantt-group-row gantt-level1">
        <td class="gantt-task-name">
          <span class="gantt-type-badge ${item.type === 'Проект' ? 'badge-project' : 'badge-product'}">${item.type}</span>
          <strong>${escapeHtml(item.name)}</strong>
          ${item.businessNote ? `<span class="gantt-biz-note">${item.businessNote.split(/\.\s+|\n/).filter(Boolean).map((s,i,a) => escapeHtml(s) + (i < a.length-1 ? '.' : '')).join('<br>')}</span>` : ''}
        </td>
        ${months.map(() => `<td class="gantt-cell-month"></td>`).join('')}
      </tr>
    `;

    item.subgroups.forEach(subgroup => {
      // Строка подгруппы (если есть)
      if (subgroup.subgroupName) {
        html += `
          <tr class="gantt-group-row gantt-level2">
            <td class="gantt-task-name gantt-subgroup-name">— ${escapeHtml(subgroup.subgroupName)}</td>
            ${months.map(() => `<td class="gantt-cell-month"></td>`).join('')}
          </tr>
        `;
      }

      subgroup.tasks.forEach(task => {
        // Задача считается «Выполнено» если функция isTaskDone доступна (из app.js)
        const taskIsDone = typeof isTaskDone === 'function' ? isTaskDone(task) : false;

        const statusClass = statusToClass(task.status);

        // Индекс последнего планового месяца (хронологически по порядку в массиве months)
        const allPlanMonths = months.filter(m => (task.timeline[m] || {}).plan);
        const lastPlanPos   = allPlanMonths.length > 0
          ? months.indexOf(allPlanMonths[allPlanMonths.length - 1])
          : -1;

        // Просрочка = факт без плана ИЛИ задача не выполнена и есть месяцы после последнего плана
        const hasMismatch  = months.some(m => { const tl = task.timeline[m] || {}; return tl.fact && !tl.plan; });
        const hasCarryover = !taskIsDone && lastPlanPos >= 0 && lastPlanPos < months.length - 1;
        const isOverdue    = hasMismatch || hasCarryover;

        const isFocused = typeof ganttFocusTask !== 'undefined' && ganttFocusTask && ganttFocusTask === task.task;
        const rowClass  = isOverdue
          ? `gantt-task-row gantt-overdue${isFocused ? ' gantt-focused' : ''}`
          : `gantt-task-row ${statusClass}${isFocused ? ' gantt-focused' : ''}`;

        // CSS-точка статуса (серый=В работе, жёлтый=Контроль, красный=Критично)
        const dotCls = task.status === '🟢' ? 'dot-g' : task.status === '🟡' ? 'dot-y' : 'dot-r';

        html += `<tr class="${rowClass}">
          <td class="gantt-task-name gantt-task-indent">
            <span class="status-dot ${dotCls}"></span>
            ${escapeHtml(task.task)}
            <span class="gantt-owner">${escapeHtml(task.owner)}</span>
          </td>`;

        months.forEach((month, monthIdx) => {
          const tl = task.timeline[month] || { plan: false, fact: false };

          let planCls = '';
          let factCls = '';

          if (tl.plan && tl.fact) {
            // Плановый месяц — факт подтверждён ✓
            planCls = 'gantt-strip-plan';
            factCls = 'gantt-strip-fact';
          } else if (tl.plan && !tl.fact) {
            // Плановый месяц — факта нет → отклонение (если не выполнено)
            planCls = 'gantt-strip-plan';
            factCls = taskIsDone ? '' : 'gantt-strip-deviation';
          } else if (!tl.plan && tl.fact) {
            // Факт зафиксирован в непланируемом месяце (поздняя поставка)
            factCls = 'gantt-strip-fact';
          } else if (!taskIsDone && lastPlanPos >= 0 && monthIdx > lastPlanPos) {
            // Нет ни плана, ни факта, но задача не выполнена и план уже позади
            // → отклонение протягивается вперёд
            factCls = 'gantt-strip-deviation';
          }

          html += `
            <td class="gantt-cell-month">
              <div class="gantt-strip ${planCls}"></div>
              <div class="gantt-strip ${factCls}"></div>
            </td>
          `;
        });

        html += `</tr>`;
      });
    });
  });

  html += `</tbody></table></div>`;

  // Баннер активной задачи
  const focusBanner = (typeof ganttFocusTask !== 'undefined' && ganttFocusTask)
    ? `<div class="gantt-focus-banner">Показана задача: <strong>${escapeHtml(ganttFocusTask)}</strong>
        <button onclick="ganttFocusTask=null;renderGantt(document.getElementById('gantt-container'),window.appData?appData.items:[]);" class="gantt-focus-clear">× Сбросить фильтр</button></div>`
    : '';

  container.innerHTML = focusBanner + html;
}


/**
 * Собирает уникальный список месяцев из всех задач в порядке следования
 */
function collectMonths(items) {
  const seen = new Set();
  const months = [];
  items.forEach(item => {
    item.subgroups.forEach(sg => {
      sg.tasks.forEach(task => {
        Object.keys(task.timeline).forEach(month => {
          if (!seen.has(month)) {
            seen.add(month);
            months.push(month);
          }
        });
      });
    });
  });
  return months;
}

/**
 * Преобразует статус-эмодзи в CSS-класс
 */
function statusToClass(status) {
  if (status === '🟢') return 'status-green';
  if (status === '🟡') return 'status-yellow';
  if (status === '🔴') return 'status-red';
  return '';
}

/**
 * Экранирование HTML
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
