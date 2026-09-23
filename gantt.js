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
            ${months.map(m => `<th class="gantt-month-col" colspan="2">${m}</th>`).join('')}
          </tr>
          <tr>
            <th></th>
            ${months.map(() => `
              <th class="gantt-sub-col gantt-plan-header">П</th>
              <th class="gantt-sub-col gantt-fact-header">Ф</th>
            `).join('')}
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
          ${item.businessNote ? `<span class="gantt-biz-note">${escapeHtml(item.businessNote)}</span>` : ''}
        </td>
        ${months.map(() => `<td class="gantt-cell" colspan="2"></td>`).join('')}
      </tr>
    `;

    item.subgroups.forEach(subgroup => {
      // Строка подгруппы (если есть)
      if (subgroup.subgroupName) {
        html += `
          <tr class="gantt-group-row gantt-level2">
            <td class="gantt-task-name gantt-subgroup-name">— ${escapeHtml(subgroup.subgroupName)}</td>
            ${months.map(() => `<td class="gantt-cell" colspan="2"></td>`).join('')}
          </tr>
        `;
      }

      subgroup.tasks.forEach(task => {
        const statusClass = statusToClass(task.status);

        // Проверяем: есть ли факт в месяце, где плана нет → просрочка
        const isOverdue = months.some(month => {
          const tl = task.timeline[month] || { plan: false, fact: false };
          return tl.fact && !tl.plan;
        });

        const rowClass = isOverdue ? 'gantt-task-row gantt-overdue' : `gantt-task-row ${statusClass}`;

        html += `<tr class="${rowClass}">
          <td class="gantt-task-name gantt-task-indent">
            <span class="status-dot">${task.status}</span>
            ${escapeHtml(task.task)}
            <span class="gantt-owner">${escapeHtml(task.owner)}</span>
          </td>`;

        months.forEach(month => {
          const tl = task.timeline[month] || { plan: false, fact: false };
          // Расхождение: план есть, факта нет
          const deviationClass = (tl.plan && !tl.fact) ? 'gantt-cell-deviation' : '';

          html += `
            <td class="gantt-cell ${tl.plan ? 'gantt-cell-plan' : ''}"></td>
            <td class="gantt-cell ${tl.fact ? 'gantt-cell-fact' : deviationClass}"></td>
          `;
        });

        html += `</tr>`;
      });
    });
  });

  html += `</tbody></table></div>`;
  container.innerHTML = html;
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
