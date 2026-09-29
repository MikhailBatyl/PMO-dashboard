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

  // ── Текущий месяц в формате "Mon-YY" ─────────────────────────────────────
  const _MS  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const _now = new Date();
  const _nowStr = _MS[_now.getMonth()] + '-' + String(_now.getFullYear()).slice(2);
  // Позиция текущего месяца в Гантте (опорная точка для отклонений)
  // Если текущий месяц есть в массиве — берём его индекс.
  // Если нас ещё нет в диапазоне (будущее) — refPos = -1 (отклонений нет).
  // Если мы уже за диапазоном (прошлое) — refPos = последний месяц.
  const _curIdx = months.indexOf(_nowStr);
  const _nowNum = parseInt('20' + _nowStr.split('-')[1]) * 12
                + _MS.indexOf(_nowStr.split('-')[0]);
  const _firstNum = parseInt('20' + months[0].split('-')[1]) * 12
                  + _MS.indexOf(months[0].split('-')[0]);
  let refPos;
  if (_curIdx >= 0) {
    refPos = _curIdx;                   // текущий месяц виден в Гантте
  } else if (_nowNum < _firstNum) {
    refPos = -1;                        // мы ещё до начала диапазона → отклонений нет
  } else {
    refPos = months.length - 1;        // мы уже за диапазоном → все месяцы прошли
  }

  let html = `
    <div class="gantt-wrapper">
      <table class="gantt-table">
        <thead>
          <tr>
            <th class="gantt-task-col">Задача</th>
            ${months.map((m, i) => {
              const cls = i === refPos ? 'gantt-th-current'
                        : i < refPos  ? 'gantt-th-past'
                        : 'gantt-th-future';
              return `<th class="gantt-month-col ${cls}"><span class="gantt-month-badge">${m}</span></th>`;
            }).join('')}
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

        // Просрочка = факт без плана ИЛИ задача не выполнена и текущий месяц уже пришёл
        // после последнего планового (реальная дата зашла в следующий период)
        const hasMismatch  = months.some(m => { const tl = task.timeline[m] || {}; return tl.fact && !tl.plan; });
        const hasCarryover = !taskIsDone && lastPlanPos >= 0 && refPos > lastPlanPos;
        const isOverdue    = hasMismatch || hasCarryover;

        const isFocused = typeof ganttFocusTask !== 'undefined' && ganttFocusTask && ganttFocusTask === task.task;
        const rowClass  = `gantt-task-row${isFocused ? ' gantt-focused' : ''}`;

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
            // ── Плановый месяц, факт подтверждён ✓ ────────────────────
            planCls = 'gantt-strip-plan';
            factCls = 'gantt-strip-fact';

          } else if (tl.plan && !tl.fact) {
            // ── Плановый месяц, факта нет ──────────────────────────────
            planCls = 'gantt-strip-plan';
            if (monthIdx <= refPos) {
              // Плановый период уже наступил, а факт не подтверждён →
              // жёлтая полоска «должно быть в работе»
              factCls = 'gantt-strip-warning';
            }
            // Будущий плановый месяц — нижняя полоска пустая

          } else if (!tl.plan && tl.fact) {
            // ── Факт без плана (поздняя поставка) ──────────────────────
            // Задача выполнена позже срока → всегда красное отклонение
            factCls = 'gantt-strip-deviation';

          } else if (!taskIsDone && lastPlanPos >= 0
                     && monthIdx > lastPlanPos && monthIdx <= refPos) {
            // ── Месяцы ПОСЛЕ последнего планового, которые уже наступили
            //    → цвет зависит от статуса задачи ───────────────────────
            if (task.status === '🔴') {
              factCls = 'gantt-strip-deviation'; // красный — Критично
            } else if (task.status === '🟡') {
              factCls = 'gantt-strip-warning';   // жёлтый — Контроль
            }
            // 🟢 без факта — полоска пустая (нет видимого нарушения)
          }

          const warnSvg = `<svg class="gantt-warn-icon" width="10" height="10" viewBox="0 0 24 24" fill="none">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" fill="#e53935"/>
            <line x1="12" y1="9" x2="12" y2="13" stroke="white" stroke-width="2.2" stroke-linecap="round"/>
            <circle cx="12" cy="17.5" r="1.2" fill="white"/>
          </svg>`;

          html += `
            <td class="gantt-cell-month">
              <div class="gantt-strip ${planCls}"></div>
              <div class="gantt-strip ${factCls}">${factCls === 'gantt-strip-deviation' ? warnSvg : ''}</div>
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
