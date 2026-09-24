/**
 * Code.gs — серверная логика Google Apps Script
 * Развёртывается как Web App: Execute as Me, Who has access — Only users in <ваш домен>
 *
 * Структура листа «Статус проектов и продуктов»:
 * Строки бывают трёх типов (распознаются по колонкам):
 *   Уровень 1 — строка с «Проект» или «Продукт» в колонке B → заголовок группы
 *   Уровень 2 — B пусто, C непусто, D (Ценность) пусто, E (Отв.) пусто → подгруппа
 *   Уровень 3 — D (Ценность) непусто и E (Отв.) непусто → конкретная ценность/задача
 *
 * Колонки (0-индексация):
 *  0  — №
 *  1  — Тип
 *  2  — Наименование (проект/продукт на уровне 1, подгруппа на уровне 2)
 *  3  — Ценность (название ценности/задачи, уровень 3)
 *  4  — Отв. (PM)
 *  5  — Приоритет
 *  6  — Динамика ДК (статус: 🟢/🟡/🔴)
 *  7  — Тренд (↑/→/↓)
 *  8  — Ключевой риск
 *  9  — Причина отклонения
 * 10  — Sep-26 План
 * 11  — Sep-26 Факт
 * 12  — Oct-26 План
 * 13  — Oct-26 Факт
 * 14  — Nov-26 План
 * 15  — Nov-26 Факт
 * 16  — Dec-26 План
 * 17  — Dec-26 Факт
 * 18  — Jan-27 План
 * 19  — Jan-27 Факт
 * 20  — Описание ценности (уровень 1: бизнес-эффект/КПЭ; уровень 3: описание для tooltip)
 */

var SHEET_NAME = 'Статус проектов и продуктов';

// Список месяцев в том же порядке, что и колонки листа
var MONTHS = ['Sep-26', 'Oct-26', 'Nov-26', 'Dec-26', 'Jan-27'];
// Индекс первой колонки плана Sep-26
var TIMELINE_START_COL = 10;

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
 * doPost — обновление одной ячейки по имени ценности и названию поля
 * Тело запроса: { id, field, value }
 *   id    — точное название ценности (колонка D, уровень 3)
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

  // Маппинг полей на индексы столбцов (новая структура)
  var fieldToCol = {
    status: 6,
    trend: 7,
    risk: 8,
    deviationReason: 9
  };

  for (var i = 0; i < rows.length; i++) {
    // Ищем строку ценности (уровень 3) по col D (Ценность) + проверяем наличие col E (Отв.)
    if (String(rows[i][3]).trim() === String(payload.id).trim() && rows[i][4]) {

      if (payload.field === 'timeline') {
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

  return jsonResponse({ ok: false, error: 'Ценность не найдена: ' + payload.id });
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
    var type  = String(row[1]).trim();   // Тип (B)
    var name  = String(row[2]).trim();   // Наименование (C)
    var value = String(row[3]).trim();   // Ценность (D)
    var owner = String(row[4]).trim();   // Отв. (PM) (E)

    // Пропускаем пустые строки
    if (!name && !type && !value) continue;

    // ── Уровень 1 — заголовок проекта/продукта ──
    if (type === 'Проект' || type === 'Продукт') {
      // Описание/КПЭ читаем из колонки U (индекс 20 = "Описание ценности")
      var noteVal = String(row[20] || '').trim();
      // Fallback: ищем первую непустую ячейку после колонки таймлайна
      if (!noteVal) {
        for (var ci = row.length - 1; ci >= 21; ci--) {
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

    // ── Уровень 2 — подгруппа: B пусто, C непусто, D пусто, E пусто ──
    if (!type && name && !value && !owner) {
      currentSubgroup = { subgroupName: name, tasks: [] };
      currentItem.subgroups.push(currentSubgroup);
      continue;
    }

    // ── Уровень 3 — ценность/задача: есть ответственный (E) ──
    if (owner) {
      // Название ценности из col D; если D пусто — fallback на col C
      var taskName = value || name;

      var task = {
        task:            taskName,
        owner:           owner,
        priority:        parseInt(String(row[5]).trim()) || null,  // F
        status:          String(row[6]).trim(),                    // G
        trend:           String(row[7]).trim(),                    // H
        risk:            String(row[8]).trim() || '-',             // I
        deviationReason: String(row[9]).trim() || '-',             // J
        description:     String(row[20] || '').trim(),            // U — Описание ценности (tooltip)
        timeline:        {}
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
