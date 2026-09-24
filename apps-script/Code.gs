/**
 * Code.gs — серверная логика Google Apps Script
 * Развёртывается как Web App: Execute as Me, Who has access — Only users in <ваш домен>
 *
 * Структура листа «Статус проектов и продуктов»:
 *
 *   Уровень 1 — col B = «Проект» / «Продукт» → заголовок группы
 *   Уровень 2 — col B пусто, col C (Наименование) непусто, col D (Ценность) пусто
 *               → подгруппа/раздел (col E/owner может быть заполнен — игнорируется)
 *   Уровень 3 — col D (Ценность) непусто И col E (Отв.) непусто → конкретная ценность
 *
 * Колонки (0-индексация):
 *  0  — №
 *  1  — Тип
 *  2  — Наименование (уровень 1: проект; уровень 2: подгруппа)
 *  3  — Ценность (уровень 3: название ценности)
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
 * 20  — Описание ценности (уровень 1: КПЭ/businessNote; уровень 3: tooltip)
 */

var SHEET_NAME = 'Статус проектов и продуктов';

var MONTHS = ['Sep-26', 'Oct-26', 'Nov-26', 'Dec-26', 'Jan-27'];
var TIMELINE_START_COL = 10;

// ─── doGet ────────────────────────────────────────────────────────────────────
function doGet(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  var data = parseSheet(sheet);
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── doPost ───────────────────────────────────────────────────────────────────
function doPost(e) {
  var payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse({ ok: false, error: 'Неверный JSON: ' + err.message });
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  var rows = sheet.getDataRange().getValues();

  var fieldToCol = { status: 6, trend: 7, risk: 8, deviationReason: 9 };

  for (var i = 0; i < rows.length; i++) {
    // Строка уровня 3: col D (Ценность) = id, col E (Отв.) непусто
    if (String(rows[i][3]).trim() === String(payload.id).trim() && rows[i][4]) {

      if (payload.field === 'timeline') {
        var monthIdx = MONTHS.indexOf(payload.value.month);
        if (monthIdx === -1) return jsonResponse({ ok: false, error: 'Неизвестный месяц' });
        var colOffset = payload.value.type === 'plan' ? 0 : 1;
        var col = TIMELINE_START_COL + monthIdx * 2 + colOffset;
        sheet.getRange(i + 1, col + 1).setValue(payload.value.checked ? '+' : '');
      } else {
        var col = fieldToCol[payload.field];
        if (col === undefined) return jsonResponse({ ok: false, error: 'Неизвестное поле' });
        sheet.getRange(i + 1, col + 1).setValue(payload.value);
      }

      return jsonResponse({ ok: true, row: i + 1 });
    }
  }

  return jsonResponse({ ok: false, error: 'Ценность не найдена: ' + payload.id });
}

// ─── parseSheet ───────────────────────────────────────────────────────────────
function parseSheet(sheet) {
  var rows = sheet.getDataRange().getValues();
  var items = [];
  var currentItem    = null;
  var currentSubgroup = null;

  for (var i = 1; i < rows.length; i++) {
    var row   = rows[i];
    var type  = String(row[1]).trim();   // B — Тип
    var name  = String(row[2]).trim();   // C — Наименование
    var value = String(row[3]).trim();   // D — Ценность
    var owner = String(row[4]).trim();   // E — Отв. (PM)

    // Пропускаем полностью пустые строки
    if (!type && !name && !value) continue;

    // ── Уровень 1: заголовок проекта/продукта ──────────────────────────────
    if (type === 'Проект' || type === 'Продукт') {
      var noteVal = String(row[20] || '').trim();
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

    // ── Уровень 3 (ПРИОРИТЕТ): col D (Ценность) И col E (Отв.) непусты ────
    // Проверяем ДО уровня 2, чтобы строки с ценностью не стали подгруппой
    if (value && owner) {
      var task = {
        task:            value,
        owner:           owner,
        priority:        parseInt(String(row[5]).trim()) || null,
        status:          String(row[6]).trim(),
        trend:           String(row[7]).trim(),
        risk:            String(row[8]).trim() || '-',
        deviationReason: String(row[9]).trim() || '-',
        description:     String(row[20] || '').trim(),
        timeline:        {}
      };

      for (var m = 0; m < MONTHS.length; m++) {
        var planCol = TIMELINE_START_COL + m * 2;
        task.timeline[MONTHS[m]] = {
          plan: !!(String(row[planCol]).trim()),
          fact: !!(String(row[planCol + 1]).trim())
        };
      }

      if (currentSubgroup) currentSubgroup.tasks.push(task);
      continue;
    }

    // ── Уровень 2: col C (Наименование) непусто, col D (Ценность) пусто ───
    // Работает даже если col E (Отв.) заполнен — строка всё равно подгруппа
    if (!type && name && !value) {
      currentSubgroup = { subgroupName: name, tasks: [] };
      currentItem.subgroups.push(currentSubgroup);
      continue;
    }
  }

  return { items: items };
}

// ─── Утилиты ──────────────────────────────────────────────────────────────────
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
  return str.split('').map(function(c){ return map[c] || c; })
    .join('').replace(/\s+/g,'_').replace(/[^a-z0-9_]/gi,'').toLowerCase();
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
