'use strict';

const DATA_KEY = 'tide.progress.data.v1';
const LOCAL_EDIT_KEY = 'tide.progress.local-edited.v1';
const REMINDER_KEY = 'tide.progress.reminder.v1';
const REMINDER_STATE_KEY = 'tide.progress.reminder-state.v1';
const CLOUD_KEY = 'tide.progress.cloud.v1';
const CHECKPOINT_KEY = 'tide.progress.last-checkpoint.v1';
const THEME_KEY = 'tide.progress.theme.v1';
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
function getTheme() { return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'; }
function applyTheme(theme = getTheme()) {
  document.documentElement.dataset.theme = theme;
  document.body.dataset.theme = theme;
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.content = theme === 'dark' ? '#171824' : '#f7f3fb';
  const toggle = $('#theme-dark');
  if (toggle) toggle.checked = theme === 'dark';
}
applyTheme();

const CONTEXT_TAG_OPTIONS = [
  { name: 'Food', note: 'Meals and snacks' },
  { name: 'Prayer', note: 'Salah and prayer time' },
  { name: 'Important works', note: 'Essential tasks and responsibilities' },
  { name: 'Wasting time', note: 'Time I would rather use differently' },
  { name: 'Sleep', note: 'Rest and recovery' }
];

const DEFAULT_HABITS = [
  { id: 'fajr', name: 'Fajr salah', group: 'Salah', mode: 'done', helper: '' },
  { id: 'dhuhr', name: 'Dhuhr salah', group: 'Salah', mode: 'done', helper: '' },
  { id: 'asr', name: 'Asr salah', group: 'Salah', mode: 'done', helper: '' },
  { id: 'maghrib', name: 'Maghrib salah', group: 'Salah', mode: 'done', helper: '' },
  { id: 'isha', name: 'Isha salah', group: 'Salah', mode: 'done', helper: '' },
  { id: 'quran', name: 'Quran', group: 'Faith', mode: 'done', helper: '' },
  { id: 'study', name: 'Study', group: 'Learning', mode: 'done', helper: '' },
  { id: 'ielts', name: 'IELTS', group: 'Learning', mode: 'done', helper: '' },
  { id: 'gre', name: 'GRE', group: 'Learning', mode: 'done', helper: '' },
  { id: 'research', name: 'Research', group: 'Learning', mode: 'done', helper: '' },
  { id: 'tuition', name: 'Tuition', group: 'Work', mode: 'done', helper: '' },
  { id: 'porn-free', name: 'P-free day', group: 'Personal', mode: 'avoid', helper: '' }
];

function localDate(date = new Date()) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function dateFromKey(key) { return new Date(`${key}T12:00:00`); }
function addDays(key, amount) { const d = dateFromKey(key); d.setDate(d.getDate() + amount); return localDate(d); }
function daysBetween(a, b) { return Math.round((dateFromKey(b) - dateFromKey(a)) / 86400000); }
function fmtDate(key, options = { weekday: 'short', month: 'short', day: 'numeric' }) { return dateFromKey(key).toLocaleDateString(undefined, options); }
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch])); }
function uid() { return `h-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`; }
function defaultData() {
  return { version: 1, startDate: localDate(), updatedAt: new Date().toISOString(), habits: DEFAULT_HABITS.map(h => ({ ...h })), daily: {} };
}
function loadData() {
  try {
    const parsed = JSON.parse(localStorage.getItem(DATA_KEY));
    if (!parsed || typeof parsed !== 'object') return defaultData();
    parsed.version = 1;
    parsed.startDate ||= localDate();
    parsed.habits = Array.isArray(parsed.habits) ? parsed.habits : DEFAULT_HABITS.map(h => ({ ...h }));
    parsed.habits.forEach(habit => {
      if (habit.id === 'study') habit.helper = '';
      if (habit.id === 'porn-free') {
        habit.name = 'P-free day';
        habit.helper = '';
      }
    });
    parsed.daily = parsed.daily && typeof parsed.daily === 'object' ? parsed.daily : {};
    parsed.updatedAt ||= new Date(0).toISOString();
    return parsed;
  } catch { return defaultData(); }
}
let data = loadData();
if (!localStorage.getItem(DATA_KEY)) localStorage.setItem(DATA_KEY, JSON.stringify(data));

// A freshly opened device gets default data in localStorage. That default must
// never be treated as newer user progress and uploaded over an existing cloud row.
function hasMeaningfulLocalData() {
  if (localStorage.getItem(LOCAL_EDIT_KEY) === '1') return true;
  if (Object.keys(data.daily || {}).length > 0) return true;
  return JSON.stringify(data.habits || []) !== JSON.stringify(DEFAULT_HABITS);
}

let currentPage = 'overview';
let selectedDate = localDate();
let selectedHour = new Date().getHours();
let tagPickerOpen = false;
let reportMode = '3day';
let deferredInstallPrompt = null;
let reminderModalContext = null;
let supabaseClient = null;
let syncUser = null;
let realtimeChannel = null;
let cloudSyncTimer = null;
let applyingRemote = false;
let syncLabel = 'Saved on this device';

