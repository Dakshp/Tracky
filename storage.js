// On-device storage for Tracky. Everything lives under one localStorage key so
// the app needs no backend and works fully offline.
const Store = (() => {
  const STORAGE_KEY = 'tracky.v1';
  // The app was called Tappy before. Anything logged under the old key is
  // carried across once, so renaming the app never costs anyone their history.
  const LEGACY_STORAGE_KEY = 'tappy.v1';

  function migrateLegacyKey() {
    try {
      if (localStorage.getItem(STORAGE_KEY) !== null) return;
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy === null) return;
      localStorage.setItem(STORAGE_KEY, legacy);
      // The old key is left in place rather than removed, so an older build
      // opened by mistake still finds its data instead of showing nothing.
    } catch (err) {
      /* storage unavailable (private mode); nothing to migrate */
    }
  }

  // Money is stored as an integer count of minor units (paise / cents).
  // Repeated float addition loses precision (0.1 + 0.2 !== 0.3), which shows up
  // as month totals that drift by a paisa or two once there are enough entries.
  const MINOR_PER_MAJOR = 100;

  // Seed list only. Categories live in stored data from first run, so they can
  // be renamed, reordered and added to. A category's `id` is permanent - every
  // expense points at it forever, so renaming changes only the label.
  // Each category owns a hue, given as an index into the palette in style.css
  // rather than a hex value: the two themes need different lightnesses for the
  // same colour, and a number lets the stylesheet decide which. Colours are
  // spread around the wheel so neighbours in the list never sit adjacent.
  const DEFAULT_CATEGORIES = [
    { id: 'food', label: 'Food & Drink', icon: '\u{1F354}', tint: 0 },
    { id: 'groceries', label: 'Groceries', icon: '\u{1F6D2}', tint: 3 },
    { id: 'transport', label: 'Transport', icon: '\u{1F695}', tint: 6 },
    { id: 'shopping', label: 'Shopping', icon: '\u{1F6CD}', tint: 1 },
    { id: 'bills', label: 'Bills', icon: '\u{1F4A1}', tint: 4 },
    { id: 'health', label: 'Health', icon: '\u{1F48A}', tint: 7 },
    { id: 'fun', label: 'Fun', icon: '\u{1F3AC}', tint: 2 },
    { id: 'home', label: 'Rent & Home', icon: '\u{1F3E0}', tint: 5 },
    { id: 'education', label: 'Education', icon: '\u{1F4DA}', tint: 8 },
    { id: 'other', label: 'Other', icon: '\u{2728}', tint: 9 },
  ];

  const TINT_COUNT = 10;

  const ORPHAN_ICON = '\u{2753}';

  const DEFAULT_SETTINGS = {
    currency: 'INR',
    locale: 'en-IN',
    monthlyBudgetMinor: 3000000, // 30,000.00
    // 'system' follows the phone; 'light' and 'dark' override it.
    theme: 'system',
    // Which shape the day series takes: the bar chart or the month calendar.
    dayView: 'chart',
    // Sync is off until a Web App URL and token are entered in Settings.
    syncUrl: '',
    syncToken: '',
    syncAddToken: '',
    lastSyncAt: '',
  };

  function freshData() {
    return {
      expenses: [],
      nextId: 1,
      categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
      settings: { ...DEFAULT_SETTINGS },
    };
  }

  function normalizeCategory(c, index) {
    const tint = Number(c.tint);
    return {
      id: String(c.id == null ? '' : c.id).trim(),
      label: String(c.label == null ? '' : c.label).trim().slice(0, 30) || 'Untitled',
      icon: String(c.icon == null ? '' : c.icon).trim().slice(0, 4) || '\u{2728}',
      // A backup written before colours existed has no tint. Falling back to the
      // row's position spreads those across the palette instead of painting the
      // whole list one colour.
      tint: Number.isInteger(tint) && tint >= 0 && tint < TINT_COUNT
        ? tint
        : (Number(index) || 0) % TINT_COUNT,
      hidden: Boolean(c.hidden),
    };
  }

  function toMinor(value) {
    const n = Number(value);
    if (!isFinite(n)) return 0;
    return Math.round(n * MINOR_PER_MAJOR);
  }

  // Every read path funnels through here, so a bad or legacy record can never
  // reach the arithmetic below as a string (string "+" concatenates digits).
  // Local ids are per-device counters, so two phones would both mint id 1. Sync
  // keys off `uid` instead, which is globally unique.
  function newUid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return `x-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function normalizeExpense(e) {
    const amountMinor = Number.isInteger(e.amountMinor)
      ? e.amountMinor
      : e.amountMinor != null
        ? Math.round(Number(e.amountMinor) || 0)
        : toMinor(e.amount);
    const createdAt = typeof e.createdAt === 'string' ? e.createdAt : '';
    return {
      id: Number(e.id) || 0,
      uid: typeof e.uid === 'string' && e.uid ? e.uid : newUid(),
      date: typeof e.date === 'string' ? e.date : '',
      amountMinor: Math.max(0, amountMinor),
      // The id is kept verbatim even if no such category exists right now -
      // silently rewriting it to 'other' would rewrite the user's history.
      // getCategoriesForDisplay() surfaces any such orphan instead.
      category: typeof e.category === 'string' && e.category.trim() ? e.category.trim() : 'other',
      note: typeof e.note === 'string' ? e.note : '',
      createdAt,
      // Deletes are kept as tombstones so they can propagate to other devices;
      // every read path filters them out.
      deleted: e.deleted === true,
      updatedAt: typeof e.updatedAt === 'string' && e.updatedAt ? e.updatedAt : createdAt || nowIso(),
    };
  }

  function live(list) {
    return list.filter((e) => !e.deleted);
  }

  function load() {
    try {
      migrateLegacyKey();
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return freshData();
      const data = JSON.parse(raw);
      const list = Array.isArray(data.expenses) ? data.expenses : [];
      const cats = Array.isArray(data.categories) ? data.categories.map((c, i) => normalizeCategory(c, i)).filter((c) => c.id) : [];
      return {
        expenses: list.map(normalizeExpense).filter((e) => e.id && e.date),
        nextId: Number(data.nextId) || list.length + 1,
        categories: cats.length ? cats : DEFAULT_CATEGORIES.map((c) => ({ ...c })),
        settings: normalizeSettings({ ...DEFAULT_SETTINGS, ...(data.settings || {}) }),
      };
    } catch (err) {
      return freshData();
    }
  }

  function save(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  // ---------- Expenses ----------

  function addExpense({ date, amountMinor, category, note, uid }) {
    const data = load();
    const stamp = nowIso();
    const record = normalizeExpense({
      id: data.nextId++,
      uid: uid || newUid(),
      date,
      amountMinor,
      category,
      note,
      createdAt: stamp,
      updatedAt: stamp,
    });
    if (record.amountMinor <= 0) throw new Error('Enter an amount greater than zero.');
    data.expenses.push(record);
    save(data);
    return record;
  }

  function updateExpense(id, patch) {
    const data = load();
    const idx = data.expenses.findIndex((e) => e.id === Number(id) && !e.deleted);
    if (idx === -1) return null;
    const merged = normalizeExpense({
      ...data.expenses[idx],
      ...patch,
      id: data.expenses[idx].id,
      uid: data.expenses[idx].uid,
      updatedAt: nowIso(),
    });
    if (merged.amountMinor <= 0) throw new Error('Enter an amount greater than zero.');
    data.expenses[idx] = merged;
    save(data);
    return merged;
  }

  // Soft delete: the row stays as a tombstone so other devices learn about the
  // deletion instead of pushing their copy back.
  function deleteExpense(id) {
    const data = load();
    const idx = data.expenses.findIndex((e) => e.id === Number(id) && !e.deleted);
    if (idx === -1) return;
    data.expenses[idx] = { ...data.expenses[idx], deleted: true, updatedAt: nowIso() };
    save(data);
  }

  // Undo for a swipe-delete. Because deletion is a tombstone rather than a
  // removal, restoring is just clearing the flag - and the fresh updatedAt means
  // the un-delete wins over the deletion on every other device too.
  function restoreExpense(id) {
    const data = load();
    const idx = data.expenses.findIndex((e) => e.id === Number(id) && e.deleted);
    if (idx === -1) return null;
    data.expenses[idx] = { ...data.expenses[idx], deleted: false, updatedAt: nowIso() };
    save(data);
    return data.expenses[idx];
  }

  function getExpense(id) {
    return live(load().expenses).find((e) => e.id === Number(id)) || null;
  }

  function sumMinor(list) {
    return list.reduce((total, e) => total + (Number(e.amountMinor) || 0), 0);
  }

  function getDay(date) {
    const expenses = live(load().expenses)
      .filter((e) => e.date === date)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return { date, expenses, totalMinor: sumMinor(expenses) };
  }

  // month is a 'YYYY-MM' prefix.
  function getMonth(month) {
    const expenses = live(load().expenses).filter((e) => e.date.slice(0, 7) === month);
    const byCategory = getCategoriesForDisplay().map((c) => {
      const items = expenses.filter((e) => e.category === c.id);
      return { ...c, totalMinor: sumMinor(items), count: items.length };
    })
      .filter((c) => c.count > 0)
      .sort((a, b) => b.totalMinor - a.totalMinor);

    const days = new Set(expenses.map((e) => e.date));
    return {
      month,
      expenses,
      totalMinor: sumMinor(expenses),
      byCategory,
      daysWithSpending: days.size,
    };
  }

  // categoryId narrows the totals to one category, which is what lets the
  // calendar answer the same question as the rest of the Compare screen while a
  // focus is on. Without it the grid kept reporting whole-day totals under a
  // heading that said otherwise.
  function getDailyTotals(days, endDate, categoryId) {
    const byDate = {};
    for (const e of live(load().expenses)) {
      if (categoryId && e.category !== categoryId) continue;
      byDate[e.date] = (byDate[e.date] || 0) + (Number(e.amountMinor) || 0);
    }
    // Pure UTC calendar arithmetic so day-stepping never shifts across a
    // timezone boundary (see app.js todayStr for the matching read side).
    const [y, m, d] = endDate.split('-').map(Number);
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const dt = new Date(Date.UTC(y, m - 1, d));
      dt.setUTCDate(dt.getUTCDate() - i);
      const dateStr = dt.toISOString().slice(0, 10);
      out.push({ date: dateStr, totalMinor: byDate[dateStr] || 0 });
    }
    return out;
  }

  function getRecentDays(limit) {
    const byDate = {};
    for (const e of live(load().expenses)) {
      if (!byDate[e.date]) byDate[e.date] = { date: e.date, totalMinor: 0, count: 0 };
      byDate[e.date].totalMinor += Number(e.amountMinor) || 0;
      byDate[e.date].count += 1;
    }
    return Object.values(byDate)
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, limit);
  }

  // ---------- Categories ----------

  // Hidden categories stay out of the logging picker but remain in history.
  function getCategories({ includeHidden = false } = {}) {
    const list = load().categories;
    return includeHidden ? list : list.filter((c) => !c.hidden);
  }

  /**
   * The list the charts and breakdowns iterate. Any category id referenced by
   * an expense but absent from the stored list (a backup from a device with a
   * different set, say) is appended as an orphan rather than dropped, so
   * per-category figures always reconcile with the headline total.
   */
  function getCategoriesForDisplay() {
    const data = load();
    const out = data.categories.slice();
    const seen = new Set(out.map((c) => c.id));
    for (const e of live(data.expenses)) {
      if (!seen.has(e.category)) {
        seen.add(e.category);
        out.push({
          id: e.category, label: e.category, icon: ORPHAN_ICON,
          tint: out.length % TINT_COUNT, hidden: true, orphan: true,
        });
      }
    }
    return out;
  }

  function categoryUsage(id) {
    return live(load().expenses).filter((e) => e.category === id).length;
  }

  function slugify(label) {
    return (
      String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'category'
    );
  }

  function addCategory({ label, icon, tint }) {
    const data = load();
    // Carry on round the palette, so a new category does not land on the colour
    // its neighbour already has.
    const nextTint = Number.isInteger(Number(tint)) ? tint : data.categories.length % TINT_COUNT;
    const clean = normalizeCategory({ id: slugify(label), label, icon, tint: nextTint });
    if (!String(label || '').trim()) throw new Error('Give the category a name.');
    // Ids must be unique and are never reused, since expenses point at them.
    const taken = new Set(data.categories.map((c) => c.id));
    let id = clean.id;
    for (let n = 2; taken.has(id); n++) id = `${clean.id}-${n}`;
    const record = { ...clean, id };
    data.categories.push(record);
    save(data);
    return record;
  }

  // Label and icon are editable; the id deliberately is not.
  function updateCategory(id, patch) {
    const data = load();
    const i = data.categories.findIndex((c) => c.id === id);
    if (i === -1) return null;
    data.categories[i] = normalizeCategory({ ...data.categories[i], ...patch, id });
    save(data);
    return data.categories[i];
  }

  function moveCategory(id, delta) {
    const data = load();
    const i = data.categories.findIndex((c) => c.id === id);
    const j = i + delta;
    if (i === -1 || j < 0 || j >= data.categories.length) return false;
    const [item] = data.categories.splice(i, 1);
    data.categories.splice(j, 0, item);
    save(data);
    return true;
  }

  // Only ever removes a category no expense refers to, so nothing is orphaned.
  function removeCategory(id) {
    const data = load();
    if (data.categories.length <= 1) throw new Error('Keep at least one category.');
    if (live(data.expenses).some((e) => e.category === id)) {
      throw new Error('This category has expenses. Hide it, or merge it into another one.');
    }
    data.categories = data.categories.filter((c) => c.id !== id);
    save(data);
  }

  // The safe way to retire a used category: move its expenses, then drop it.
  function mergeCategory(fromId, intoId) {
    const data = load();
    if (fromId === intoId) throw new Error('Pick a different category to merge into.');
    if (!data.categories.some((c) => c.id === intoId)) throw new Error('Unknown target category.');
    let moved = 0;
    data.expenses = data.expenses.map((e) => {
      if (e.category !== fromId) return e;
      moved += 1;
      return { ...e, category: intoId };
    });
    data.categories = data.categories.filter((c) => c.id !== fromId);
    if (!data.categories.length) throw new Error('Keep at least one category.');
    save(data);
    return { moved };
  }

  // ---------- Comparison analytics ----------

  // A "period" is a plain string key, and every form sorts chronologically as
  // plain text: 'YYYY-MM-DD' for a day, the Monday's date for a week,
  // 'YYYY-MM' for a month, 'YYYY' for a year.
  function weekStart(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const mondayIndex = (dt.getUTCDay() + 6) % 7; // Sunday(0) becomes 6
    dt.setUTCDate(dt.getUTCDate() - mondayIndex);
    return dt.toISOString().slice(0, 10);
  }

  function periodOf(dateStr, granularity) {
    if (granularity === 'year') return dateStr.slice(0, 4);
    if (granularity === 'month') return dateStr.slice(0, 7);
    if (granularity === 'week') return weekStart(dateStr);
    return dateStr;
  }

  function shiftPeriod(period, granularity, delta) {
    if (granularity === 'year') return String(Number(period) + delta);
    if (granularity === 'month') {
      const [y, m] = period.split('-').map(Number);
      return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
    }
    const [y, m, d] = period.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + delta * (granularity === 'week' ? 7 : 1));
    return dt.toISOString().slice(0, 10);
  }

  // One pass over the log builds every total the comparison screen needs,
  // rather than re-filtering the list once per period and per category.
  function buildIndex(expenses, granularity) {
    const idx = {};
    for (const e of expenses) {
      const p = periodOf(e.date, granularity);
      if (!idx[p]) idx[p] = { total: 0, count: 0, byCat: {} };
      idx[p].total += e.amountMinor;
      idx[p].count += 1;
      idx[p].byCat[e.category] = (idx[p].byCat[e.category] || 0) + e.amountMinor;
    }
    return idx;
  }

  function listPeriods(granularity) {
    const idx = buildIndex(load().expenses, granularity);
    return Object.keys(idx).sort();
  }

  /**
   * Everything the compare dashboard renders, for one selected period.
   *
   * categoryId scopes the headline and the period series (the "focus"), but the
   * category rows always cover every category so the focused one keeps its peer
   * context - the highlighted row's value is exactly the headline value, so the
   * two never disagree.
   */
  function getComparison({ granularity = 'month', period, endPeriod, categoryId = null, span = 12 }) {
    const expenses = live(load().expenses);
    const idx = buildIndex(expenses, granularity);

    const valueAt = (p) => {
      const bucket = idx[p];
      if (!bucket) return 0;
      return categoryId ? bucket.byCat[categoryId] || 0 : bucket.total;
    };

    // The window is anchored independently of the selection, so picking a bar
    // highlights it in place instead of sliding it to the right-hand edge.
    const windowEnd = endPeriod || period;
    const periods = [];
    for (let i = span - 1; i >= 0; i--) periods.push(shiftPeriod(windowEnd, granularity, -i));
    const series = periods.map((p) => ({ period: p, totalMinor: valueAt(p) }));

    const previous = shiftPeriod(period, granularity, -1);
    const currentTotal = valueAt(period);
    const previousTotal = valueAt(previous);

    const curBucket = idx[period] || { byCat: {}, count: 0 };
    const prevBucket = idx[previous] || { byCat: {}, count: 0 };

    // Expenses inside the selected period, honouring the category focus, so the
    // headline figures below always agree with the headline total.
    const inPeriod = expenses.filter(
      (e) => periodOf(e.date, granularity) === period && (!categoryId || e.category === categoryId)
    );
    const biggest = inPeriod.reduce((best, e) => (!best || e.amountMinor > best.amountMinor ? e : best), null);

    // Days counted for the average stop at today, so a part-finished month is
    // not averaged over days that have not happened yet.
    const bounds = periodBounds(period, granularity);
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const lastDay = bounds.end > todayKey ? todayKey : bounds.end;
    const dayCount = lastDay < bounds.start ? 0 : daysBetween(bounds.start, lastDay) + 1;

    const categories = getCategoriesForDisplay().map((c) => {
      const cur = curBucket.byCat[c.id] || 0;
      const prev = prevBucket.byCat[c.id] || 0;
      return { ...c, currentMinor: cur, previousMinor: prev, deltaMinor: cur - prev };
    })
      .filter((c) => c.currentMinor > 0 || c.previousMinor > 0)
      .sort((a, b) => b.currentMinor - a.currentMinor || b.previousMinor - a.previousMinor);

    return {
      granularity,
      period,
      previousPeriod: previous,
      categoryId,
      series,
      currentTotal,
      previousTotal,
      deltaMinor: currentTotal - previousTotal,
      entryCount: categoryId
        ? expenses.filter((e) => e.category === categoryId && periodOf(e.date, granularity) === period).length
        : curBucket.count,
      categories,
      hasPrevious: Boolean(idx[previous]),
      biggest,
      dayCount,
      // The actual expenses behind the headline, newest first. Every figure on
      // this screen is derived from this list, so showing it is what lets
      // someone check a total instead of taking it on trust.
      entries: inPeriod.slice().sort((a, b) => (a.date === b.date
        ? String(b.createdAt).localeCompare(String(a.createdAt))
        : b.date.localeCompare(a.date))),
    };
  }

  function periodBounds(period, granularity) {
    if (granularity === 'day') return { start: period, end: period };
    if (granularity === 'week') return { start: period, end: shiftPeriod(period, 'day', 6) };
    if (granularity === 'month') {
      const [y, m] = period.split('-').map(Number);
      return { start: `${period}-01`, end: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
    }
    return { start: `${period}-01-01`, end: `${period}-12-31` };
  }

  function daysBetween(a, b) {
    const [ay, am, ad] = a.split('-').map(Number);
    const [by, bm, bd] = b.split('-').map(Number);
    return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
  }

  // ---------- Settings ----------

  function normalizeSettings(s) {
    const budget = Math.round(Number(s.monthlyBudgetMinor) || 0);
    const str = (v) => (typeof v === 'string' ? v.trim() : '');
    return {
      currency: typeof s.currency === 'string' && s.currency ? s.currency : DEFAULT_SETTINGS.currency,
      locale: typeof s.locale === 'string' && s.locale ? s.locale : DEFAULT_SETTINGS.locale,
      monthlyBudgetMinor: Math.max(0, budget),
      theme: ['light', 'dark', 'system'].includes(s.theme) ? s.theme : DEFAULT_SETTINGS.theme,
      dayView: ['chart', 'calendar'].includes(s.dayView) ? s.dayView : DEFAULT_SETTINGS.dayView,
      syncUrl: str(s.syncUrl),
      syncToken: str(s.syncToken),
      syncAddToken: str(s.syncAddToken),
      lastSyncAt: str(s.lastSyncAt),
    };
  }

  function getSettings() {
    return load().settings;
  }

  function setSettings(patch) {
    const data = load();
    data.settings = normalizeSettings({ ...data.settings, ...patch });
    save(data);
    return data.settings;
  }

  // ---------- Sync ----------

  // Everything changed since the last successful sync, tombstones included.
  function getPendingExpenses() {
    const data = load();
    const since = data.settings.lastSyncAt;
    if (!since) return data.expenses.slice();
    return data.expenses.filter((e) => String(e.updatedAt) > String(since));
  }

  // A shortcut sends a category by name ("Food & Drink"); the app stores ids.
  // Match either, and keep the raw value when nothing matches so the record is
  // surfaced as an orphan rather than silently refiled.
  function resolveCategory(value, categories) {
    const needle = String(value || '').trim().toLowerCase();
    if (!needle) return 'other';
    const hit = categories.find(
      (c) => c.id.toLowerCase() === needle || c.label.toLowerCase() === needle
    );
    return hit ? hit.id : String(value).trim();
  }

  /**
   * Applies records from the server, newest-write-wins per uid. Returns how
   * many were actually applied, so "nothing changed" can be reported honestly.
   */
  function mergeRemote(incoming) {
    const data = load();
    const byUid = new Map(data.expenses.map((e) => [e.uid, e]));
    let applied = 0;

    for (const raw of incoming || []) {
      const inc = normalizeExpense(raw);
      inc.category = resolveCategory(inc.category, data.categories);
      if (!inc.uid || !inc.date) continue;

      const cur = byUid.get(inc.uid);
      if (!cur) {
        inc.id = data.nextId++;
        data.expenses.push(inc);
        byUid.set(inc.uid, inc);
        applied++;
      } else if (String(inc.updatedAt) > String(cur.updatedAt)) {
        const merged = { ...inc, id: cur.id };
        data.expenses[data.expenses.findIndex((e) => e.uid === inc.uid)] = merged;
        byUid.set(inc.uid, merged);
        applied++;
      }
    }
    save(data);
    return applied;
  }

  function setLastSyncAt(iso) {
    const data = load();
    data.settings = normalizeSettings({ ...data.settings, lastSyncAt: String(iso || '') });
    save(data);
    return data.settings;
  }

  // ---------- Backup ----------

  function exportData() {
    const data = load();
    return {
      app: 'tracky',
      version: 1,
      exportedAt: new Date().toISOString(),
      expenses: data.expenses,
      nextId: data.nextId,
      categories: data.categories,
      settings: data.settings,
    };
  }

  // Spreadsheet-friendly export. Amounts go out as plain decimals, and every
  // field is quoted with embedded quotes doubled, so notes containing commas,
  // quotes or newlines survive the round trip.
  function exportCsv() {
    const data = load();
    const labels = {};
    getCategoriesForDisplay().forEach((c) => (labels[c.id] = c.label));
    const cell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const rows = [['Date', 'Category', 'Note', 'Amount', 'Currency']];
    live(data.expenses)
      .slice()
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id))
      .forEach((e) => {
        rows.push([
          e.date,
          labels[e.category] || e.category,
          e.note,
          (e.amountMinor / MINOR_PER_MAJOR).toFixed(2),
          data.settings.currency,
        ]);
      });
    return rows.map((r) => r.map(cell).join(',')).join('\r\n');
  }

  function importData(parsed) {
    // Backups written before the rename say 'tappy'; still accept them.
    if (!parsed || !['tracky', 'tappy'].includes(parsed.app) || !Array.isArray(parsed.expenses)) {
      throw new Error('Not a valid Tracky backup file.');
    }
    const data = load();
    data.expenses = parsed.expenses.map(normalizeExpense).filter((e) => e.id && e.date);
    data.nextId =
      Number(parsed.nextId) || Math.max(0, ...data.expenses.map((e) => e.id)) + 1;
    if (Array.isArray(parsed.categories) && parsed.categories.length) {
      data.categories = parsed.categories.map((c, i) => normalizeCategory(c, i)).filter((c) => c.id);
    }
    if (parsed.settings) data.settings = normalizeSettings({ ...data.settings, ...parsed.settings });
    save(data);
    return { expenses: data.expenses.length };
  }

  /**
   * Appends expenses that came from somewhere else.
   *
   * Deliberately NOT importData: a Tracky backup replaces what is here, because
   * it is this app's own history arriving whole. A CSV from another app is the
   * opposite - it is being added to whatever the person has already typed in,
   * and replacing that would destroy the very thing they were told to try
   * first.
   *
   * `category` must already be a real category id; resolving another app's
   * labels is the caller's job, since only the person importing knows that
   * "Eating out" is this app's Food.
   *
   * Records identical to one already stored are skipped. Importing the same
   * file twice is an ordinary mistake and doubling five years of spending is a
   * bad way to find out you made it.
   */
  function importExpenses(records) {
    const data = load();
    const stamp = nowIso();
    const fingerprint = (e) => [e.date, e.amountMinor, e.category, String(e.note || '').trim()].join('|');
    const seen = new Set(live(data.expenses).map(fingerprint));
    const valid = new Set(data.categories.map((c) => c.id));
    let added = 0;
    let duplicates = 0;
    let skipped = 0;

    for (const r of records || []) {
      const record = normalizeExpense({
        id: data.nextId++,
        uid: newUid(),
        date: r.date,
        amountMinor: r.amountMinor,
        category: valid.has(r.category) ? r.category : 'other',
        note: r.note,
        createdAt: stamp,
        updatedAt: stamp,
      });
      if (!record.date || record.amountMinor <= 0) { skipped++; data.nextId--; continue; }
      const key = fingerprint(record);
      if (seen.has(key)) { duplicates++; data.nextId--; continue; }
      seen.add(key);
      data.expenses.push(record);
      added++;
    }
    save(data);
    return { added, duplicates, skipped };
  }

  function clearAll() {
    save(freshData());
  }

  return {
    MINOR_PER_MAJOR,
    TINT_COUNT,
    getCategories,
    getCategoriesForDisplay,
    categoryUsage,
    addCategory,
    updateCategory,
    moveCategory,
    removeCategory,
    mergeCategory,
    exportCsv,
    toMinor,
    addExpense,
    updateExpense,
    deleteExpense,
    restoreExpense,
    getExpense,
    getDay,
    getMonth,
    getDailyTotals,
    getRecentDays,
    periodOf,
    shiftPeriod,
    listPeriods,
    getComparison,
    getSettings,
    setSettings,
    importExpenses,
    getPendingExpenses,
    mergeRemote,
    setLastSyncAt,
    exportData,
    importData,
    clearAll,
  };
})();
