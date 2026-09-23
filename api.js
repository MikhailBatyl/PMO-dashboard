/**
 * api.js — обёртка над fetch к Google Apps Script Web App
 * Замените значение APPS_SCRIPT_URL на URL вашего деплоя Apps Script
 */

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz02nK3oTfWZaArRrRV-IMKZrPCPqTBFWAEB-BFd-8vfIsZNike9i-D5R_cCl56sr_Y/exec';

// Ключ и TTL кэша в localStorage (2 минуты)
const CACHE_KEY = 'pmo_data_cache';
const CACHE_TTL = 2 * 60 * 1000;

/**
 * Получить данные с API.
 * Сначала проверяет кэш в localStorage, при устаревании — загружает заново.
 */
async function fetchData(forceRefresh = false) {
  if (!forceRefresh) {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const { timestamp, data } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_TTL) {
        return data;
      }
    }
  }

  const response = await fetch(APPS_SCRIPT_URL, { method: 'GET' });
  if (!response.ok) throw new Error(`Ошибка загрузки данных: ${response.status}`);

  const data = await response.json();
  localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data }));
  return data;
}

/**
 * Обновить значение поля задачи в Google Таблице через doPost.
 * @param {string} id  — идентификатор задачи (name)
 * @param {string} field — название поля (status, trend, risk, deviationReason, timeline)
 * @param {*}      value — новое значение
 */
async function updateField(id, field, value) {
  const body = JSON.stringify({ id, field, value });
  const response = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    body,
  });
  if (!response.ok) throw new Error(`Ошибка сохранения: ${response.status}`);

  // Сбрасываем кэш, чтобы при следующей загрузке пришли свежие данные
  localStorage.removeItem(CACHE_KEY);

  return response.json();
}