function readDay(date) {
  return data.daily[date] || { study: {}, tags: {}, habits: {} };
}
function ensureDay(date) {
  if (!data.daily[date]) data.daily[date] = { study: {}, tags: {}, habits: {} };
  const day = data.daily[date];
  day.study ||= {}; day.tags ||= {}; day.habits ||= {};
  return day;
}
function minutesForHour(date, hour) {
  const value = readDay(date).study?.[String(hour)];
  // Migration support for an earlier local prototype that stored six 10-minute booleans.
  if (Array.isArray(value)) return Math.min(60, value.filter(Boolean).length * 10);
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(60, Math.max(0, Math.round(numeric / 10) * 10));
}
function tagsFor(date, hour) {
  const tags = readDay(date).tags?.[String(hour)];
  return Array.isArray(tags) ? tags : [];
}
function tagKind(tag) {
  const value = String(tag || '').trim().toLowerCase();
  if (value === 'food') return 'circle';
  if (value === 'prayer') return 'square';
  if (value.startsWith('important work')) return 'triangle';
  if (value === 'wasting time') return 'cross';
  if (value === 'sleep') return 'hexagon';
  return 'other';
}
function tagGlyph(tag) {
  const kind = tagKind(tag);
  const shapes = {
    circle: '<circle cx="9" cy="9" r="6.2" fill="#ffbd4a" stroke="#242638" stroke-width="2"/>',
    square: '<rect x="2.8" y="2.8" width="12.4" height="12.4" rx="2" fill="#65caff" stroke="#242638" stroke-width="2"/>',
    triangle: '<path d="M9 2.1 16.1 15H1.9Z" fill="#8cdb75" stroke="#242638" stroke-width="2" stroke-linejoin="round"/>',
    cross: '<path d="M5 5 13 13M13 5 5 13" stroke="#242638" stroke-width="6" stroke-linecap="round"/><path d="M5 5 13 13M13 5 5 13" stroke="#ff6f83" stroke-width="3.2" stroke-linecap="round"/>',
    hexagon: '<path d="M4.1 2.5h9.8L16.7 9l-2.8 6.5H4.1L1.3 9Z" fill="#b8a8d8" stroke="#242638" stroke-width="1.8" stroke-linejoin="round"/>',
    other: '<path d="M9 1.8 16.2 9 9 16.2 1.8 9Z" fill="#b8a8d8" stroke="#242638" stroke-width="1.8"/>'
  };
  return `<svg class="tag-glyph tag-glyph-${kind}" viewBox="0 0 18 18" role="img" aria-label="${kind} tag">${shapes[kind]}</svg>`;
}
function renderTagChip(tag, index, date, hour) {
  return `<span class="tag-chip">${tagGlyph(tag)}<span>${esc(tag)}</span><button data-action="remove-tag" data-date="${date}" data-hour="${hour}" data-index="${index}" aria-label="Remove ${esc(tag)}">×</button></span>`;
}
function renderTagPicker(date, hour) {
  const selected = new Set(tagsFor(date, hour).map(tag => String(tag).toLowerCase()));
  const options = CONTEXT_TAG_OPTIONS.map(option => `<label class="tag-option"><input type="checkbox" data-action="tag-toggle" data-date="${date}" data-hour="${hour}" data-tag="${esc(option.name)}" ${selected.has(option.name.toLowerCase()) ? 'checked' : ''}><span class="tag-option-glyph">${tagGlyph(option.name)}</span><span class="tag-option-copy"><strong>${esc(option.name)}</strong><small>${esc(option.note)}</small></span></label>`).join('');
  const count = selected.size;
  return `<div class="tag-picker"><button type="button" class="tag-picker-trigger ${tagPickerOpen ? 'is-open' : ''}" data-action="toggle-tag-picker" aria-expanded="${tagPickerOpen}"><span class="tag-picker-trigger-copy"><strong>Choose context tags</strong><small>Multiple selections allowed</small></span><span class="tag-picker-count">${count} selected</span><span class="tag-picker-chevron">${tagPickerOpen ? '⌃' : '⌄'}</span></button>${tagPickerOpen ? `<div class="tag-picker-menu">${options}</div>` : ''}</div>`;
}
function renderHourContextBox(date, hour) {
  const selected = tagsFor(date, hour).find(tag => CONTEXT_TAG_OPTIONS.some(option => option.name.toLowerCase() === String(tag).toLowerCase()));
  const options = CONTEXT_TAG_OPTIONS.map(option => `<option value="${esc(option.name)}" ${selected?.toLowerCase() === option.name.toLowerCase() ? 'selected' : ''}>${esc(option.name)}</option>`).join('');
  return `<div class="hour-context-box ${selected ? 'has-context' : ''}">${selected ? tagGlyph(selected) : '<span class="hour-context-placeholder">⌄</span>'}<select class="hour-context-select" data-action="hour-context-select" data-date="${date}" data-hour="${hour}" aria-label="Context for hour ${hour}"><option value="">Choose context</option>${options}</select></div>`;
}
function refreshModalTagUI() {
  if (!reminderModalContext) return;
  const { date, hour } = reminderModalContext;
  const list = $('#modal-root .tag-list');
  if (list) {
    const tags = tagsFor(date, hour);
    list.innerHTML = tags.length ? tags.map((tag, index) => renderTagChip(tag, index, date, hour)).join('') : '<span class="muted tag-empty">No tags yet</span>';
  }
  const picker = $('#modal-root .tag-picker');
  if (picker) picker.outerHTML = renderTagPicker(date, hour);
}
function studyMinutes(date) {
  return Array.from({ length: 24 }, (_, hour) => minutesForHour(date, hour)).reduce((sum, value) => sum + value, 0);
}
function habitStats(date) {
  const habits = data.habits.filter(h => !h.archived);
  const record = readDay(date).habits || {};
  const done = habits.filter(h => Boolean(record[h.id])).length;
  return { done, total: habits.length, rate: habits.length ? done / habits.length * 100 : 0 };
}
function dailyStats(date) {
  const hs = habitStats(date);
  return { minutes: studyMinutes(date), habitRate: hs.rate, habitsDone: hs.done, habitsTotal: hs.total };
}
function formatMinutes(minutes) {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}
function formatHours(minutes) { return `${(minutes / 60).toFixed(minutes % 60 === 0 ? 0 : 1)}h`; }
function saveData({ rerender = true, sync = true } = {}) {
  data.updatedAt = new Date().toISOString();
  localStorage.setItem(DATA_KEY, JSON.stringify(data));
  if (!applyingRemote) localStorage.setItem(LOCAL_EDIT_KEY, '1');
  if (sync && !applyingRemote) scheduleCloudSync();
  if (rerender) render();
}
function toast(message) {
  const old = $('.toast'); if (old) old.remove();
  const node = document.createElement('div'); node.className = 'toast'; node.textContent = message;
  document.body.appendChild(node); setTimeout(() => node.remove(), 2600);
}
function setSyncIndicator(label, state = '') {
  syncLabel = label;
  const el = $('#sync-indicator');
  if (el) { el.className = `sync-indicator ${state}`; el.querySelector('span').textContent = label; }
}
function getSeenCheckpoint() {
  const saved = localStorage.getItem(CHECKPOINT_KEY) || '';
  const [savedStart, savedNumber] = saved.split(':');
  return savedStart === data.startDate ? (Number(savedNumber) || 0) : 0;
}
function updateReportDot() {
  const dot = $('#report-dot');
  if (!dot) return;
  const days = Math.max(0, daysBetween(data.startDate, localDate()) + 1);
  const checkpoint = Math.floor(days / 3);
  dot.classList.toggle('show', checkpoint > getSeenCheckpoint());
}
function navigate(page) {
  currentPage = page;
  tagPickerOpen = false;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function render() {
  const content = $('#app-content');
  if (!content) return;
  const pages = { overview: renderOverview, study: renderStudy, habits: renderHabits, reports: renderReports, settings: renderSettings };
  content.innerHTML = (pages[currentPage] || renderOverview)();
  $$('.nav-item[data-page], .mobile-nav-item[data-page]').forEach(el => el.classList.toggle('active', el.dataset.page === currentPage));
  updateReportDot();
  const installButton = $('#install-button');
  if (installButton) installButton.hidden = !deferredInstallPrompt;
}

function pageHeading(eyebrow, title, description, actions = '') {
  return `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1>${description ? `<p>${description}</p>` : ''}</div>${actions ? `<div class="heading-actions">${actions}</div>` : ''}</div>`;
}
function renderOverview() {
  const today = localDate();
  const stats = dailyStats(today);
  const streak = calculateStreak(today);
  const pct = stats.habitsTotal ? Math.round(stats.habitsDone / stats.habitsTotal * 100) : 0;
  const chart = renderHourlyBars(today);
  const preview = data.habits.filter(h => !h.archived).slice(0, 7).map(h => {
    const done = Boolean(readDay(today).habits?.[h.id]);
    return `<div class="habit-preview-row"><span class="mini-check ${done ? 'done' : ''}">${done ? '✓' : ''}</span><span>${esc(h.name)}</span><span class="habit-count">${done ? 'Done' : 'Pending'}</span></div>`;
  }).join('');
  const days = Math.max(1, daysBetween(data.startDate, today) + 1);
  const cycleDue = days >= 3 && days % 3 === 0;
  const cycleText = days < 3 ? `${3 - days} day${3 - days === 1 ? '' : 's'} until your first 3-day report` : cycleDue ? 'Your 3-day checkpoint is ready' : `${3 - (days % 3)} day${3 - (days % 3) === 1 ? '' : 's'} until your next 3-day report`;
  return `${pageHeading('YOUR SPACE', 'A clearer picture of today.', `${fmtDate(today, { weekday:'long', month:'long', day:'numeric', year:'numeric' })} · Start date ${fmtDate(data.startDate, { month:'short', day:'numeric', year:'numeric' })}`, `<button class="btn btn-primary" data-page="study">＋ Log study</button>`)}
    <section class="kpi-grid">
      <article class="card kpi-card"><div class="kpi-top"><span>Study time today</span><span class="kpi-icon">◷</span></div><div class="kpi-value">${formatMinutes(stats.minutes)}</div><div class="kpi-foot">${stats.minutes ? `<strong>${Math.round(stats.minutes / 60 * 10) / 10} focused hours</strong> logged` : 'Your first 10 minutes count.'}</div></article>
      <article class="card kpi-card"><div class="kpi-top"><span>Daily habits</span><span class="kpi-icon">✓</span></div><div class="kpi-value">${stats.habitsDone}<span class="kpi-value-secondary"> / ${stats.habitsTotal}</span></div><div class="kpi-foot"><strong>${pct}% complete</strong> for today</div></article>
      <article class="card kpi-card"><div class="kpi-top"><span>Consistency streak</span><span class="kpi-icon">✳</span></div><div class="kpi-value">${streak} <span class="kpi-value-secondary">day${streak === 1 ? '' : 's'}</span></div><div class="kpi-foot">Days with at least one completed habit or study block</div></article>
    </section>
    <section class="overview-grid">
      <article class="card chart-card"><div class="section-head"><div><h2 class="section-title">Study rhythm</h2><p class="section-sub">Minutes studied in each hour today</p></div><div class="chart-legend"><i class="legend-dot"></i> Study minutes</div></div>${chart}</article>
      <article class="card card-pad"><div class="section-head"><div><h2 class="section-title">Today's habits</h2><p class="section-sub">A quick look at your daily checklist</p></div><button class="inline-link" data-page="habits">View all →</button></div><div class="habit-preview">${preview || '<p class="muted">Add your first habit to get started.</p>'}</div><div class="habit-progress-meta"><span>${stats.habitsDone} of ${stats.habitsTotal} completed</span><strong>${pct}%</strong></div><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div></article>
    </section>
    <section class="bottom-grid">
      <article class="focus-card"><div><div class="eyebrow">A GENTLE REMINDER</div><h3>Progress is built in ordinary hours.</h3><p>Log the minutes you actually studied. Add a context tag when an hour was used for prayer, meals, rest, or something important. The tags explain your day; they don't reduce your study score.</p><div style="margin-top:14px"><button class="btn btn-soft" data-page="study">Open study tracker →</button></div></div><div class="focus-orb"></div></article>
      <article class="card report-teaser"><div class="section-head"><div><h2 class="section-title">Your next checkpoint</h2><p class="section-sub">Small reviews make change visible</p></div><span class="pill">3-day cycle</span></div><div class="report-teaser-row"><span class="report-icon">↗</span><div><strong>${cycleText}</strong><small>Compare study time and habit consistency</small></div><button class="btn btn-ghost btn-small" data-page="reports">Reports</button></div></article>
    </section>`;
}
function renderHourlyBars(date) {
  const values = Array.from({ length: 24 }, (_, hour) => minutesForHour(date, hour));
  const max = Math.max(60, ...values);
  const linePoints = values.map((value, i) => `${((i + 0.5) / values.length) * 240},${128 - (value / max * 128)}`).join(' ');
  return `<div class="hour-chart" aria-label="Study minutes by hour"><svg class="hour-line" viewBox="0 0 240 128" preserveAspectRatio="none" aria-hidden="true"><polyline points="${linePoints}"></polyline></svg>${values.map((v, i) => `<div class="bar-wrap" title="${String(i).padStart(2,'0')}:00–${String(i+1).padStart(2,'0')}:00 · ${v} min"><span class="bar-label bar-label-top">${i + 1}</span><div class="bar-track"><div class="bar-fill" style="height:${v / max * 100}%"></div></div><span class="bar-label bar-label-bottom">${i}</span></div>`).join('')}</div>`;
}
function renderStudy() {
  const date = selectedDate;
  const total = studyMinutes(date);
  const hs = Array.from({ length: 24 }, (_, h) => minutesForHour(date, h));
  const hour = Math.max(0, Math.min(23, selectedHour));
  const tags = tagsFor(date, hour);
  const levels = [60, 50, 40, 30, 20, 10, 0];
  const hourColumns = Array.from({ length: 24 }, (_, h) => {
    const labels = `<button class="hour-label-box ${h === hour ? 'selected' : ''}" data-action="select-hour" data-hour="${h}" title="Select ${String(h).padStart(2,'0')}:00–${String(h+1).padStart(2,'0')}:00">${h + 1}</button>`;
    const checkboxes = levels.map(minutes => {
      const checked = hs[h] === minutes;
      return `<div class="grid-cell ${checked ? 'checked' : ''}"><input class="study-box" type="checkbox" aria-label="${String(h).padStart(2,'0')}:00–${String(h+1).padStart(2,'0')}:00, ${minutes} minutes studied" data-action="study-select" data-hour="${h}" data-minutes="${minutes}" ${checked ? 'checked' : ''}></div>`;
    }).join('');
    return `<div class="study-hour-column">${labels}<div class="study-column-box">${checkboxes}</div><button class="hour-label-box ${h === hour ? 'selected' : ''}" data-action="select-hour" data-hour="${h}" title="Select hour ${h}">${h}</button>${renderHourContextBox(date, h)}</div>`;
  }).join('');
  const dateActions = `<div class="date-nav"><button data-action="date-prev" aria-label="Previous day">‹</button><input class="date-input" id="study-date" type="date" value="${date}"><button data-action="date-next" aria-label="Next day">›</button><button class="btn btn-ghost btn-small" data-action="date-today">Today</button></div>`;
  return `${pageHeading('FOCUSED TIME', 'Study tracker', '', dateActions)}
    <div class="study-summary" style="margin-bottom:16px"><span class="summary-pill">${formatMinutes(total)} studied</span><span class="summary-pill">${Math.round(total / 60 * 10) / 10} focused hours</span><span class="summary-pill">${hs.filter(v => v > 0).length} active hour blocks</span></div>
    <section class="card study-grid-card"><div class="grid-caption"><div><h2 class="section-title">24-hour study grid</h2><small>Choose one duration in each hour column. Scroll horizontally on smaller screens.</small></div><div class="chart-legend"><i class="legend-dot"></i> Checked = studied</div></div>
      <div class="study-plot"><div class="y-axis"><span class="axis-spacer"></span><div class="axis-ticks"><span>60</span><span>50</span><span>40</span><span>30</span><span>20</span><span>10</span><span>0</span></div></div><div class="grid-scroll"><div class="study-grid">${hourColumns}</div></div></div>
      <div class="study-footnote"><span>↕</span><span>Seven duration choices: <b>0, 10, 20, 30, 40, 50, 60</b> minutes · choose one checkbox in each hour column</span></div>
    </section>
    <section class="card hour-detail" style="margin-top:15px"><div><div class="eyebrow">SELECTED HOUR</div><h3>${String(hour).padStart(2,'0')}:00 – ${String(hour+1).padStart(2,'0')}:00</h3><p>Choose an hour above to add context tags or clear its study marks.</p><div class="hour-total">${hs[hour]} <span class="hour-total-label">minutes studied</span></div><div style="margin-top:11px"><button class="btn btn-ghost btn-small" data-action="clear-hour" data-hour="${hour}">Clear this hour</button></div></div>
      <div class="tag-area"><label>CONTEXT TAGS <span>· don't count as study time</span></label><div class="tag-list">${tags.length ? tags.map((tag, i) => renderTagChip(tag, i, date, hour)).join('') : '<span class="muted tag-empty">No context tags for this hour yet.</span>'}</div>${renderTagPicker(date, hour)}</div>
    </section>
    <section class="card chart-card" style="margin-top:15px"><div class="section-head"><div><h2 class="section-title">Hourly study graph</h2><p class="section-sub">Your study minutes across all 24 hours for ${fmtDate(date)}</p></div></div>${renderHourlyBars(date)}</section>`;
}
function renderHabits() {
  const today = localDate();
  const dates = [today];
  const habits = data.habits.filter(h => !h.archived);
  const hs = habitStats(today);
  const pct = Math.round(hs.rate);
  const dayHeaders = dates.map(day => {
    const isToday = day === today;
    const weekday = dateFromKey(day).toLocaleDateString(undefined, { weekday: 'short' });
    const dayNumber = dateFromKey(day).getDate();
    return `<div class="habit-day-heading ${isToday ? 'is-today' : 'is-past'}" title="${fmtDate(day, { weekday:'long', month:'long', day:'numeric' })}"><span>${weekday}</span><strong>${dayNumber}</strong>${isToday ? '<em>Today</em>' : ''}</div>`;
  }).join('');
  const renderHabitRow = h => {
      const helper = h.id === 'study' || h.id === 'porn-free' ? '' : (h.helper || (h.mode === 'avoid' ? 'Tick when you avoided this behaviour.' : ''));
      const cells = dates.map(day => {
        const checked = Boolean(readDay(day).habits?.[h.id]);
        const isToday = day === today;
        return `<div class="habit-day-cell ${isToday ? 'is-today' : 'is-past'}"><input class="habit-checkbox" type="checkbox" data-action="habit-toggle" data-id="${esc(h.id)}" data-date="${day}" ${checked ? 'checked' : ''} aria-label="${esc(h.name)} on ${fmtDate(day, { weekday:'long', month:'long', day:'numeric' })}" title="${fmtDate(day)}${isToday ? ' · Today' : ' · Past day'}"></div>`;
      }).join('');
      return `<div class="habit-matrix-row"><div class="habit-matrix-name"><div class="habit-name">${esc(h.name)}</div>${helper ? `<div class="habit-helper">${esc(helper)}</div>` : ''}</div>${cells}<div class="habit-row-actions"><button class="tiny-action" data-action="edit-habit" data-id="${esc(h.id)}" title="Edit ${esc(h.name)}" aria-label="Edit ${esc(h.name)}">···</button></div></div>`;
  };
  const salah = habits.filter(h => h.group === 'Salah');
  const otherHabits = habits.filter(h => h.group !== 'Salah');
  const salahRow = salah.length ? `<div class="salah-box"><div class="salah-row"><div class="habit-matrix-name"><div class="habit-name">Salah</div></div>${dates.map(day => `<div class="salah-day-cell ${day === today ? 'is-today' : 'is-past'}">${salah.map(prayer => `<input class="habit-checkbox salah-checkbox" type="checkbox" data-action="habit-toggle" data-id="${esc(prayer.id)}" data-date="${day}" ${readDay(day).habits?.[prayer.id] ? 'checked' : ''} aria-label="${esc(prayer.name)} on ${fmtDate(day, { weekday:'long', month:'long', day:'numeric' })}" title="${esc(prayer.name)} · ${fmtDate(day)}"></input>`).join('')}</div>`).join('')}<div class="habit-row-actions"></div></div></div>` : '';
  const rows = `${salahRow}${otherHabits.length ? `<div class="habit-items-box">${otherHabits.map(renderHabitRow).join('')}</div>` : ''}`;
  const weekStats = dates.map(day => habitStats(day));
  const weekAverage = Math.round(average(weekStats.map(day => day.rate)));
  const weekBars = dates.map((day, index) => {
    const stats = weekStats[index];
    const isToday = day === today;
    const height = Math.max(3, stats.rate);
    return `<div class="mini-bar-col ${isToday ? 'is-today' : 'is-past'}" title="${fmtDate(day)} · ${Math.round(stats.rate)}%"><div class="mini-bar-track"><div class="mini-bar-fill" style="height:${height}%"></div></div><small>${dateFromKey(day).toLocaleDateString(undefined,{weekday:'narrow'})}</small></div>`;
  }).join('');
  const firstDay = fmtDate(dates[0], { month:'short', day:'numeric' });
  const lastDay = fmtDate(today, { month:'short', day:'numeric' });
  return `${pageHeading('DAILY ROUTINE', 'Daily habits', '', `<button class="btn btn-primary" data-action="add-habit">＋ Add habit</button>`)}
    <section class="habits-layout"><article class="card habit-main-card"><div class="section-head"><div><h2 class="section-title">Today’s checklist</h2><p class="section-sub">${fmtDate(today, { weekday:'long', month:'long', day:'numeric' })}</p></div><span class="pill">${hs.done}/${hs.total} today</span></div><div class="habit-matrix-scroll"><div class="habit-matrix"><div class="habit-matrix-header"><div class="habit-matrix-label">HABIT</div>${dayHeaders}<div class="habit-matrix-action-label"></div></div>${rows || '<div class="empty-state"><div class="empty-symbol">＋</div><strong>No habits yet</strong><p>Add the daily habits you want to keep visible.</p></div>'}</div></div></article>
    <aside class="card habit-side-card"><div class="section-head"><div><h2 class="section-title">Today's completion</h2><p class="section-sub">Every checked item counts once</p></div></div><div class="completion-ring" style="--progress:${pct}%"><div><strong>${pct}%</strong><small>complete</small></div></div><div class="habit-progress-meta"><span>Completed today</span><strong>${hs.done} / ${hs.total}</strong></div><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div><div class="divider"></div><div class="weekly-average"><div><h3 class="section-title">7-day average</h3><p class="section-sub">Habit completion across the last week</p></div><strong>${weekAverage}%</strong></div><div class="mini-bars">${weekBars}</div><div class="callout"><strong>Quick note:</strong> Keep today’s checklist focused and simple.</div></aside></section>`;
}
function average(values) { return values.length ? values.reduce((a,b) => a+b, 0) / values.length : 0; }
function blockStats(index, size) {
  const start = addDays(data.startDate, index * size);
  const end = addDays(start, size - 1);
  const daily = Array.from({ length: size }, (_, i) => dailyStats(addDays(start, i)));
  return { index, start, end, days: daily, avgMinutes: average(daily.map(x => x.minutes)), avgHabitRate: average(daily.map(x => x.habitRate)), totalMinutes: daily.reduce((s,x) => s + x.minutes, 0), totalHabitDone: daily.reduce((s,x) => s + x.habitsDone, 0) };
}
function delta(current, baseline, unit = 'min/day') {
  const diff = current - baseline;
  const abs = unit === 'min/day' ? `${diff >= 0 ? '+' : '−'}${formatMinutes(Math.round(Math.abs(diff)))}/day` : `${diff >= 0 ? '+' : '−'}${Math.abs(diff).toFixed(0)} pp`;
  const pct = baseline > 0 ? ` (${diff >= 0 ? '+' : '−'}${Math.abs(diff / baseline * 100).toFixed(0)}%)` : '';
  return { text: abs + pct, positive: diff >= 0, diff };
}
function renderReports() {
  const modes = { '3day': { size: 3, label: '3-day', unit: 'days' }, week: { size: 7, label: 'Weekly', unit: 'days' }, month: { size: 30, label: 'Monthly', unit: 'days' } };
  const mode = modes[reportMode] || modes['3day'];
  const daysElapsed = Math.max(0, daysBetween(data.startDate, localDate()) + 1);
  const completeBlocks = Math.floor(daysElapsed / mode.size);
  const tabs = `<div class="report-tabs"><button class="report-tab ${reportMode==='3day'?'active':''}" data-action="report-mode" data-mode="3day">Every 3 days</button><button class="report-tab ${reportMode==='week'?'active':''}" data-action="report-mode" data-mode="week">Weekly</button><button class="report-tab ${reportMode==='month'?'active':''}" data-action="report-mode" data-mode="month">Monthly</button></div>`;
  if (!completeBlocks) {
    const remaining = mode.size - daysElapsed;
    return `${pageHeading('MEASURE THE CHANGE', 'Progress reports', 'Compare your effort over time—not just one unusually good or difficult day.')}${tabs}<section class="card card-pad"><div class="empty-state"><div class="empty-symbol">↗</div><strong>Your first ${mode.label.toLowerCase()} report is taking shape.</strong><p>You are on day ${daysElapsed} of your tracking journey. Your first ${mode.label.toLowerCase()} checkpoint unlocks after ${remaining} more day${remaining===1?'':'s'}. Keep logging study minutes and daily habits; the report will be generated from your records automatically.</p></div></section><section class="card card-pad" style="margin-top:15px"><h2 class="section-title">What gets compared?</h2><div class="comparison-list"><div class="comparison-row"><span>Study time</span><strong>Average minutes studied per day</strong></div><div class="comparison-row"><span>Habit consistency</span><strong>Average daily completion rate</strong></div><div class="comparison-row"><span>Baseline</span><strong>Your first day and first completed period</strong></div></div></section>`;
  }
  const current = blockStats(completeBlocks - 1, mode.size);
  const first = blockStats(0, mode.size);
  const previous = completeBlocks > 1 ? blockStats(completeBlocks - 2, mode.size) : null;
  const dayOne = dailyStats(data.startDate);
  const studyVsDayOne = delta(current.avgMinutes, dayOne.minutes, 'min/day');
  const habitVsDayOne = delta(current.avgHabitRate, dayOne.habitRate, 'pp');
  const studyVsFirst = delta(current.avgMinutes, first.avgMinutes, 'min/day');
  const habitsVsFirst = delta(current.avgHabitRate, first.avgHabitRate, 'pp');
  const studyVsPrevious = previous ? delta(current.avgMinutes, previous.avgMinutes, 'min/day') : null;
  const habitVsPrevious = previous ? delta(current.avgHabitRate, previous.avgHabitRate, 'pp') : null;
  const blockLabel = `Days ${current.index * mode.size + 1}–${(current.index + 1) * mode.size}`;
  const history = Array.from({ length: completeBlocks }, (_, i) => blockStats(i, mode.size)).reverse().slice(0, 8).map(b => `<div class="history-row"><div><strong>${mode.label} ${b.index + 1} · Days ${b.index*mode.size+1}–${(b.index+1)*mode.size}</strong><small>${fmtDate(b.start)} – ${fmtDate(b.end)}</small></div><span class="history-value">${formatMinutes(Math.round(b.avgMinutes))}/day</span><span class="history-value">${Math.round(b.avgHabitRate)}% habits</span></div>`).join('');
  const metric = (label, value, change, positive = true) => `<div class="report-metric"><small>${label}</small><strong>${value}</strong><em class="${positive?'':'negative'}">${change}</em></div>`;
  const compareText = (d) => d ? `${d.text} ${d.positive ? '↑' : '↓'}` : 'First completed period';
  return `${pageHeading('MEASURE THE CHANGE', 'Progress reports', 'See how your study consistency and daily habits are changing across equal-length periods.')}${tabs}
    <section class="card card-pad"><div class="section-head"><div><div class="eyebrow">LATEST CHECKPOINT · ${mode.label.toUpperCase()}</div><h2 class="section-title">${blockLabel}</h2><p class="section-sub">${fmtDate(current.start)} – ${fmtDate(current.end)} · Compared with your baseline and previous period</p></div><span class="pill">${completeBlocks} report${completeBlocks===1?'':'s'} ready</span></div>
      <div class="report-summary-grid">${metric('Average study / day', formatMinutes(Math.round(current.avgMinutes)), compareText(studyVsPrevious || studyVsDayOne), (studyVsPrevious || studyVsDayOne).positive)}${metric('Habit completion', `${Math.round(current.avgHabitRate)}%`, compareText(habitVsPrevious || habitsVsFirst), (habitVsPrevious || habitsVsFirst).positive)}${metric('Total study this period', formatMinutes(current.totalMinutes), `${current.totalMinutes} minutes recorded`, true)}</div>
      <h3 class="section-title" style="font-size:12px;margin-top:7px">Change from your starting point</h3><div class="comparison-list"><div class="comparison-row"><span>Study time vs Day 1</span><strong>${studyVsDayOne.text}</strong></div><div class="comparison-row"><span>Habit completion vs Day 1</span><strong>${habitVsDayOne.text}</strong></div><div class="comparison-row"><span>Study time vs first ${mode.label.toLowerCase()} average</span><strong>${studyVsFirst.text}</strong></div><div class="comparison-row"><span>Habit completion vs first ${mode.label.toLowerCase()} average</span><strong>${habitsVsFirst.text}</strong></div>${previous ? `<div class="comparison-row"><span>Study time vs previous ${mode.label.toLowerCase()} period</span><strong>${studyVsPrevious.text}</strong></div><div class="comparison-row"><span>Habits vs previous ${mode.label.toLowerCase()} period</span><strong>${habitVsPrevious.text}</strong></div>` : ''}</div>
      <div class="callout"><strong>How to read this:</strong> Study time is compared as an average per day, so a longer period doesn't automatically look better just because it contains more days. Habit completion is the average percentage of your active checklist completed each day. ${mode.label === 'Monthly' ? 'Monthly reports use consistent 30-day cycles.' : ''}</div>
    </section><section class="card card-pad" style="margin-top:15px"><div class="section-head"><div><h2 class="section-title">Checkpoint history</h2><p class="section-sub">Completed ${mode.label.toLowerCase()} periods, newest first</p></div></div><div class="report-history">${history}</div></section>`;
}
function showCheckpointModal(checkpointNumber) {
  const block = blockStats(checkpointNumber - 1, 3);
  const baseline = blockStats(0, 3);
  const previous = checkpointNumber > 1 ? blockStats(checkpointNumber - 2, 3) : null;
  const dayOne = dailyStats(data.startDate);
  const studyFromDayOne = delta(block.avgMinutes, dayOne.minutes, 'min/day');
  const studyFromBaseline = delta(block.avgMinutes, baseline.avgMinutes, 'min/day');
  const studyFromPrevious = previous ? delta(block.avgMinutes, previous.avgMinutes, 'min/day') : null;
  const habitFromBaseline = delta(block.avgHabitRate, baseline.avgHabitRate, 'pp');
  const label = `Days ${block.index * 3 + 1}–${(block.index + 1) * 3}`;
  $('#modal-root').innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="checkpoint-title"><div class="modal-head"><div><div class="eyebrow">3-DAY PROGRESS CHECKPOINT</div><h2 id="checkpoint-title">Your progress is adding up.</h2><p>${label} · ${fmtDate(block.start)} – ${fmtDate(block.end)}</p></div><button class="modal-close" data-action="checkpoint-dismiss">×</button></div><div class="report-summary-grid"> <div class="report-metric"><small>Average study / day</small><strong>${formatMinutes(Math.round(block.avgMinutes))}</strong><em class="${(studyFromPrevious || studyFromDayOne).positive?'':'negative'}">${(studyFromPrevious || studyFromDayOne).text}</em></div><div class="report-metric"><small>Habit completion</small><strong>${Math.round(block.avgHabitRate)}%</strong><em class="${habitFromBaseline.positive?'':'negative'}">${habitFromBaseline.text} vs first 3 days</em></div><div class="report-metric"><small>Total study</small><strong>${formatMinutes(block.totalMinutes)}</strong><em>${block.totalMinutes} minutes logged</em></div></div><div class="comparison-list"><div class="comparison-row"><span>Study vs Day 1</span><strong>${studyFromDayOne.text}</strong></div><div class="comparison-row"><span>Study vs first 3 days</span><strong>${studyFromBaseline.text}</strong></div><div class="comparison-row"><span>Habits vs Day 1</span><strong>${delta(block.avgHabitRate, dayOne.habitRate, 'pp').text}</strong></div>${studyFromPrevious ? `<div class="comparison-row"><span>Study vs previous 3 days</span><strong>${studyFromPrevious.text}</strong></div>` : '<div class="comparison-row"><span>First checkpoint</span><strong>Your baseline is now established</strong></div>'}</div><div class="modal-actions"><button class="btn btn-ghost" data-action="checkpoint-dismiss">Close</button><button class="btn btn-primary" data-action="checkpoint-open">View full report →</button></div></section></div>`;
}
function maybeShowCheckpoint() {
  const days = Math.max(0, daysBetween(data.startDate, localDate()) + 1);
  const checkpoint = Math.floor(days / 3);
  const seen = getSeenCheckpoint();
  if (checkpoint > seen) {
    localStorage.setItem(CHECKPOINT_KEY, `${data.startDate}:${checkpoint}`);
    showCheckpointModal(checkpoint);
  }
}

function calculateStreak(today) {
  let count = 0;
  for (let i = 0; i < 365; i++) {
    const date = addDays(today, -i);
    if (date < data.startDate) break;
    const s = dailyStats(date);
    if (s.minutes > 0 || s.habitsDone > 0) count++;
    else if (i > 0) break;
    else return 0;
  }
  return count;
}

function getReminderConfig() {
  try { return { enabled: true, startHour: 7, endHour: 23, ...JSON.parse(localStorage.getItem(REMINDER_KEY) || '{}') }; }
  catch { return { enabled: true, startHour: 7, endHour: 23 }; }
}
function getCloudConfig() {
  try { return JSON.parse(localStorage.getItem(CLOUD_KEY) || '{}'); } catch { return {}; }
}
function renderSettings() {
  const rem = getReminderConfig();
  const cloud = getCloudConfig();
  const hourOptions = (selected, end = false) => Array.from({ length: end ? 25 : 24 }, (_, i) => `<option value="${i}" ${Number(selected)===i?'selected':''}>${String(i).padStart(2,'0')}:00${end && i===24?' (midnight)':''}</option>`).join('');
  const cloudReady = Boolean(cloud.url && cloud.key);
  const connected = Boolean(syncUser);
  return `${pageHeading('MAKE IT YOURS', 'Settings & sync', 'Set your reminder window, connect your devices, and keep your records under your control.')}
    <section class="settings-grid"><article class="card settings-card"><div class="section-head"><div><h2 class="section-title">Hourly check-in</h2><p class="section-sub">A small prompt to log the hour that just passed</p></div><span class="pill">Every 60 min</span></div>
      <div class="setting-row"><div><strong>Enable hourly reminders</strong><small>Show a quick 6-box check-in while Tide is open.</small></div><input class="switch" type="checkbox" id="reminder-enabled" ${rem.enabled?'checked':''}></div>
      <div class="setting-row"><div><strong>Reminder window</strong><small>Choose when the hourly prompts can appear.</small></div><div style="display:flex;gap:6px"><select class="select-input" id="reminder-start">${hourOptions(rem.startHour)}</select><select class="select-input" id="reminder-end">${hourOptions(rem.endHour,true)}</select></div></div>
      <div class="settings-actions"><button class="btn btn-soft" data-action="request-notifications">Enable browser notifications</button></div><div class="field-note" style="margin-top:10px">One-time browser permission is required for system notifications. In-app prompts work while the app is open. A closed browser cannot reliably run an hourly timer in a standard PWA.</div>
    </article>
    <article class="card settings-card"><div class="section-head"><div><h2 class="section-title">Cloud sync</h2><p class="section-sub">Keep your PC and phone in sync automatically</p></div><span class="pill">${connected?'Connected':cloudReady?'Configured':'Not connected'}</span></div>
      <form id="cloud-form"><div class="field"><label for="supabase-url">SUPABASE PROJECT URL</label><input id="supabase-url" name="supabase-url" type="url" placeholder="https://your-project.supabase.co" value="${esc(cloud.url || '')}"></div><div class="field"><label for="supabase-key">SUPABASE ANON / PUBLISHABLE KEY</label><input id="supabase-key" name="supabase-key" type="password" placeholder="Paste your public anon key" value="${esc(cloud.key || '')}"></div><div class="field"><label for="sync-email">EMAIL FOR BOTH DEVICES</label><input id="sync-email" name="sync-email" type="email" placeholder="you@example.com" value="${esc(cloud.email || '')}"></div><div class="settings-actions"><button class="btn btn-primary" type="submit">Save & send sign-in link</button>${connected?'<button class="btn btn-ghost" type="button" data-action="sign-out">Sign out</button>':''}</div></form>
      <div class="sync-status ${connected?'success':''}" id="cloud-status">${connected ? `Signed in as ${esc(syncUser.email || 'your account')}. Changes sync automatically.` : 'Connect once on each device using the same Supabase project and email. After sign-in, updates sync in the background.'}</div>
      <div class="callout"><strong>Setup:</strong> Create a free Supabase project, run the SQL included in <code>supabase-schema.sql</code>, then paste the Project URL and anon key here. The app uses a private row protected by your account's row-level security.</div>
    </article>
    <article class="card settings-card"><div class="section-head"><div><h2 class="section-title">Your data</h2><p class="section-sub">Export a backup or restore your records</p></div></div><div class="setting-row"><div><strong>Local storage</strong><small>Your progress is saved in this browser on this device. Use Cloud sync below to access it on another device.</small></div><span class="sync-indicator" id="sync-indicator" aria-live="polite"><i></i><span>${esc(syncLabel)}</span></span></div><div class="setting-row"><div><strong>Export all progress</strong><small>Download habits, study marks, tags, and settings as JSON.</small></div><button class="btn btn-ghost btn-small" data-action="export-data">Export</button></div><div class="setting-row"><div><strong>Import a backup</strong><small>Restore a Tide JSON backup on this device.</small></div><button class="btn btn-ghost btn-small" data-action="import-data">Import</button></div><div class="setting-row"><div><strong>Reset local data</strong><small>Delete this device's saved tracking data.</small></div><button class="btn btn-danger btn-small" data-action="reset-data">Reset</button></div></article>
    <article class="card settings-card"><div class="section-head"><div><h2 class="section-title">Install on your devices</h2><p class="section-sub">Use the same app on desktop and mobile</p></div></div><div class="comparison-list"><div class="comparison-row"><span>Windows / Chrome or Edge</span><strong>Install icon in address bar → Install</strong></div><div class="comparison-row"><span>Android</span><strong>Browser menu → Add to Home screen</strong></div><div class="comparison-row"><span>iPhone</span><strong>Safari Share → Add to Home Screen</strong></div></div><div class="callout"><strong>Windows startup:</strong> After hosting and installing Tide, run <code>install-startup-windows.ps1</code> once and enter your app URL. It creates a Startup-folder shortcut so Tide opens when you sign in to Windows. You can remove it with the matching uninstall script.</div></article></section>`;
}

// Navigation and input events

document.addEventListener('click', async (event) => {
  const pageButton = event.target.closest('[data-page]');
  if (pageButton) { navigate(pageButton.dataset.page); return; }
  const actionButton = event.target.closest('[data-action]');
  if (!actionButton) return;
  const action = actionButton.dataset.action;
  if (action === 'select-hour') { selectedHour = Number(actionButton.dataset.hour); tagPickerOpen = false; render(); return; }
  if (action === 'toggle-tag-picker') { tagPickerOpen = !tagPickerOpen; if (reminderModalContext) refreshModalTagUI(); else render(); return; }
  if (action === 'date-prev' || action === 'date-next' || action === 'date-today') {
    if (action === 'date-prev') selectedDate = addDays(selectedDate, -1);
    if (action === 'date-next') selectedDate = addDays(selectedDate, 1);
    if (action === 'date-today') selectedDate = localDate();
    render(); return;
  }
  if (action === 'clear-hour') {
    const hour = Number(actionButton.dataset.hour); const day = ensureDay(selectedDate);
    day.study[String(hour)] = 0; saveData(); toast('Study time reset to 0 minutes for this hour.'); return;
  }
  if (action === 'remove-tag') {
    const date = actionButton.dataset.date || selectedDate;
    const hour = Number(actionButton.dataset.hour), index = Number(actionButton.dataset.index);
    const day = ensureDay(date); const tags = day.tags[String(hour)] || [];
    tags.splice(index, 1); day.tags[String(hour)] = tags; saveData(); refreshModalTagUI(); return;
  }
  if (action === 'add-habit') { showHabitModal(); return; }
  if (action === 'edit-habit') { showHabitModal(actionButton.dataset.id); return; }
  if (action === 'report-mode') { reportMode = actionButton.dataset.mode; render(); return; }
  if (action === 'request-notifications') { await requestNotifications(); return; }
  if (action === 'export-data') { exportData(); return; }
  if (action === 'import-data') { $('#import-file').click(); return; }
  if (action === 'reset-data') { resetData(); return; }
  if (action === 'sign-out') { await signOutCloud(); return; }
  if (action === 'hourly-save') { saveHourlyModal(); return; }
  if (action === 'hourly-dismiss') { dismissHourlyModal(); return; }
  if (action === 'habit-modal-close' || action === 'checkpoint-dismiss') { $('#modal-root').innerHTML = ''; return; }
  if (action === 'checkpoint-open') { $('#modal-root').innerHTML = ''; navigate('reports'); return; }
  if (action === 'habit-delete') { deleteHabit(actionButton.dataset.id); return; }
  if (action === 'install-app') { installApp(); return; }
});

document.addEventListener('change', (event) => {
  const target = event.target;
  if (target.matches('[data-action="hour-context-select"]')) {
    const date = target.dataset.date || selectedDate;
    const hour = Number(target.dataset.hour);
    const day = ensureDay(date);
    const tags = day.tags[String(hour)] || [];
    const optionNames = CONTEXT_TAG_OPTIONS.map(option => option.name.toLowerCase());
    day.tags[String(hour)] = tags.filter(tag => !optionNames.includes(String(tag).toLowerCase()));
    if (target.value) day.tags[String(hour)].push(target.value);
    saveData();
    render();
    return;
  }
  if (target.matches('[data-action="study-select"]')) {
    const hour = Number(target.dataset.hour), minutes = Number(target.dataset.minutes);
    const day = ensureDay(selectedDate);
    day.study[String(hour)] = target.checked ? minutes : 0;
    saveData(); return;
  }
  if (target.matches('input[name="quick-minutes"]')) {
    if (target.checked) $$('input[name="quick-minutes"]', $('#modal-root')).forEach(input => { if (input !== target) input.checked = false; });
    return;
  }
  if (target.matches('[data-action="habit-toggle"]')) {
    const date = target.dataset.date || selectedDate;
    const day = ensureDay(date); day.habits[target.dataset.id] = target.checked; saveData(); return;
  }
  if (target.matches('[data-action="tag-toggle"]')) {
    const date = target.dataset.date || selectedDate;
    const hour = Number(target.dataset.hour ?? selectedHour);
    const tag = target.dataset.tag;
    const day = ensureDay(date);
    day.tags[String(hour)] ||= [];
    const tags = day.tags[String(hour)];
    const index = tags.findIndex(item => String(item).toLowerCase() === tag.toLowerCase());
    if (target.checked && index < 0) tags.push(tag);
    if (!target.checked && index >= 0) tags.splice(index, 1);
    tagPickerOpen = true;
    saveData(); refreshModalTagUI(); return;
  }
  if (target.id === 'study-date' || target.id === 'habits-date') { selectedDate = target.value || localDate(); render(); return; }
  if (target.id === 'reminder-enabled' || target.id === 'reminder-start' || target.id === 'reminder-end') {
    const rem = getReminderConfig();
    if (target.id === 'reminder-enabled') rem.enabled = target.checked;
    if (target.id === 'reminder-start') rem.startHour = Number(target.value);
    if (target.id === 'reminder-end') rem.endHour = Number(target.value);
    localStorage.setItem(REMINDER_KEY, JSON.stringify(rem)); toast('Reminder settings saved.'); return;
  }
  if (target.id === 'theme-dark') {
    const theme = target.checked ? 'dark' : 'light';
    localStorage.setItem(THEME_KEY, theme);
    applyTheme(theme);
    render();
    toast(`${theme === 'dark' ? 'Dark' : 'Light'} theme enabled.`);
  }
});

document.addEventListener('submit', async (event) => {
  if (event.target.matches('form#habit-form')) { event.preventDefault(); saveHabitForm(event.target); return; }
  if (event.target.id === 'cloud-form') { event.preventDefault(); await saveCloudForm(event.target); return; }
});

function showHabitModal(id = null) {
  const habit = id ? data.habits.find(h => h.id === id) : null;
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-backdrop" data-backdrop="habit"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="habit-modal-title"><div class="modal-head"><div><h2 id="habit-modal-title">${habit ? 'Edit habit' : 'Add a habit'}</h2><p>Keep the name short so your daily checklist stays easy to scan.</p></div><button class="modal-close" data-action="habit-modal-close">×</button></div><form id="habit-form"><input type="hidden" name="id" value="${esc(habit?.id || '')}"><div class="field"><label>HABIT NAME</label><input name="name" required maxlength="48" placeholder="e.g. Read 10 pages" value="${esc(habit?.name || '')}"></div><div class="field"><label>GROUP</label><input name="group" maxlength="28" placeholder="e.g. Learning, Salah, Personal" value="${esc(habit?.group || 'General')}"></div><div class="field"><label>WHAT DOES CHECKING IT MEAN?</label><select name="mode"><option value="done" ${habit?.mode !== 'avoid' ? 'selected' : ''}>I completed this habit</option><option value="avoid" ${habit?.mode === 'avoid' ? 'selected' : ''}>I avoided this habit / behaviour</option></select></div><div class="field"><label>OPTIONAL NOTE</label><input name="helper" maxlength="90" placeholder="A short reminder (optional)" value="${esc(habit?.helper || '')}"></div><div class="modal-actions"><button class="btn btn-ghost" type="button" data-action="habit-modal-close">Cancel</button><button class="btn btn-primary" type="submit">${habit ? 'Save changes' : 'Add habit'}</button></div></form></section></div>`;
  $('#modal-root input[name="name"]')?.focus();
}
function saveHabitForm(form) {
  const id = form.elements.id.value;
  const name = form.elements.name.value.trim();
  const group = form.elements.group.value.trim() || 'General';
  const mode = form.elements.mode.value;
  const helper = form.elements.helper.value.trim();
  if (!name) return;
  if (id) {
    const habit = data.habits.find(h => h.id === id);
    if (habit) Object.assign(habit, { name, group, mode, helper });
  } else data.habits.push({ id: uid(), name, group, mode, helper });
  $('#modal-root').innerHTML = ''; saveData(); toast(id ? 'Habit updated.' : 'Habit added.');
}
function deleteHabit(id) {
  if (!confirm('Remove this habit from your checklist? Existing historical records will remain in your backup, but the habit will no longer appear.')) return;
  data.habits = data.habits.filter(h => h.id !== id); $('#modal-root').innerHTML = ''; saveData(); toast('Habit removed.');
}

function getReminderState() { try { return JSON.parse(localStorage.getItem(REMINDER_STATE_KEY) || '{}'); } catch { return {}; } }
function setReminderState(key) { localStorage.setItem(REMINDER_STATE_KEY, JSON.stringify({ lastKey: key })); }
function checkHourlyReminder() {
  const rem = getReminderConfig(); if (!rem.enabled) return;
  const now = new Date(); const hour = now.getHours();
  if (hour < Number(rem.startHour) || hour >= Number(rem.endHour)) return;
  const key = `${localDate(now)}-${String(hour).padStart(2,'0')}`;
  if (getReminderState().lastKey === key) return;
  const previous = new Date(now); previous.setHours(hour - 1);
  const previousDate = localDate(previous), previousHour = previous.getHours();
  if (document.visibilityState === 'visible') {
    if ($('#modal-root')?.innerHTML.trim()) return;
    openHourlyModal(previousDate, previousHour, key);
  }
  else if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('Tide · Hourly check-in', { body: `Log your ${String(previousHour).padStart(2,'0')}:00–${String(previousHour+1).padStart(2,'0')}:00 hour.`, icon: './icon.svg', tag: key });
    setReminderState(key);
  }
}
function openHourlyModal(date, hour, key) {
  reminderModalContext = { date, hour, key };
  const currentMinutes = minutesForHour(date, hour);
  const existingTags = tagsFor(date, hour);
  const levels = [0, 10, 20, 30, 40, 50, 60];
  tagPickerOpen = false;
  $('#modal-root').innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="hour-modal-title"><div class="modal-head"><div><div class="eyebrow">HOURLY CHECK-IN</div><h2 id="hour-modal-title">How did this hour go?</h2><p>${fmtDate(date)} · ${String(hour).padStart(2,'0')}:00–${String(hour+1).padStart(2,'0')}:00</p></div><button class="modal-close" data-action="hourly-dismiss">×</button></div><p class="hourly-modal-note">Choose the total number of minutes you studied in this hour. Select one box. If you did not study, choose 0 and add context tags if useful.</p><div class="quick-checks">${levels.map(minutes=>`<label class="quick-check"><input type="checkbox" name="quick-minutes" value="${minutes}" ${currentMinutes===minutes?'checked':''}>${minutes}m</label>`).join('')}</div><div class="field"><label>CONTEXT TAGS · OPTIONAL</label><div class="tag-list">${existingTags.map((tag, i) => renderTagChip(tag, i, date, hour)).join('') || '<span class="muted tag-empty">No tags yet</span>'}</div>${renderTagPicker(date, hour)}</div><div class="modal-actions"><button class="btn btn-ghost" data-action="hourly-dismiss">Later</button><button class="btn btn-primary" data-action="hourly-save">Save this hour</button></div></section></div>`;
}
function saveHourlyModal() {
  if (!reminderModalContext) return;
  const { date, hour, key } = reminderModalContext;
  const day = ensureDay(date);
  const selected = $('input[name="quick-minutes"]:checked', $('#modal-root'));
  day.study[String(hour)] = selected ? Number(selected.value) : 0;
  setReminderState(key); reminderModalContext = null; tagPickerOpen = false; $('#modal-root').innerHTML = '';
  if (selectedDate === date) selectedHour = hour;
  saveData(); toast('Hour saved.');
}
function dismissHourlyModal() {
  if (reminderModalContext?.key) setReminderState(reminderModalContext.key);
  reminderModalContext = null; tagPickerOpen = false; $('#modal-root').innerHTML = '';
}
async function requestNotifications() {
  if (!('Notification' in window)) { toast('This browser does not support notifications.'); return; }
  const permission = await Notification.requestPermission();
  toast(permission === 'granted' ? 'Browser notifications enabled.' : 'Notification permission was not granted.');
}

function exportData() {
  const payload = { ...data, exportedAt: new Date().toISOString(), reminderSettings: getReminderConfig() };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `tide-backup-${localDate()}.json`; a.click(); URL.revokeObjectURL(url);
  toast('Backup downloaded.');
}
$('#import-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0]; if (!file) return;
  try {
    const imported = JSON.parse(await file.text());
    if (!imported || !Array.isArray(imported.habits) || typeof imported.daily !== 'object') throw new Error('This file does not look like a Tide backup.');
    if (!confirm('Replace the progress currently saved on this device with this backup?')) return;
    data = { version: 1, startDate: imported.startDate || localDate(), updatedAt: new Date().toISOString(), habits: imported.habits, daily: imported.daily };
    if (imported.reminderSettings) localStorage.setItem(REMINDER_KEY, JSON.stringify(imported.reminderSettings));
    saveData(); toast('Backup restored.');
  } catch (error) { alert(`Could not import this file: ${error.message}`); }
  event.target.value = '';
});
function resetData() {
  if (!confirm('This will permanently remove Tide tracking data stored on this device. Export a backup first if you want to keep it. Continue?')) return;
  data = defaultData(); localStorage.setItem(DATA_KEY, JSON.stringify(data)); selectedDate = localDate();
  saveData(); toast('Local progress has been reset.');
}
async function installApp() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  const btn = $('#install-button'); if (btn) btn.hidden = true;
}

// Optional Supabase sync. Local-first storage continues to work without cloud setup.
function loadSupabaseLibrary() {
  if (window.supabase?.createClient) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = $('script[data-supabase-lib]');
    if (existing) { existing.addEventListener('load', resolve, { once:true }); existing.addEventListener('error', reject, { once:true }); return; }
    const script = document.createElement('script'); script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'; script.dataset.supabaseLib = '1';
    script.onload = resolve; script.onerror = () => reject(new Error('Could not load the cloud sync library. Check your internet connection.'));
    document.head.appendChild(script);
  });
}
async function initSupabase() {
  const cfg = getCloudConfig();
  if (!cfg.url || !cfg.key) throw new Error('Add your Supabase Project URL and anon key first.');
  await loadSupabaseLibrary();
  if (!supabaseClient) {
    supabaseClient = window.supabase.createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    supabaseClient.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        syncUser = session.user;
        setTimeout(() => syncInitial().catch(err => setSyncIndicator(err.message, 'error')), 0);
      } else if (event === 'SIGNED_OUT') { syncUser = null; setSyncIndicator('Saved on this device'); }
    });
  }
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session?.user) syncUser = session.user;
  return supabaseClient;
}
async function saveCloudForm(form) {
  const url = form.elements['supabase-url'].value.trim().replace(/\/$/, '');
  const key = form.elements['supabase-key'].value.trim();
  const email = form.elements['sync-email'].value.trim();
  if (!url || !key || !email) { toast('Enter the project URL, anon key, and email.'); return; }
  localStorage.setItem(CLOUD_KEY, JSON.stringify({ url, key, email }));
  const status = $('#cloud-status'); if (status) { status.className = 'sync-status'; status.textContent = 'Connecting…'; }
  try {
    const client = await initSupabase();
    const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href } });
    if (error) throw error;
    if (status) status.textContent = `Sign-in link sent to ${email}. Open the link on this device to connect Tide. Use the same email on your other device.`;
    toast('Sign-in link sent. Check your email.');
  } catch (error) {
    if (status) { status.className = 'sync-status error'; status.textContent = error.message; }
    setSyncIndicator('Sync setup needs attention', 'error');
  }
}
async function syncInitial() {
  if (!supabaseClient || !syncUser) return;
  setSyncIndicator('Syncing…', 'syncing');
  const { data: remote, error } = await supabaseClient.from('progress_data').select('payload, updated_at').eq('user_id', syncUser.id).maybeSingle();
  if (error) throw error;

  if (remote?.payload && typeof remote.payload === 'object') {
    const remoteTime = new Date(remote.updated_at || remote.payload.updatedAt || 0).getTime();
    const localTime = new Date(data.updatedAt || 0).getTime();
    const localHasUserChanges = hasMeaningfulLocalData();

    // On a new device, defaultData() has a recent timestamp but contains no
    // user progress. Always restore the existing cloud payload in that case.
    // If both sides contain user data, the most recently edited copy wins.
    if (!localHasUserChanges || remoteTime >= localTime) {
      applyingRemote = true;
      try {
        data = remote.payload;
        data.updatedAt = remote.updated_at || data.updatedAt || new Date().toISOString();
        localStorage.setItem(DATA_KEY, JSON.stringify(data));
      } finally {
        applyingRemote = false;
      }
      render();
    } else {
      await pushCloud();
    }
  } else {
    // No cloud row exists yet: seed it from this device's current data.
    await pushCloud();
  }

  subscribeRealtime();
  setSyncIndicator(`Synced · ${syncUser.email || 'cloud account'}`);
  const status = $('#cloud-status'); if (status) { status.className = 'sync-status success'; status.textContent = `Connected as ${syncUser.email || 'your account'}. Changes sync automatically.`; }
}
async function pushCloud() {
  if (!supabaseClient || !syncUser || applyingRemote) return;
  setSyncIndicator('Syncing…', 'syncing');
  const snapshot = JSON.parse(JSON.stringify(data));
  const { error } = await supabaseClient.from('progress_data').upsert({ user_id: syncUser.id, payload: snapshot, updated_at: snapshot.updatedAt || new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) { setSyncIndicator('Sync failed', 'error'); throw error; }
  setSyncIndicator(`Synced · ${syncUser.email || 'cloud account'}`);
}
function scheduleCloudSync() {
  if (!syncUser || !supabaseClient) return;
  clearTimeout(cloudSyncTimer);
  setSyncIndicator('Changes saved · syncing…', 'syncing');
  cloudSyncTimer = setTimeout(() => pushCloud().catch(err => setSyncIndicator(err.message, 'error')), 900);
}
function subscribeRealtime() {
  if (!supabaseClient || !syncUser) return;
  if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel);
  realtimeChannel = supabaseClient.channel(`tide-progress-${syncUser.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'progress_data', filter: `user_id=eq.${syncUser.id}` }, payload => {
    const remote = payload.new?.payload; const remoteTime = new Date(payload.new?.updated_at || remote?.updatedAt || 0).getTime();
    const localTime = new Date(data.updatedAt || 0).getTime();
    if (remote && remoteTime > localTime + 250) {
      applyingRemote = true; data = remote; data.updatedAt = payload.new.updated_at || data.updatedAt;
      localStorage.setItem(DATA_KEY, JSON.stringify(data)); applyingRemote = false; render();
      setSyncIndicator(`Updated from another device`);
    }
  }).subscribe();
}
async function signOutCloud() {
  if (!supabaseClient) return;
  const { error } = await supabaseClient.auth.signOut();
  if (error) { toast(error.message); return; }
  syncUser = null; setSyncIndicator('Saved on this device'); render(); toast('Cloud sync signed out on this device.');
}
window.addEventListener('online', () => { if (syncUser) syncInitial().catch(err => setSyncIndicator(err.message, 'error')); });
window.addEventListener('focus', () => { if (syncUser && navigator.onLine) syncInitial().catch(() => {}); });

// PWA install, offline cache, and hourly check-ins.
window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); deferredInstallPrompt = event; const btn = $('#install-button'); if (btn) btn.hidden = false; });
window.addEventListener('appinstalled', () => { deferredInstallPrompt = null; const btn = $('#install-button'); if (btn) btn.hidden = true; toast('Tide installed.'); });
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkHourlyReminder(); });
setInterval(checkHourlyReminder, 15000);

// First render and restore an existing cloud session when configured.
render();
maybeShowCheckpoint();
setInterval(maybeShowCheckpoint, 60000);
if (getCloudConfig().url && getCloudConfig().key) {
  initSupabase().then(() => { if (syncUser) syncInitial().catch(err => setSyncIndicator(err.message, 'error')); }).catch(() => {});
}
