/**
 * Code.gs — серверная логика Google Apps Script
 * Развёртывается как Web App: Execute as Me, Who has access — Only users in <ваш домен>
 *
 * Структура листа «Статус проектов и продуктов»:
 * Строки бывают трёх типов (распознаются по колонке B «Тип»):
 *   Уровень 1 — строка с «Проект» или «Продукт» → заголовок группы
 *   Уровень 2 — строка, где B пуст, C непуст, D пуст → подгруппа (Направление)
 *   Уровень 3 — строка с заполненным D (Отв.) → конкретная задача
 *
 * Колонки (0-индексация):
 *  0  — №
 *  1  — Тип
 *  2  — Наименование / задача
 *  3  — Отв. (PM)
 *  4  — Приоритет
 *  5  — Динамика ДК (статус: 🟢/🟡/🔴)
 *  6  — Тренд (↑/→/↓)
 *  7  — Ключевой риск
 *  8  — Причина отклонения
 *  9  — Sep-26 План
 * 10  — Sep-26 Факт
 * 11  — Oct-26 План
 * 12  — Oct-26 Факт
 * 13  — Nov-26 План
 * 14  — Nov-26 Факт
 * 15  — Dec-26 План
 * 16  — Dec-26 Факт
 * 17  — Jan-27 План
 * 18  — Jan-27 Факт
 * 19  — Примечание (бизнес-эффект, заполняется на строке Уровня 1)
 */

var SHEET_NAME = 'Статус проектов и продуктов';

// Список месяцев в том же порядке, что и колонки листа
var MONTHS = ['Sep-26', 'Oct-26', 'Nov-26', 'Dec-26', 'Jan-27'];
// Индекс первой колонки плана Sep-26
var TIMELINE_START_COL = 9;

/**
 * doGet — чтение листа и отдача JSON
 */
function doGet(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  var data = parseSheet(sheet);
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * doPost — обновление одной ячейки по имени задачи и названию поля
 * Тело запроса: { id, field, value }
 *   id    — точное название задачи (колонка C на Уровне 3)
 *   field — 'status' | 'trend' | 'risk' | 'deviationReason' | 'timeline'
 *   value — новое значение
 */
function doPost(e) {
  var payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse({ ok: false, error: 'Неверный JSON: ' + err.message });
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  var rows = sheet.getDataRange().getValues();

  var fieldToCol = {
    status: 5,
    trend: 6,
    risk: 7,
    deviationReason: 8
  };

  for (var i = 0; i < rows.length; i++) {
    // Ищем строку задачи (Уровень 3) по точному совпадению названия
    if (String(rows[i][2]).trim() === String(payload.id).trim() && rows[i][3]) {

      if (payload.field === 'timeline') {
        // Обновляем конкретную ячейку плана или факта
        // payload.value: { month: 'Sep-26', type: 'plan'|'fact', checked: true|false }
        var monthIdx = MONTHS.indexOf(payload.value.month);
        if (monthIdx === -1) {
          return jsonResponse({ ok: false, error: 'Неизвестный месяц: ' + payload.value.month });
        }
        var colOffset = payload.value.type === 'plan' ? 0 : 1;
        var col = TIMELINE_START_COL + monthIdx * 2 + colOffset;
        sheet.getRange(i + 1, col + 1).setValue(payload.value.checked ? '+' : '');
      } else {
        var col = fieldToCol[payload.field];
        if (col === undefined) {
          return jsonResponse({ ok: false, error: 'Неизвестное поле: ' + payload.field });
        }
        sheet.getRange(i + 1, col + 1).setValue(payload.value);
      }

      return jsonResponse({ ok: true, row: i + 1 });
    }
  }

  return jsonResponse({ ok: false, error: 'Задача не найдена: ' + payload.id });
}

/**
 * Парсит лист в иерархическую структуру JSON
 */
function parseSheet(sheet) {
  var rows = sheet.getDataRange().getValues();
  var items = [];
  var currentItem = null;
  var currentSubgroup = null;

  for (var i = 1; i < rows.length; i++) { // пропускаем строку заголовков (i=0)
    var row = rows[i];
    var num = String(row[0]).trim();
    var type = String(row[1]).trim();
    var name = String(row[2]).trim();
    var owner = String(row[3]).trim();

    // Пропускаем пустые строки
    if (!name && !type) continue;

    // Уровень 1 — заголовок проекта/продукта
    if (type === 'Проект' || type === 'Продукт') {
      // Описание читаем из колонки T (индекс 19); если пусто — ищем в последней непустой ячейке строки
      var noteVal = String(row[19] || '').trim();
      if (!noteVal) {
        for (var ci = row.length - 1; ci >= 20; ci--) {
          var cv = String(row[ci] || '').trim();
          if (cv) { noteVal = cv; break; }
        }
      }
      currentItem = {
        id: transliterate(name),
        type: type,
        name: name,
        businessNote: noteVal,
        subgroups: []
      };
      currentSubgroup = { subgroupName: null, tasks: [] };
      currentItem.subgroups.push(currentSubgroup);
      items.push(currentItem);
      continue;
    }

    if (!currentItem) continue;

    // Уровень 2 — подгруппа (Направление): B пусто, C непусто, D пусто
    if (!type && name && !owner) {
      currentSubgroup = { subgroupName: name, tasks: [] };
      currentItem.subgroups.push(currentSubgroup);
      continue;
    }

    // Уровень 3 — задача: есть ответственный
    if (owner) {
      var task = {
        task: name,
        owner: owner,
        priority: parseInt(String(row[4]).trim()) || null,
        status: String(row[5]).trim(),
        trend: String(row[6]).trim(),
        risk: String(row[7]).trim() || '-',
        deviationReason: String(row[8]).trim() || '-',
        timeline: {}
      };

      // Читаем плановые и фактические значения по каждому месяцу
      for (var m = 0; m < MONTHS.length; m++) {
        var planCol = TIMELINE_START_COL + m * 2;
        var factCol = planCol + 1;
        task.timeline[MONTHS[m]] = {
          plan: !!(String(row[planCol]).trim()),
          fact: !!(String(row[factCol]).trim())
        };
      }

      if (currentSubgroup) {
        currentSubgroup.tasks.push(task);
      }
    }
  }

  return { items: items };
}

/**
 * Простая транслитерация для генерации ID из названия
 */
function transliterate(str) {
  var map = {
    'А':'a','Б':'b','В':'v','Г':'g','Д':'d','Е':'e','Ё':'yo','Ж':'zh',
    'З':'z','И':'i','Й':'y','К':'k','Л':'l','М':'m','Н':'n','О':'o',
    'П':'p','Р':'r','С':'s','Т':'t','У':'u','Ф':'f','Х':'kh','Ц':'ts',
    'Ч':'ch','Ш':'sh','Щ':'shch','Ъ':'','Ы':'y','Ь':'','Э':'e','Ю':'yu','Я':'ya',
    'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo','ж':'zh',
    'з':'z','и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o',
    'п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts',
    'ч':'ch','ш':'sh','щ':'shch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya'
  };
  return str.split('').map(function(c) {
    return map[c] || c;
  }).join('').replace(/\s+/g, '_').replace(/[^a-z0-9_]/gi, '').toLowerCase();
}

/**
 * Вспомогательная функция для возврата JSON-ответа
 */
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
