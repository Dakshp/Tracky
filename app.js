// Shown in Settings. Bump it and sw.js's CACHE together on every release - the
// two are what tell a fixed build apart from a cached one. Where a release only
// rewrites visible copy, the copy itself is the tell, so this may hold while
// CACHE takes a suffix instead.
const APP_VERSION = 26;

const state = {
  date: todayStr(),
  category: 'food',
  amount: '0',
  editingId: null,
};

const el = (id) => document.getElementById(id);

// ---------- Dates ----------
// "Today" is read from local calendar fields. Going through toISOString() would
// convert to UTC first and hand back yesterday's date for anyone east of
// Greenwich (IST included) for the first hours of every day.
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Date strings are plain calendar dates with no timezone, so all arithmetic is
// done in UTC where days are always exactly 24h (no DST shifts).
function shiftDate(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function daysInMonth(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function formatDayTitle(dateStr) {
  if (dateStr === todayStr()) return 'Today';
  if (dateStr === shiftDate(todayStr(), -1)) return 'Yesterday';
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const sameYear = y === new Date().getFullYear();
  return dt.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: sameYear ? undefined : 'numeric',
    timeZone: 'UTC',
  });
}

function formatMonthTitle(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// ---------- Money ----------

function formatMoney(minor, { compact = false } = {}) {
  const s = Store.getSettings();
  const value = (Number(minor) || 0) / Store.MINOR_PER_MAJOR;
  const hasPaise = Math.round(value * 100) % 100 !== 0;
  try {
    return new Intl.NumberFormat(s.locale, {
      style: 'currency',
      currency: s.currency,
      minimumFractionDigits: compact && !hasPaise ? 0 : 2,
      maximumFractionDigits: compact && !hasPaise ? 0 : 2,
    }).format(value);
  } catch (err) {
    return `${s.currency} ${value.toFixed(2)}`;
  }
}

function currencySymbol() {
  const s = Store.getSettings();
  try {
    const parts = new Intl.NumberFormat(s.locale, { style: 'currency', currency: s.currency }).formatToParts(0);
    return (parts.find((p) => p.type === 'currency') || {}).value || s.currency;
  } catch (err) {
    return s.currency;
  }
}

function parseAmountToMinor(str) {
  const n = Number(String(str).replace(/[^0-9.]/g, ''));
  return isFinite(n) && n > 0 ? Math.round(n * Store.MINOR_PER_MAJOR) : 0;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str == null ? '' : str);
  return div.innerHTML;
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function categoryMeta(id) {
  return (
    Store.getCategoriesForDisplay().find((c) => c.id === id)
    || { id, label: id, icon: '❓', tint: 9 }
  );
}

// Each category owns a slot in the palette; the stylesheet holds the two
// lightnesses. Setting both as local custom properties lets a rule ask for
// var(--tint) without knowing which category it is painting.
function tintVars(meta) {
  const n = Number.isInteger(meta.tint) ? meta.tint : 9;
  return `--tint: var(--tint-${n}); --tint-soft: var(--tint-${n}-soft);`;
}

function toast(message, action) {
  const t = el('toast');
  t.innerHTML = '';
  const label = document.createElement('span');
  label.textContent = message;
  t.appendChild(label);
  if (action) {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      t.classList.add('hidden');
      clearTimeout(toast._timer);
      action.onClick();
    });
    t.appendChild(btn);
  }
  t.classList.remove('hidden');
  clearTimeout(toast._timer);
  // An undoable action stays up longer - it is useless if it vanishes before
  // the reader has registered what happened.
  toast._timer = setTimeout(() => t.classList.add('hidden'), action ? 5200 : 1900);
}

/**
 * Horizontal drag on an element, without stealing vertical scrolling.
 *
 * The direction is decided once per gesture from the first few pixels: if the
 * movement is mostly vertical the gesture is released back to the scroller and
 * never reclaimed, so a slightly slanted scroll does not turn into a swipe.
 */
function onHorizontalSwipe(target, { onSwipe, onDrag, threshold = 45, owner = true, axisRatio = 1 }) {
  // Marks this element as having claimed horizontal drags. The screen-level
  // tab gesture checks for it and stands down, so swiping a chart, a calendar
  // or an expense row never also flips to the next tab.
  if (owner) target.dataset.swipeOwner = '';
  let startX = 0;
  let startY = 0;
  let active = false;
  let axis = null; // null until decided, then 'x' or 'y'

  const point = (e) => (e.touches ? e.touches[0] : e);

  const start = (e) => {
    // Belt and braces alongside user-select: none. If anything on the page ever
    // does end up selected, dragging its handles is a horizontal movement, and
    // a gesture must not be able to ride in on one.
    const sel = window.getSelection && window.getSelection();
    if (sel && !sel.isCollapsed) { active = false; return; }
    const p = point(e);
    startX = p.clientX;
    startY = p.clientY;
    active = true;
    axis = null;
  };

  const move = (e) => {
    if (!active) return;
    const p = point(e);
    const dx = p.clientX - startX;
    const dy = p.clientY - startY;
    if (axis === null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      // axisRatio above 1 asks for a decidedly horizontal drag rather than
      // merely a more-horizontal-than-vertical one, for gestures that should
      // take deliberation.
      axis = Math.abs(dx) > Math.abs(dy) * axisRatio ? 'x' : 'y';
    }
    if (axis !== 'x') return;
    if (e.cancelable) e.preventDefault();
    if (onDrag) onDrag(dx);
  };

  const end = (e) => {
    if (!active) return;
    active = false;
    const p = e.changedTouches ? e.changedTouches[0] : e;
    const dx = p.clientX - startX;
    const wasHorizontal = axis === 'x';
    axis = null;
    if (onDrag) onDrag(0, true);
    if (wasHorizontal && Math.abs(dx) >= threshold) onSwipe(dx < 0 ? 1 : -1, dx, e);
    return wasHorizontal;
  };

  target.addEventListener('touchstart', start, { passive: true });
  target.addEventListener('touchmove', move, { passive: false });
  target.addEventListener('touchend', end);
  target.addEventListener('touchcancel', end);
  // Mouse equivalents, so the same gesture is reachable with a trackpad.
  target.addEventListener('pointerdown', (e) => e.pointerType === 'mouse' && start(e));
  target.addEventListener('pointermove', (e) => e.pointerType === 'mouse' && move(e));
  target.addEventListener('pointerup', (e) => e.pointerType === 'mouse' && end(e));
  target.addEventListener('pointercancel', (e) => e.pointerType === 'mouse' && end(e));
}

// ---------- Today screen ----------

function renderToday() {
  el('dateTitle').textContent = formatDayTitle(state.date);
  el('dayLargeTitle').textContent = formatDayTitle(state.date);
  el('datePicker').value = state.date;

  const day = Store.getDay(state.date);
  el('dayTotal').textContent = formatMoney(day.totalMinor, { compact: true });
  el('dayCount').textContent = day.expenses.length
    ? `${day.expenses.length} ${day.expenses.length === 1 ? 'entry' : 'entries'}`
    : '';

  renderBudget();

  const list = el('dayList');
  list.innerHTML = '';
  if (!day.expenses.length) {
    list.innerHTML = '<p class="empty-msg">Nothing logged yet.<br>Tap + to add your first expense.</p>';
    return;
  }
  day.expenses.forEach((e) => list.appendChild(buildExpenseRow(e)));
}

// Only one row may sit open at a time, matching how iOS lists behave.
let openSwipeRow = null;
function closeSwipedRow() {
  if (!openSwipeRow) return;
  openSwipeRow.classList.remove('revealed');
  openSwipeRow = null;
}

const SWIPE_REVEAL = 176; // two action pills plus the gaps between them

/**
 * An expense row with iOS-style trailing actions: swipe left to reveal Edit and
 * Delete in place. No intermediate menu - that is the convention people already
 * have from Mail, and an extra step buys nothing.
 */
function buildExpenseRow(e) {
  const meta = categoryMeta(e.category);

  const wrap = document.createElement('div');
  wrap.className = 'row-wrap';

  const actions = document.createElement('div');
  actions.className = 'row-actions';

  const makeAction = (cls, label, iconPath, onClick) => {
    const b = document.createElement('button');
    b.className = `row-action ${cls}`;
    b.type = 'button';
    b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">${iconPath}</svg>`;
    const text = document.createElement('span');
    text.textContent = label;
    b.appendChild(text);
    b.addEventListener('click', onClick);
    return b;
  };

  const edit = makeAction(
    'action-edit',
    'Edit',
    '<path d="M4 20h4L19 9a2.4 2.4 0 10-3.4-3.4L4.6 16.6 4 20z" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/>',
    () => { closeSwipedRow(); openSheet(e.id); }
  );

  const del = makeAction(
    'action-delete',
    'Delete',
    '<path d="M5 7h14M10 7V5.4A1.4 1.4 0 0111.4 4h1.2A1.4 1.4 0 0114 5.4V7M6.5 7l.8 11.2A1.9 1.9 0 009.2 20h5.6a1.9 1.9 0 001.9-1.8L17.5 7" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
    () => { closeSwipedRow(); deleteWithUndo(e); }
  );

  actions.append(edit, del);

  const row = document.createElement('button');
  row.className = 'expense-row';
  row.type = 'button';
  row.setAttribute('style', tintVars(meta));
  row.innerHTML = `
    <span class="row-icon">${meta.icon}</span>
    <span class="row-body">
      <span class="row-title">${escapeHtml(e.note || meta.label)}</span>
      <span class="row-sub">${escapeHtml([e.note ? meta.label : '', formatTime(e.createdAt)].filter(Boolean).join(' · '))}</span>
    </span>
    <span class="row-amount">${formatMoney(e.amountMinor)}</span>
  `;

  let dragged = false;
  onHorizontalSwipe(row, {
    // Deliberate, not incidental: a row opening by accident is worse than one
    // that takes a firmer pull, since the actions it uncovers include Delete.
    threshold: 70,
    axisRatio: 1.6,
    onDrag: (dx, done) => {
      if (done) {
        row.style.transform = '';
        wrap.classList.remove('sliding');
        return;
      }
      dragged = Math.abs(dx) > 6;
      // Only now are the actions allowed to be seen at all.
      wrap.classList.add('sliding');
      const base = wrap.classList.contains('revealed') ? -SWIPE_REVEAL : 0;
      // Rubber-band past the ends so the row cannot be dragged off into space.
      const next = Math.max(Math.min(base + dx, 0), -SWIPE_REVEAL - 24);
      row.style.transform = `translateX(${next}px)`;
    },
    onSwipe: (dir) => {
      if (dir === 1) {
        if (openSwipeRow && openSwipeRow !== wrap) closeSwipedRow();
        wrap.classList.add('revealed');
        openSwipeRow = wrap;
      } else {
        closeSwipedRow();
      }
    },
  });

  // A tap that followed a drag should not also open the editor.
  row.addEventListener('click', () => {
    if (dragged) {
      dragged = false;
      return;
    }
    if (wrap.classList.contains('revealed')) {
      closeSwipedRow();
      return;
    }
    openSheet(e.id);
  });

  wrap.append(actions, row);
  return wrap;
}

// Deleting from a gesture needs to be recoverable: a swipe is easy to make by
// accident, so this offers Undo rather than blocking on a confirm dialog.
function deleteWithUndo(expense) {
  Store.deleteExpense(expense.id);
  renderAll();
  scheduleSync();
  toast(`Deleted ${formatMoney(expense.amountMinor, { compact: true })}`, {
    label: 'Undo',
    onClick: () => {
      Store.restoreExpense(expense.id);
      renderAll();
      scheduleSync();
      toast('Restored');
    },
  });
}

function renderBudget() {
  const s = Store.getSettings();
  const month = state.date.slice(0, 7);
  const spent = Store.getMonth(month).totalMinor;
  const budget = s.monthlyBudgetMinor;

  el('monthLabel').textContent = formatMonthTitle(month);

  if (budget <= 0) {
    el('monthSummary').textContent = formatMoney(spent, { compact: true });
    el('monthProgress').style.width = '0%';
    el('budgetNote').textContent = 'No monthly budget set.';
    return;
  }

  const pct = Math.min((spent / budget) * 100, 100);
  const bar = el('monthProgress');
  bar.style.width = `${pct}%`;
  bar.classList.toggle('over', spent > budget);

  el('monthSummary').textContent = `${formatMoney(spent, { compact: true })} of ${formatMoney(budget, { compact: true })}`;

  const left = budget - spent;
  if (left < 0) {
    el('budgetNote').textContent = `${formatMoney(-left, { compact: true })} over budget`;
    return;
  }
  // Pace the remainder over the days still to come, so the number answers
  // "what can I spend per day from here" rather than just "what is left".
  const total = daysInMonth(month);
  const isCurrentMonth = month === todayStr().slice(0, 7);
  const dayOfMonth = isCurrentMonth ? Number(todayStr().slice(8, 10)) : total;
  const daysLeft = Math.max(total - dayOfMonth + 1, 1);
  el('budgetNote').textContent =
    `${formatMoney(left, { compact: true })} left` +
    (isCurrentMonth ? ` · ${formatMoney(Math.floor(left / daysLeft), { compact: true })}/day for ${daysLeft} more ${daysLeft === 1 ? 'day' : 'days'}` : '');
}

// ---------- Compare dashboard ----------

const compare = {
  granularity: 'day', // it is a daily tracker, so start on days
  period: todayStr(), // the highlighted bar
  anchor: todayStr(), // the period the visible window ends at
  categoryId: null,
  showTable: false,
};

// Few, wide, clearly-labelled bars beat a dense year of slivers.
const SPAN = { day: 7, week: 6, month: 6, year: 4 };

const UNIT_NAME = { day: 'Day', week: 'Week', month: 'Month', year: 'Year' };

function parseUTC(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fmtUTC(date, opts) {
  return date.toLocaleDateString(undefined, { ...opts, timeZone: 'UTC' });
}

/**
 * "Today", "This week", "Last month" and friends - only when the period really
 * is the current or immediately preceding one, so the wording is never a lie.
 */
function relativePeriodName(period, granularity) {
  const current = Store.periodOf(todayStr(), granularity);
  if (period === current) return { day: 'Today', week: 'This week', month: 'This month', year: 'This year' }[granularity];
  if (period === Store.shiftPeriod(current, granularity, -1)) {
    return { day: 'Yesterday', week: 'Last week', month: 'Last month', year: 'Last year' }[granularity];
  }
  return null;
}

function periodLabel(period, granularity, style = 'long') {
  const relative = relativePeriodName(period, granularity);
  if (relative && style !== 'plain') return relative;

  if (granularity === 'year') return period;

  if (granularity === 'month') {
    const [y, m] = period.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1, 1));
    return style === 'short'
      ? fmtUTC(d, { month: 'short' })
      : fmtUTC(d, { month: 'long', year: 'numeric' });
  }

  if (granularity === 'week') {
    const start = parseUTC(period);
    const end = parseUTC(Store.shiftPeriod(period, 'day', 6));
    const sameMonth = start.getUTCMonth() === end.getUTCMonth();
    return sameMonth
      ? `${start.getUTCDate()}–${end.getUTCDate()} ${fmtUTC(end, { month: 'short' })}`
      : `${start.getUTCDate()} ${fmtUTC(start, { month: 'short' })} – ${end.getUTCDate()} ${fmtUTC(end, { month: 'short' })}`;
  }

  const d = parseUTC(period);
  return style === 'short'
    ? fmtUTC(d, { day: 'numeric', month: 'short' })
    : fmtUTC(d, { weekday: 'long', day: 'numeric', month: 'long' });
}

/**
 * Axis labels are two short stacked lines rather than one cramped string, so a
 * day reads "Mon / 11" and a month reads "Aug" instead of a bare initial.
 */
function axisLabel(period, granularity) {
  if (granularity === 'year') return [period, ''];
  if (granularity === 'month') {
    const [y, m] = period.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1, 1));
    return [fmtUTC(d, { month: 'short' }), m === 1 ? String(y) : ''];
  }
  if (granularity === 'week') {
    const start = parseUTC(period);
    const end = parseUTC(Store.shiftPeriod(period, 'day', 6));
    return [`${start.getUTCDate()}–${end.getUTCDate()}`, fmtUTC(end, { month: 'short' })];
  }
  const d = parseUTC(period);
  return [fmtUTC(d, { weekday: 'short' }), String(d.getUTCDate())];
}

// Reads inside a sentence ("compared with yesterday"), so relative names are
// lowercased and concrete dates are left as they are.
function vsLabel(period, granularity) {
  const relative = relativePeriodName(period, granularity);
  return relative ? relative.toLowerCase() : periodLabel(period, granularity, 'plain');
}

// The period as it reads inside a sentence: "today", "on Wednesday, 12 August",
// "in August 2026". A relative name is already a phrase and takes no
// preposition - "nothing logged in today" is not English.
function periodPhrase(period, granularity) {
  const relative = relativePeriodName(period, granularity);
  if (relative) return relative.toLowerCase();
  return `${granularity === 'day' ? 'on' : 'in'} ${periodLabel(period, granularity, 'plain')}`;
}

// A date that sits inside the period, used to carry the selection across a
// granularity switch (today wins when the period contains it).
function representativeDate(period, granularity) {
  const today = todayStr();
  if (Store.periodOf(today, granularity) === period) return today;
  if (granularity === 'year') return `${period}-01-01`;
  if (granularity === 'month') return `${period}-01`;
  return period;
}

// Direction is carried by a glyph AND a word, never by colour alone - for an
// expense log "more" is the bad direction, so the tones are inverted from the
// usual up-is-good reading.
function deltaInfo(deltaMinor, hasPrevious) {
  if (!hasPrevious) return { text: 'No earlier period', tone: 'flat' };
  if (deltaMinor === 0) return { text: 'No change', tone: 'flat' };
  const up = deltaMinor > 0;
  return {
    text: `${up ? '▲' : '▼'} ${formatMoney(Math.abs(deltaMinor), { compact: true })} ${up ? 'more' : 'less'}`,
    tone: up ? 'up' : 'down',
  };
}

function syncComparePeriod() {
  compare.period = Store.periodOf(state.date, compare.granularity);
  compare.anchor = compare.period;
}

// Period keys are fixed-width and zero-padded, so plain string ordering is
// chronological ordering for both 'YYYY-MM' and 'YYYY'.

/**
 * Scroll the chart one period, carrying the selection with it.
 *
 * The window used to stay put until the selection fell off its edge, which
 * meant the first six swipes changed nothing but which bar was highlighted -
 * so reaching the days before the leftmost one took seven swipes before
 * anything appeared to move. Now the whole window slides on the first swipe and
 * the selection keeps its place within it, which is what "scroll the chart"
 * means to anyone using it.
 *
 * Tapping a bar still selects inside the window without moving it. That is the
 * complementary gesture: swipe to travel, tap to pick.
 */
function movePeriod(delta) {
  const g = compare.granularity;
  const span = SPAN[g];
  // There is nothing after the present to scroll to, so the window stops there.
  const latest = Store.periodOf(todayStr(), g);
  const wantAnchor = Store.shiftPeriod(compare.anchor, g, delta);

  if (wantAnchor <= latest) {
    compare.anchor = wantAnchor;
    compare.period = Store.shiftPeriod(compare.period, g, delta);
  } else {
    // Already showing up to the present. Rather than doing nothing, let the
    // selection walk forward inside the window until it reaches the last bar.
    compare.period = Store.shiftPeriod(compare.period, g, delta);
  }

  // Whatever happened above, the selection stays inside the visible window -
  // a highlighted bar nobody can see is worse than one that stops at the edge.
  const windowStart = Store.shiftPeriod(compare.anchor, g, -(span - 1));
  if (compare.period < windowStart) compare.period = windowStart;
  if (compare.period > compare.anchor) compare.period = compare.anchor;

  renderCompare();
}


// ---------- Pager ----------
//
// A three-page strip: the page before, the page shown, and the page after, with
// the middle one at rest. A drag moves the strip itself, so the neighbour is
// already on screen and travelling under the finger rather than appearing after
// the gesture has ended. The previous version nudged the whole card a few pixels
// and then swapped its contents, which read as the page changing rather than the
// contents moving.
const REST = 'translateX(-33.3333%)';
const GLIDE = 'transform .26s cubic-bezier(.25, .9, .3, 1)';

function fillPager(pager, buildPage) {
  const track = pager.querySelector('.pager-track');
  track.innerHTML = '';
  [-1, 0, 1].forEach((offset) => {
    const page = document.createElement('div');
    // is-current marks the one page that is live. The neighbours exist to be
    // looked at mid-swipe: nothing binds to them, and a tab stop on an
    // off-screen chart helps nobody.
    page.className = offset === 0 ? 'pager-page is-current' : 'pager-page';
    if (offset !== 0) page.setAttribute('aria-hidden', 'true');
    const node = buildPage(offset);
    if (node) page.appendChild(node);
    track.appendChild(page);
  });
  track.style.transition = 'none';
  track.style.transform = REST;
}

/**
 * Wire the drag. `step` commits the move; `canStep` says whether there is
 * anything that way, so the strip can resist instead of sliding to a blank.
 */
function attachPager(pager, { step, canStep, on }) {
  const track = pager.querySelector('.pager-track');
  // The gesture is taken across the whole card, but only the strip inside it
  // moves. Listening on the strip alone would mean a drag starting on the card's
  // padding, its heading or its footnote did nothing at all.
  const surface = on || pager;
  let settle = null;

  const glideTo = (transform, then) => {
    track.style.transition = GLIDE;
    track.style.transform = transform;
    if (!then) return;
    // transitionend can be missed if the element is re-rendered under it, so the
    // commit is also on a timer - whichever arrives first wins, once.
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      then();
    };
    track.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 300);
  };

  onHorizontalSwipe(surface, {
    threshold: 32,
    onDrag: (dx, ended) => {
      if (ended) {
        // onSwipe fires immediately after this when the drag was long enough,
        // and cancels the snap-back before it runs.
        settle = setTimeout(() => glideTo(REST), 0);
        return;
      }
      hidePeriodTip();
      // Resist rather than refuse: a drag towards a page that does not exist
      // still moves, just reluctantly, which says "nothing here" by feel.
      const resisted = (dx < 0 && !canStep(1)) || (dx > 0 && !canStep(-1));
      const travel = resisted ? dx * 0.22 : dx;
      track.style.transition = 'none';
      track.style.transform = `translateX(calc(-33.3333% + ${travel}px))`;
    },
    onSwipe: (dir) => {
      clearTimeout(settle);
      lastChartSwipeAt = Date.now();
      if (!canStep(dir)) {
        glideTo(REST);
        return;
      }
      // Carry the strip the rest of the way, then commit. The re-render puts a
      // fresh set of three pages back at rest, so the swap is invisible.
      glideTo(dir > 0 ? 'translateX(-66.6667%)' : 'translateX(0%)', () => step(dir));
    },
  });

  surface.addEventListener('wheel', (e) => onWheelGesture(e, (dir) => {
    if (!canStep(dir)) return;
    glideTo(dir > 0 ? 'translateX(-66.6667%)' : 'translateX(0%)', () => step(dir));
  }), { passive: false });
}

// ---------- Calendar ----------

// Four steps rather than a continuous ramp. A smooth gradient asks the reader to
// judge shades against each other; four levels can be told apart at a glance and
// each one is a plain sentence - nothing, a little, more, most.
const CAL_STEPS = 4;

function monthOf(dateStr) {
  return dateStr.slice(0, 7);
}

function lastDayOfMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Move the calendar a whole month, keeping the day of the month where possible.
 *
 * Keeping the day is what makes the selection survive the scroll: land on the
 * 3rd of the next month rather than resetting to the 1st, so the figures below
 * stay about a comparable day instead of jumping somewhere arbitrary.
 */
function moveCalendarMonth(delta) {
  const [y, m, d] = compare.period.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + delta, 1));
  const month = target.toISOString().slice(0, 7);
  const today = todayStr();

  // Nothing has been spent in the future, so a month past this one is refused
  // outright and the current month stops at today.
  if (month > monthOf(today)) return;
  let day = Math.min(d, lastDayOfMonth(month));
  let next = `${month}-${String(day).padStart(2, '0')}`;
  if (next > today) next = today;

  compare.period = next;
  compare.anchor = next;
  renderCompare();
}

/**
 * The day's total, short enough for a 44px cell.
 *
 * Deliberately NOT Intl's compact notation: for en-IN that abbreviates a
 * thousand as "T", so 4,500 renders as "4.5T" - which reads as trillions to
 * anyone who has not met the Indian English convention. A plain grouped number
 * is a character or two longer and cannot be misread. The currency symbol is
 * left off; it is on every other figure on the screen, and inside a cell it
 * costs width the number needs more.
 */
function cellAmount(minor) {
  const s = Store.getSettings();
  const value = Math.round((minor || 0) / Store.MINOR_PER_MAJOR);
  try {
    return new Intl.NumberFormat(s.locale, { maximumFractionDigits: 0 }).format(value);
  } catch (err) {
    return String(value);
  }
}

/** One month's grid, as a detached node so the pager can hold three of them. */
function buildCalGrid(month, selected, categoryId) {
  const today = todayStr();
  const days = lastDayOfMonth(month);
  const totals = Store.getDailyTotals(days, `${month}-${String(days).padStart(2, '0')}`, categoryId);
  const byDate = Object.fromEntries(totals.map((t) => [t.date, t.totalMinor]));
  const max = Math.max(...totals.map((t) => t.totalMinor), 1);

  const grid = document.createElement('div');
  grid.className = 'cal-grid';
  grid.setAttribute('role', 'grid');
  grid.setAttribute('aria-label', `Spending in ${formatMonthTitle(month)}`);

  // Monday-first, matching the week granularity elsewhere in the app.
  const [y, m] = month.split('-').map(Number);
  const firstDow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  for (let i = 0; i < firstDow; i++) {
    const blank = document.createElement('span');
    blank.className = 'cal-blank';
    grid.appendChild(blank);
  }

  for (let d = 1; d <= days; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    const amount = byDate[date] || 0;
    const future = date > today;

    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cal-day';
    cell.dataset.date = date;
    cell.dataset.amount = String(amount);
    cell.disabled = future;

    // Step 0 is genuinely nothing; anything spent is at least step 1, so a small
    // day never disappears into the empty ones.
    const step = amount > 0 ? Math.max(1, Math.ceil((amount / max) * (CAL_STEPS - 1))) : 0;
    cell.dataset.level = future ? 'future' : String(step);
    if (date === today) cell.classList.add('is-today');
    if (date === selected) {
      cell.classList.add('is-selected');
      cell.setAttribute('aria-current', 'date');
    }

    const num = document.createElement('span');
    num.className = 'cal-num';
    num.textContent = String(d);
    cell.appendChild(num);

    // The amount in the cell, so the grid can be read as figures and not only
    // as shading. The shading stays because it is what makes a heavy week
    // visible without reading thirty numbers.
    //
    // Every day that has happened carries a figure, including the zeros: a
    // column of numbers with holes in it is harder to scan than one without,
    // and a 0 here is a real answer to "what did I spend" rather than a missing
    // one. Days that have NOT happened stay blank - a 0 there would be a claim
    // about a day that has not finished.
    if (!future) {
      const sum = document.createElement('span');
      sum.className = 'cal-sum';
      if (!amount) sum.classList.add('is-zero');
      sum.textContent = cellAmount(amount);
      cell.appendChild(sum);
    }

    cell.setAttribute('aria-label', `${formatDayTitle(date)}: ${
      future ? 'not yet' : amount > 0 ? formatMoney(amount, { compact: true }) : 'nothing spent'
    }`);
    grid.appendChild(cell);
  }
  return grid;
}

function renderCalendar(data) {
  const card = el('calendarCard');
  const isDay = data.granularity === 'day';
  // The calendar is an alternative to the chart, not a replacement for it. Both
  // answer different questions - the chart shows the run of recent days, the
  // calendar the shape of a whole month - so the choice is the reader's, and it
  // is remembered.
  const view = isDay ? Store.getSettings().dayView : 'chart';
  const showCal = isDay && view === 'calendar';

  const toggle = el('dayViewToggle');
  toggle.classList.toggle('hidden', !isDay);
  toggle.querySelectorAll('button').forEach((b) => {
    const on = b.dataset.view === view;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });

  card.classList.toggle('hidden', !showCal);
  el('chartNote').parentElement.classList.toggle('hidden', showCal);
  if (!showCal) return;

  const month = monthOf(data.period);
  const today = todayStr();
  el('calMonth').textContent = formatMonthTitle(month);
  el('calNext').disabled = month >= monthOf(today);

  // Weekday initials come from the browser rather than a hard-coded list, so a
  // phone set to another language gets its own.
  const dows = el('calDows');
  dows.innerHTML = '';
  for (let i = 0; i < 7; i++) {
    const cell = document.createElement('span');
    // 2024-01-01 was a Monday, which is the column the grid starts on.
    cell.textContent = new Date(Date.UTC(2024, 0, 1 + i))
      .toLocaleDateString(undefined, { weekday: 'narrow', timeZone: 'UTC' });
    dows.appendChild(cell);
  }

  fillPager(el('calPager'), (offset) => {
    const [y, m] = month.split('-').map(Number);
    const target = new Date(Date.UTC(y, m - 1 + offset, 1)).toISOString().slice(0, 7);
    if (target > monthOf(today)) return null;
    // The focus scopes the grid too: with one category selected the cells show
    // that category's days, matching every other figure on the screen.
    return buildCalGrid(target, data.period, data.categoryId);
  });

  el('calPager').querySelectorAll('.is-current .cal-day').forEach((cell) => {
    cell.addEventListener('click', () => {
      if (Date.now() - lastChartSwipeAt < 400) return;
      compare.period = cell.dataset.date;
      compare.anchor = cell.dataset.date;
      renderCompare();
    });
  });

  // The scale is spelled out, because a shade on its own means nothing - and
  // the direction is not the same in both themes: the ramp runs towards deep
  // indigo on a light page and towards pale indigo on a dark one, so saying
  // "darker" in dark mode would name the wrong end.
  const spent = Store.getDailyTotals(
    lastDayOfMonth(month),
    `${month}-${String(lastDayOfMonth(month)).padStart(2, '0')}`,
    data.categoryId
  ).map((t) => t.totalMinor).filter((v) => v > 0);
  const dark = document.documentElement.dataset.theme === 'dark';
  el('calScale').textContent = spent.length
    ? `${dark ? 'Brighter' : 'Darker'} means more spent · up to ${formatMoney(Math.max(...spent), { compact: true })} a day`
    : 'Nothing spent this month';
}

/**
 * Scroll the chart by a whole window.
 *
 * The strip slides a full page, so a full page of days is what has to change.
 * Moving one day behind a full-page animation was the mismatch: the screen said
 * "here is a different week" and the content said "the same week, shifted one".
 * The header arrows still step a single period, so both scales are reachable -
 * the same split the calendar already uses, where a swipe is a month and an
 * arrow is a day.
 */
function scrollWindow(dir) {
  const g = compare.granularity;
  const span = SPAN[g];
  const latest = Store.periodOf(todayStr(), g);

  // Where the selection sits inside the window, counted back from its right
  // edge. Keeping that offset is what stops the selection jumping to an edge.
  let offset = 0;
  for (let k = 0; k < span; k++) {
    if (Store.shiftPeriod(compare.anchor, g, -k) === compare.period) { offset = k; break; }
  }

  let anchor = Store.shiftPeriod(compare.anchor, g, dir * span);
  // Landing exactly on the present rather than refusing the move: a half window
  // of history is still a window worth arriving at.
  if (anchor > latest) anchor = latest;

  compare.anchor = anchor;
  let period = Store.shiftPeriod(anchor, g, -offset);
  if (period > latest) period = latest;
  compare.period = period;
  renderCompare();
}

function renderCompare() {
  populateFocusSelect();
  const data = Store.getComparison({
    granularity: compare.granularity,
    period: compare.period,
    endPeriod: compare.anchor,
    categoryId: compare.categoryId,
    span: SPAN[compare.granularity],
  });

  el('periodTitle').textContent = periodLabel(data.period, data.granularity);
  const unit = UNIT_NAME[data.granularity].toLowerCase();
  el('seriesHead').textContent = `${UNIT_NAME[data.granularity]} by ${unit}`;
  el('chartNote').textContent = `Swipe right for earlier ${unit}s · tap a bar to pick one`;

  // Nothing has happened after the present, so scrolling forward past it is a
  // dead action. Saying so with a greyed arrow beats a control that silently
  // does nothing when pressed.
  const atPresent = compare.anchor >= Store.periodOf(todayStr(), data.granularity)
    && compare.period >= compare.anchor;
  el('nextPeriod').disabled = atPresent;

  const focus = data.categoryId ? categoryMeta(data.categoryId) : null;
  el('cmpLabel').textContent = focus ? `${focus.icon} ${focus.label}` : 'Total spent';
  el('cmpTotal').textContent = formatMoney(data.currentTotal, { compact: true });

  const d = deltaInfo(data.deltaMinor, data.hasPrevious);
  const pill = el('cmpDelta');
  pill.textContent = d.text;
  pill.className = `delta-pill tone-${d.tone}`;

  const entries = `${data.entryCount} ${data.entryCount === 1 ? 'entry' : 'entries'}`;
  el('cmpSub').textContent = data.hasPrevious
    ? `compared with ${vsLabel(data.previousPeriod, data.granularity)} · ${entries}`
    : entries;

  renderTiles(data);
  renderCalendar(data);
  renderPeriodChart(data);
  renderCategoryCompare(data);
  renderEntries(data);
  renderTableView(data);
}

// Two plain-language figures beside the headline. "Average a day" is the one
// number that makes week/month/year totals comparable to each other; on a
// single day it would just restate the headline, so it is left out there.
function renderTiles(data) {
  const box = el('cmpTiles');
  box.innerHTML = '';
  const tiles = [];

  if (data.granularity !== 'day' && data.dayCount > 0 && data.currentTotal > 0) {
    tiles.push({
      label: 'Average a day',
      value: formatMoney(Math.round(data.currentTotal / data.dayCount), { compact: true }),
      note: `over ${data.dayCount} ${data.dayCount === 1 ? 'day' : 'days'}`,
    });
  }
  if (data.biggest) {
    const meta = categoryMeta(data.biggest.category);
    tiles.push({
      label: 'Biggest single spend',
      value: formatMoney(data.biggest.amountMinor, { compact: true }),
      note: data.biggest.note || `${meta.icon} ${meta.label}`,
    });
  }

  tiles.forEach((t) => {
    const tile = document.createElement('div');
    tile.className = 'stat-tile';
    const label = document.createElement('span');
    label.className = 'tile-label';
    label.textContent = t.label;
    const value = document.createElement('span');
    value.className = 'tile-value';
    value.textContent = t.value;
    const note = document.createElement('span');
    note.className = 'tile-note';
    note.textContent = t.note;
    tile.append(label, value, note);
    box.appendChild(tile);
  });
}

// Top corners rounded, base square - the data-end is rounded, the baseline is not.
function barPath(x, y, w, h, r) {
  const rr = Math.max(Math.min(r, w / 2, h), 0);
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}

let lastChartSwipeAt = 0;

/** One window of bars, as a detached <svg> so the pager can hold three. */
function buildChartSvg(data, interactive) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  if (interactive) svg.id = 'periodSvg';
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Spending by period');

  // The viewBox is kept close to the real rendered width so text scales to a
  // sensible size rather than shrinking to a fraction of what it says.
  const W = 360;
  const H = 190;
  // Headroom for a value sitting just above the tallest bar, and two lines of
  // axis label at the foot, so neither is ever clipped.
  const pad = { top: 20, bottom: 46, side: 6 };
  const plotH = H - pad.top - pad.bottom;
  const plotW = W - pad.side * 2;
  const n = data.series.length;
  const max = Math.max(...data.series.map((s) => s.totalMinor), 1);
  const gap = 10;
  const barW = (plotW - gap * (n - 1)) / n;
  const baseY = pad.top + plotH;

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

  const marks = data.series
    .map((s, i) => {
      const x = pad.side + i * (barW + gap);
      const h = s.totalMinor > 0 ? Math.max((s.totalMinor / max) * plotH, 3) : 0;
      const y = baseY - h;
      const selected = s.period === data.period;
      // "Where I am" and "what I am looking at" are different questions, so they
      // get different marks: the selection is the coloured bar, today is a dot
      // under its label. Using one mark for both meant that as soon as you
      // picked another day, today vanished from the chart entirely.
      const isNow = s.period === Store.periodOf(todayStr(), data.granularity);
      const cx = x + barW / 2;
      const [line1, line2] = axisLabel(s.period, data.granularity);

      // EVERY bar carries its figure, not just the selected one - a chart you
      // have to tap through one column at a time cannot be compared, which is
      // the only reason to put seven of them side by side.
      //
      // And the figure sits just above its OWN bar rather than in a band at the
      // top of the card. Pinned to the top, a ₹670 day and a ₹5,000 day printed
      // their numbers in exactly the same place, which said the two were
      // somehow equivalent.
      const text = cellAmount(s.totalMinor);
      // A column is about 41 units wide. Indian grouping makes a lakh eight
      // characters ("1,25,000"), which would run into its neighbours at full
      // size, so long figures step down rather than collide.
      const size = text.length > 7 ? 8 : text.length > 5 ? 9 : selected ? 11 : 10;
      const label = s.totalMinor > 0
        ? `<text x="${cx.toFixed(1)}" y="${Math.max(y - 5, 9).toFixed(1)}" text-anchor="middle"
                 font-size="${size}"
                 font-weight="${selected ? '700' : '500'}"
                 fill="${selected ? 'var(--viz-ink)' : 'var(--viz-muted)'}"
                 >${text}</text>`
        : '';
      // The bars borrow the calendar's own two strongest steps rather than a grey
      // and a colour, so the same data reads in the same language on both. They
      // reference the calendar tokens directly - given their own copies the two
      // would drift apart the first time either was tuned.
      //
      // Note the chart does NOT take the calendar's full four-step ramp: a bar's
      // HEIGHT already says how much, so tinting by amount as well would encode
      // it twice and leave nothing for the selection to say. Here colour carries
      // emphasis only - the deepest step for the selected bar, the one below it
      // for the rest, which is the same pairing the calendar uses for its
      // selected cell against a busy one. It needs no ring on top: --primary and
      // --cal-3 are the same colour in light mode, so one would have been dead
      // weight there and a faint inconsistency in dark.
      return `
        <path d="${barPath(x, y, barW, h, 4)}" fill="${selected ? 'var(--cal-3)' : 'var(--cal-2)'}"></path>
        ${label}
        <text x="${cx.toFixed(1)}" y="${H - 26}" text-anchor="middle" font-size="12.5"
              fill="${selected ? 'var(--viz-ink)' : 'var(--viz-muted)'}"
              font-weight="${selected ? '700' : '500'}">${line1}</text>
        <text x="${cx.toFixed(1)}" y="${H - 10}" text-anchor="middle" font-size="12.5"
              fill="${selected ? 'var(--viz-ink)' : 'var(--viz-muted)'}"
              font-weight="${selected ? '700' : isNow ? '650' : '400'}">${line2}</text>
        ${isNow ? `<circle cx="${cx.toFixed(1)}" cy="${H - 2}" r="2.6" fill="var(--primary)"></circle>` : ''}
        <rect class="hit" data-period="${s.period}" x="${x - gap / 2}" y="${pad.top}"
              width="${barW + gap}" height="${plotH + pad.bottom}" fill="transparent"
              ${interactive ? 'tabindex="0" role="button"' : ''}></rect>
      `;
    })
    .join('');

  svg.innerHTML =
    `<line x1="${pad.side}" y1="${baseY}" x2="${W - pad.side}" y2="${baseY}" stroke="var(--viz-axis)" stroke-width="1"/>` +
    marks;

  if (!interactive) return svg;

  const byPeriod = {};
  data.series.forEach((s) => (byPeriod[s.period] = s));

  svg.querySelectorAll('.hit').forEach((hit) => {
    const s = byPeriod[hit.dataset.period];
    const cx = Number(hit.getAttribute('x')) + Number(hit.getAttribute('width')) / 2;
    const show = () => showPeriodTip(s, data, cx / W);
    hit.addEventListener('pointerenter', show);
    hit.addEventListener('focus', show);
    hit.addEventListener('pointerleave', hidePeriodTip);
    hit.addEventListener('blur', hidePeriodTip);
    const select = () => {
      compare.period = s.period;
      hidePeriodTip();
      renderCompare();
    };
    hit.addEventListener('click', () => {
      // Suppress the tap that a horizontal swipe would otherwise synthesise.
      if (Date.now() - lastChartSwipeAt < 400) return;
      select();
    });
    hit.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        select();
      }
    });
  });
  return svg;
}

function renderPeriodChart(data) {
  const g = data.granularity;
  const latest = Store.periodOf(todayStr(), g);
  const span = SPAN[g];
  fillPager(el('chartPager'), (offset) => {
    if (offset === 0) return buildChartSvg(data, true);
    // A whole window away, matching where a swipe actually lands - a neighbour
    // showing the next single day would be a preview of somewhere else.
    let anchor = Store.shiftPeriod(compare.anchor, g, offset * span);
    if (offset > 0 && anchor > latest) {
      if (compare.anchor >= latest) return null;
      anchor = latest;
    }
    return buildChartSvg(Store.getComparison({
      granularity: g,
      period: anchor,
      endPeriod: anchor,
      categoryId: compare.categoryId,
      span,
    }), false);
  });
}

function showPeriodTip(s, data, fraction) {
  const tip = el('periodTip');
  tip.innerHTML = '';
  // Value leads, label follows - the reader already knows which bar they are on.
  const value = document.createElement('strong');
  value.className = 'tip-value';
  // An empty period says so, rather than presenting a hollow "0.00" as data.
  value.textContent = s.totalMinor > 0 ? formatMoney(s.totalMinor) : 'Nothing spent';
  const label = document.createElement('span');
  label.className = 'tip-label';
  label.textContent = periodLabel(s.period, data.granularity);
  tip.append(value, label);
  tip.style.left = `${Math.min(Math.max(fraction * 100, 16), 84)}%`;
  tip.classList.remove('hidden');
}

function hidePeriodTip() {
  el('periodTip').classList.add('hidden');
}

/**
 * Where the money went in the selected period: one row per category, its share
 * of the total, and the amount.
 *
 * This replaced a dumbbell plot of "last period vs this period". On a month or
 * a year that comparison was informative; on a single day - which is where the
 * screen opens - it was noise. "Food & Drink, down 50" reads as a finding, when
 * all it means is that yesterday happened to include a tea and today did not.
 * A share of the total says something true at every zoom level.
 */
function renderCategoryCompare(data) {
  const box = el('categoryCompare');
  box.innerHTML = '';
  el('cmpShareNote').textContent = '';

  // The dumbbell needed both periods; a share needs only this one, so rows that
  // are empty now are simply absent rather than sitting at zero.
  const rows = data.categories.filter((c) => c.currentMinor > 0);

  if (!rows.length) {
    box.innerHTML = '<p class="empty-msg">Nothing logged in this period.</p>';
    return;
  }

  el('cmpShareNote').textContent = `${rows.length} ${rows.length === 1 ? 'category' : 'categories'}`;
  const total = rows.reduce((sum, c) => sum + c.currentMinor, 0) || 1;

  rows.forEach((c) => {
    const pct = (c.currentMinor / total) * 100;

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'cmp-row';
    row.setAttribute('style', tintVars(c));
    if (data.categoryId === c.id) row.classList.add('focused');
    else if (data.categoryId) row.classList.add('dimmed');
    row.setAttribute('aria-pressed', String(data.categoryId === c.id));

    const head = document.createElement('span');
    head.className = 'cmp-head';
    const icon = document.createElement('span');
    icon.className = 'row-icon';
    icon.textContent = c.icon;
    const name = document.createElement('span');
    name.className = 'cmp-name';
    name.textContent = c.label;
    const amount = document.createElement('span');
    amount.className = 'row-amount';
    amount.textContent = formatMoney(c.currentMinor, { compact: true });
    head.append(icon, name, amount);

    const track = document.createElement('span');
    track.className = 'share-track';
    const fill = document.createElement('span');
    fill.className = 'share-fill';
    fill.style.width = `${Math.max(pct, 2)}%`;
    track.appendChild(fill);

    const foot = document.createElement('span');
    foot.className = 'cmp-foot';
    const share = document.createElement('span');
    share.className = 'cmp-share';
    // Rounded, but never to 0% - a category that is present should not read as
    // absent just because it is small.
    share.textContent = `${Math.max(Math.round(pct), 1)}% of the total`;
    foot.appendChild(share);

    row.append(head, track, foot);
    row.addEventListener('click', () => {
      compare.categoryId = compare.categoryId === c.id ? null : c.id;
      el('focusCategory').value = compare.categoryId || '';
      renderCompare();
    });
    box.appendChild(row);
  });
}

/**
 * The plain log behind the figures, for the selected period. It is the same row
 * as the Today screen - same look, same swipe to edit or delete - because it is
 * the same thing, just reached by picking a date on the chart instead of by
 * stepping through days.
 */
function renderEntries(data) {
  const box = el('cmpEntries');
  box.innerHTML = '';

  const focus = data.categoryId ? categoryMeta(data.categoryId) : null;
  el('entriesHead').textContent = focus ? `${focus.label} entries` : 'Entries';
  el('cmpEntryCount').textContent = data.entries.length
    ? `${data.entries.length} ${data.entries.length === 1 ? 'entry' : 'entries'}`
    : '';

  if (!data.entries.length) {
    box.innerHTML = `<p class="empty-msg">Nothing logged ${periodPhrase(data.period, data.granularity)}.</p>`;
    return;
  }

  // A single day needs no date headings; anything wider does, or the rows are
  // just a pile of amounts with no way to tell which day each belongs to.
  let lastDate = data.granularity === 'day' ? data.period : null;
  data.entries.forEach((e) => {
    if (e.date !== lastDate) {
      lastDate = e.date;
      const head = document.createElement('p');
      head.className = 'entry-day';
      head.textContent = formatDayTitle(e.date);
      box.appendChild(head);
    }
    box.appendChild(buildExpenseRow(e));
  });
}

function buildTable(headers, rows) {
  const table = document.createElement('table');
  table.className = 'data-table';
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  headers.forEach((h, i) => {
    const th = document.createElement('th');
    th.textContent = h;
    if (i > 0) th.className = 'num';
    hr.appendChild(th);
  });
  thead.appendChild(hr);
  const tbody = document.createElement('tbody');
  rows.forEach((cells) => {
    const tr = document.createElement('tr');
    cells.forEach((cell, i) => {
      const td = document.createElement('td');
      td.textContent = cell;
      if (i > 0) td.className = 'num';
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.append(thead, tbody);
  return table;
}

// The WCAG-clean twin of both charts: every plotted value readable as text.
function renderTableView(data) {
  el('tableHead').classList.toggle('hidden', !compare.showTable);
  const box = el('tableView');
  box.classList.toggle('hidden', !compare.showTable);
  el('tableToggle').textContent = compare.showTable ? 'Hide table' : 'Show table';
  el('tableToggle').setAttribute('aria-expanded', String(compare.showTable));
  if (!compare.showTable) return;

  box.innerHTML = '';
  const unit = UNIT_NAME[data.granularity];
  const periodCaption = document.createElement('p');
  periodCaption.className = 'table-caption';
  periodCaption.textContent = `${unit} by ${unit.toLowerCase()}`;
  box.append(
    periodCaption,
    buildTable(
      [unit, 'Spent'],
      data.series.map((s) => [periodLabel(s.period, data.granularity), formatMoney(s.totalMinor)])
    )
  );

  // Mirrors the breakdown above rather than the old before/after comparison, so
  // the table is a readable twin of what is on screen and not a second, subtly
  // different story.
  const shown = data.categories.filter((c) => c.currentMinor > 0);
  const catTotal = shown.reduce((sum, c) => sum + c.currentMinor, 0) || 1;
  const catCaption = document.createElement('p');
  catCaption.className = 'table-caption';
  catCaption.textContent = `Where it went · ${periodLabel(data.period, data.granularity, 'short')}`;
  box.append(
    catCaption,
    buildTable(
      ['Category', 'Spent', 'Share'],
      shown.map((c) => [
        c.label,
        formatMoney(c.currentMinor),
        `${Math.max(Math.round((c.currentMinor / catTotal) * 100), 1)}%`,
      ])
    )
  );

  const entryCaption = document.createElement('p');
  entryCaption.className = 'table-caption';
  entryCaption.textContent = 'Every entry';
  box.append(
    entryCaption,
    buildTable(
      ['When', 'What', 'Amount'],
      data.entries.map((e) => {
        const meta = categoryMeta(e.category);
        return [formatDayTitle(e.date), e.note || meta.label, formatMoney(e.amountMinor)];
      })
    )
  );
}

// Rebuilt on every render so categories added or retired in Settings show up
// here without a reload; the current focus survives unless it no longer exists.
function populateFocusSelect() {
  const select = el('focusCategory');
  const wanted = compare.categoryId || '';
  select.innerHTML = '';
  const all = document.createElement('option');
  all.value = '';
  all.textContent = 'All categories';
  select.appendChild(all);
  Store.getCategoriesForDisplay().forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = `${c.icon} ${c.label}`;
    select.appendChild(opt);
  });
  select.value = wanted;
  if (select.value !== wanted) {
    compare.categoryId = null;
    select.value = '';
  }
}

/**
 * The same gesture, arriving as a wheel event.
 *
 * A two-finger swipe on a trackpad is not a drag - the pointer never moves, so
 * none of the touch or pointer handling above ever runs. The browser reads it
 * as horizontal scrolling and, finding nothing to scroll, hands it to its own
 * back/forward navigation, which slides the entire page sideways. That is why
 * the gesture appeared to move the whole app instead of the chart.
 *
 * Claiming the event fixes both halves: the page stops sliding, and the chart
 * scrolls the way it does under a finger.
 */
let wheelDx = 0;
let wheelIdle = null;
let wheelSpent = false;
function onWheelGesture(e, step) {
  // A mostly-vertical wheel is the page being scrolled; leave it alone.
  if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
  e.preventDefault();

  // A flick arrives as a burst of small deltas, and a trackpad keeps sending
  // them after the fingers lift. The burst is over only once they stop coming.
  clearTimeout(wheelIdle);
  wheelIdle = setTimeout(() => { wheelDx = 0; wheelSpent = false; }, 240);

  // One gesture moves one step, however hard it was thrown. Letting the distance
  // decide would hand control to the momentum tail, which can run for a second
  // after the fingers are gone and would scroll off into last year.
  if (wheelSpent) return;

  wheelDx += e.deltaX;
  if (Math.abs(wheelDx) < 60) return;

  // Positive deltaX means the content is being pushed left, uncovering what
  // lies to the right - later periods. Same mapping as dragging with a finger.
  wheelSpent = true;
  lastChartSwipeAt = Date.now();
  hidePeriodTip();
  step(wheelDx > 0 ? 1 : -1);
  wheelDx = 0;
}

function initCompareControls() {
  const select = el('focusCategory');
  select.addEventListener('change', () => {
    compare.categoryId = select.value || null;
    renderCompare();
  });

  el('granularityToggle').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-gran]');
    if (!btn || btn.dataset.gran === compare.granularity) return;
    // Carry the selection across the switch via a date inside it, rather than
    // resetting to today - zooming out from 3 March should land on March.
    const date = representativeDate(compare.period, compare.granularity);
    compare.granularity = btn.dataset.gran;
    compare.period = Store.periodOf(date, compare.granularity);
    compare.anchor = compare.period;
    el('granularityToggle')
      .querySelectorAll('button')
      .forEach((b) => b.classList.toggle('active', b === btn));
    renderCompare();
  });

  el('dayViewToggle').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-view]');
    if (!btn) return;
    Store.setSettings({ dayView: btn.dataset.view });
    renderCompare();
  });

  el('calPrev').addEventListener('click', () => moveCalendarMonth(-1));
  el('calNext').addEventListener('click', () => moveCalendarMonth(1));

  el('prevPeriod').addEventListener('click', () => movePeriod(-1));
  el('nextPeriod').addEventListener('click', () => movePeriod(1));

  const canMovePeriod = (dir) => dir < 0
    || Store.shiftPeriod(compare.anchor, compare.granularity, 1) <= Store.periodOf(todayStr(), compare.granularity)
    || compare.period < compare.anchor;

  // The chart scrolls by one period; the calendar by a whole month, since a
  // month is what it shows. Both move their own contents rather than the card.
  attachPager(el('chartPager'), {
    step: scrollWindow,
    canStep: canMovePeriod,
    on: document.querySelector('#screen-stats .chart-card'),
  });
  attachPager(el('calPager'), {
    step: moveCalendarMonth,
    canStep: (dir) => dir < 0 || monthOf(compare.period) < monthOf(todayStr()),
    on: el('calendarCard'),
  });

  el('tableToggle').addEventListener('click', () => {
    compare.showTable = !compare.showTable;
    renderCompare();
  });
}

// ---------- Add / edit sheet ----------

function renderChips() {
  const row = el('categoryChips');
  row.innerHTML = '';
  const visible = Store.getCategories();
  // The remembered category may have been hidden or merged away since last use.
  if (!visible.some((c) => c.id === state.category)) {
    state.category = visible.length ? visible[0].id : 'other';
  }
  visible.forEach((c) => {
    const chip = document.createElement('button');
    chip.className = 'chip' + (c.id === state.category ? ' active' : '');
    chip.innerHTML = `<span>${c.icon}</span><span>${escapeHtml(c.label)}</span>`;
    chip.addEventListener('click', () => {
      state.category = c.id;
      renderChips();
    });
    row.appendChild(chip);
  });
  const active = row.querySelector('.chip.active');
  if (active) active.scrollIntoView({ inline: 'center', block: 'nearest' });
}

function renderAmount() {
  el('amountValue').textContent = state.amount;
  el('amountCurrency').textContent = currencySymbol();
  el('sheetSave').disabled = parseAmountToMinor(state.amount) <= 0;
}

function pressKey(key) {
  if (key === 'back') {
    state.amount = state.amount.length > 1 ? state.amount.slice(0, -1) : '0';
  } else if (key === '.') {
    if (!state.amount.includes('.')) state.amount += '.';
  } else {
    const [, decimals] = state.amount.split('.');
    if (decimals && decimals.length >= 2) return; // currencies stop at 2 places
    if (state.amount.replace('.', '').length >= 9) return;
    state.amount = state.amount === '0' ? key : state.amount + key;
  }
  renderAmount();
}

function openSheet(id = null) {
  state.editingId = id;
  if (id) {
    const e = Store.getExpense(id);
    if (!e) return;
    state.amount = String(e.amountMinor / Store.MINOR_PER_MAJOR);
    state.category = e.category;
    el('noteInput').value = e.note;
    el('sheetSave').textContent = 'Save changes';
    el('sheetDelete').classList.remove('hidden');
  } else {
    state.amount = '0';
    el('noteInput').value = '';
    el('sheetSave').textContent = 'Add expense';
    el('sheetDelete').classList.add('hidden');
  }
  renderChips();
  renderAmount();
  el('sheetBackdrop').classList.remove('hidden');
}

function closeSheet() {
  state.editingId = null;
  // The typed amount has to be cleared HERE, not only when the sheet next
  // opens. Left standing, a second tap on Save books the same amount again -
  // and a phone delivers a second tap readily, because the frame where the
  // sheet is closing still has the button under the finger. That is a
  // duplicate expense from an ordinary impatient tap, and nothing on screen
  // afterwards says which of the two was the mistake.
  state.amount = '0';
  state.editingId = null;
  el('noteInput').value = '';
  el('sheetSave').disabled = true;
  el('sheetBackdrop').classList.add('hidden');
}

function saveSheet() {
  const amountMinor = parseAmountToMinor(state.amount);
  if (amountMinor <= 0) return;
  const payload = {
    date: state.date,
    amountMinor,
    category: state.category,
    note: el('noteInput').value.trim(),
  };
  try {
    if (state.editingId) {
      Store.updateExpense(state.editingId, payload);
      toast('Expense updated');
    } else {
      Store.addExpense(payload);
      toast(`Added ${formatMoney(amountMinor)}`);
    }
    closeSheet();
    renderAll();
    scheduleSync();
  } catch (err) {
    toast(err.message);
  }
}

function deleteFromSheet() {
  if (!state.editingId) return;
  if (!window.confirm('Delete this expense?')) return;
  Store.deleteExpense(state.editingId);
  closeSheet();
  renderAll();
  scheduleSync();
  toast('Expense deleted');
}

// ---------- Category management ----------

let editingCategory = null; // null while adding

function renderCategoryManager() {
  const box = el('categoryManager');
  box.innerHTML = '';
  const cats = Store.getCategories({ includeHidden: true });

  cats.forEach((c, i) => {
    const used = Store.categoryUsage(c.id);
    const row = document.createElement('div');
    row.className = 'cat-row';

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'cat-main';
    main.setAttribute('style', tintVars(c));
    const icon = document.createElement('span');
    icon.className = 'row-icon';
    icon.textContent = c.icon;
    const text = document.createElement('span');
    text.className = 'row-body';
    const name = document.createElement('span');
    name.className = 'row-title';
    name.textContent = c.label;
    const meta = document.createElement('span');
    meta.className = 'row-sub';
    meta.textContent =
      [used ? `${used} ${used === 1 ? 'expense' : 'expenses'}` : 'Unused', c.hidden ? 'Hidden' : '']
        .filter(Boolean)
        .join(' · ');
    text.append(name, meta);
    main.append(icon, text);
    main.addEventListener('click', () => openCategoryEditor(c));

    const moves = document.createElement('span');
    moves.className = 'cat-moves';
    [['▲', -1, i === 0], ['▼', 1, i === cats.length - 1]].forEach(([glyph, delta, disabled]) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cat-move';
      btn.textContent = glyph;
      btn.disabled = disabled;
      btn.setAttribute('aria-label', delta < 0 ? `Move ${c.label} up` : `Move ${c.label} down`);
      btn.addEventListener('click', () => {
        Store.moveCategory(c.id, delta);
        renderCategoryManager();
        renderChips();
      });
      moves.appendChild(btn);
    });

    row.append(main, moves);
    box.appendChild(row);
  });

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'cat-add';
  add.textContent = '+ Add category';
  add.addEventListener('click', () => openCategoryEditor(null));
  box.appendChild(add);
}

function openCategoryEditor(category) {
  editingCategory = category;
  const adding = !category;
  el('catTitle').textContent = adding ? 'New category' : 'Edit category';
  el('catIcon').value = adding ? '🏷️' : category.icon;
  el('catName').value = adding ? '' : category.label;
  el('catSave').textContent = adding ? 'Add category' : 'Save';

  const used = adding ? 0 : Store.categoryUsage(category.id);
  el('catHiddenField').classList.toggle('hidden', adding);
  el('catHidden').checked = adding ? false : Boolean(category.hidden);
  el('catUsage').textContent = adding
    ? 'The name and icon can be changed later at any time.'
    : used
      ? `Used by ${used} ${used === 1 ? 'expense' : 'expenses'}. Renaming is safe — past expenses follow the new name.`
      : 'Not used by any expense yet.';

  renderCategoryDanger(category, used);
  el('catBackdrop').classList.remove('hidden');
  if (adding) el('catName').focus();
}

// Deleting a category that has expenses would orphan them, so that path is
// closed: an unused category can be deleted outright, a used one can only be
// merged into another (which moves its expenses first).
function renderCategoryDanger(category, used) {
  const box = el('catDanger');
  box.innerHTML = '';
  if (!category) return;

  if (!used) {
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn-danger';
    del.textContent = 'Delete category';
    del.addEventListener('click', () => {
      if (!window.confirm(`Delete "${category.label}"?`)) return;
      try {
        Store.removeCategory(category.id);
        closeCategoryEditor();
        afterCategoryChange('Category deleted');
      } catch (err) {
        toast(err.message);
      }
    });
    box.appendChild(del);
    return;
  }

  const others = Store.getCategories({ includeHidden: true }).filter((c) => c.id !== category.id);
  if (!others.length) return;

  const wrap = document.createElement('div');
  wrap.className = 'merge-box';
  const label = document.createElement('p');
  label.className = 'hint';
  label.textContent = `To retire this category, merge its ${used} ${used === 1 ? 'expense' : 'expenses'} into another one. Hiding it instead keeps the history exactly as it is.`;
  const select = document.createElement('select');
  select.className = 'merge-select';
  others.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = `${c.icon} ${c.label}`;
    select.appendChild(opt);
  });
  const go = document.createElement('button');
  go.type = 'button';
  go.className = 'btn-danger';
  go.textContent = 'Merge and delete';
  go.addEventListener('click', () => {
    const target = others.find((c) => c.id === select.value);
    if (!target) return;
    if (!window.confirm(`Move ${used} ${used === 1 ? 'expense' : 'expenses'} from "${category.label}" into "${target.label}", then delete "${category.label}"?`)) return;
    try {
      const { moved } = Store.mergeCategory(category.id, target.id);
      closeCategoryEditor();
      afterCategoryChange(`Moved ${moved} into ${target.label}`);
    } catch (err) {
      toast(err.message);
    }
  });
  wrap.append(label, select, go);
  box.appendChild(wrap);
}

function closeCategoryEditor() {
  editingCategory = null;
  el('catBackdrop').classList.add('hidden');
}

function saveCategoryEditor() {
  const label = el('catName').value.trim();
  const icon = el('catIcon').value.trim();
  if (!label) {
    toast('Give the category a name.');
    return;
  }
  try {
    if (editingCategory) {
      Store.updateCategory(editingCategory.id, { label, icon, hidden: el('catHidden').checked });
      closeCategoryEditor();
      afterCategoryChange('Category saved');
    } else {
      Store.addCategory({ label, icon });
      closeCategoryEditor();
      afterCategoryChange('Category added');
    }
  } catch (err) {
    toast(err.message);
  }
}

// Categories feed the picker, the compare screen and every breakdown, so a
// change has to refresh all of them.
function afterCategoryChange(message) {
  renderCategoryManager();
  renderChips();
  renderAll();
  toast(message);
}

// ---------- Settings ----------

// ---------- Appearance ----------

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

// The status bar behind a home-screen app is painted from this, so it has to
// follow the theme too - otherwise a dark app sits under a pale strip. These are
// --bg exactly: near-misses show up as a band of a slightly different colour
// above the page, which is worse than no attempt at all. index.html carries the
// same two values in a media pair, which is what iOS actually reads on launch;
// this keeps a live toggle honest for browsers that do re-read the tag.
const THEME_COLOR = { light: '#f2f2f7', dark: '#000000' };

/**
 * Resolve the stored choice to an actual scheme and stamp it on <html>.
 *
 * 'system' is resolved here rather than left to the stylesheet: with the choice
 * expressed as an attribute, one CSS block covers dark and nothing has to be
 * written twice for "dark by preference" and "dark by choice". The same
 * resolution runs inline in index.html before the first paint - this is what
 * keeps it right afterwards.
 */
function applyTheme() {
  const choice = Store.getSettings().theme;
  const dark = choice === 'dark' || (choice !== 'light' && darkQuery.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  applyStatusBarColor(choice, dark);
}

/**
 * Keep the theme-color pair in step with the choice.
 *
 * The pair in index.html answers "what does the phone prefer", which is exactly
 * right on 'system' and has to be overruled by an explicit Light or Dark. Both
 * states are written out in full rather than toggled, so switching back and
 * forth cannot leave one tag holding the other one's media query.
 */
function applyStatusBarColor(choice, dark) {
  const light = el('tcLight');
  const night = el('tcDark');
  if (!light || !night) return;
  if (choice === 'light' || choice === 'dark') {
    const pinned = THEME_COLOR[dark ? 'dark' : 'light'];
    for (const m of [light, night]) {
      m.setAttribute('content', pinned);
      m.removeAttribute('media');
    }
    return;
  }
  light.setAttribute('content', THEME_COLOR.light);
  light.setAttribute('media', '(prefers-color-scheme: light)');
  night.setAttribute('content', THEME_COLOR.dark);
  night.setAttribute('media', '(prefers-color-scheme: dark)');
}

function renderThemeToggle() {
  const choice = Store.getSettings().theme;
  el('themeToggle')
    .querySelectorAll('button')
    .forEach((b) => {
      const on = b.dataset.themeChoice === choice;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
  el('themeHint').textContent = choice === 'system'
    ? 'Follows your phone, including its light and dark schedule.'
    : `Always ${choice}, whatever the phone is set to.`;
}

function renderSettings() {
  const s = Store.getSettings();
  // Restoring a backup or erasing everything replaces the settings wholesale,
  // and both re-render from here - so this is where a theme that arrived with
  // someone else's data gets applied.
  applyTheme();
  renderThemeToggle();
  el('setCurrency').value = `${s.currency}|${s.locale}`;
  el('setBudget').value = s.monthlyBudgetMinor
    ? String(s.monthlyBudgetMinor / Store.MINOR_PER_MAJOR)
    : '';
  el('setSyncUrl').value = s.syncUrl;
  el('setSyncToken').value = s.syncToken;
  el('setSyncAddToken').value = s.syncAddToken;
  el('buildInfo').textContent = `Version ${APP_VERSION}`;
  renderSyncStatus();
  renderShortcutHelp();
  renderCategoryManager();
}

// An installed app serves itself from its own cache, so a published fix can sit
// unseen behind a stale copy. This asks for a fresh check now, and says what it
// found rather than leaving the reader guessing.
async function checkForUpdate() {
  if (!('serviceWorker' in navigator)) {
    toast('Updates only apply to the installed app');
    return;
  }
  toast('Checking…');
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) {
      toast('Not installed yet — reload the page');
      return;
    }
    await reg.update();
    // A waiting or installing worker means a newer build has been found; the
    // page reloads itself as soon as that worker takes over.
    if (reg.installing || reg.waiting) toast('New version found — updating…');
    else toast(`Version ${APP_VERSION} is the latest`);
  } catch (err) {
    toast('Could not check — are you online?');
  }
}

// The outcome of the last sync, kept on screen rather than only in a toast that
// disappears - checking whether sync worked is the whole reason to look here.
let lastSyncResult = null;

function renderSyncStatus(message) {
  const s = Store.getSettings();
  const box = el('syncStatus');
  if (message) {
    box.textContent = message;
    return;
  }
  if (!Sync.isConfigured()) {
    box.textContent = 'Not connected — expenses stay on this device only.';
    return;
  }
  if (!s.lastSyncAt) {
    box.textContent = 'Connected. Not synced yet — tap “Sync now”.';
    return;
  }
  const when = `Last synced ${new Date(s.lastSyncAt).toLocaleString()}.`;
  if (!lastSyncResult) {
    box.textContent = `Connected. ${when}`;
    return;
  }
  const { pushed, pulled } = lastSyncResult;
  const parts = [];
  if (pushed) parts.push(`sent ${pushed}`);
  if (pulled) parts.push(`brought back ${pulled}`);
  box.textContent = parts.length
    ? `${when} Last sync ${parts.join(' and ')} ${pushed + pulled === 1 ? 'expense' : 'expenses'}.`
    : `${when} Everything was already up to date.`;
}

// Once a sheet is connected the shortcut can post straight to it, which is the
// only way to log without the app opening at all.
function renderShortcutHelp() {
  const s = Store.getSettings();
  const connected = Sync.isConfigured();
  el('shortcutIntro').textContent = connected
    ? 'Your shortcut can write straight to the sheet — nothing opens, nothing flashes up. Tracky picks the expense up next time it syncs.'
    : 'Right now a shortcut has to open Tracky for a moment to save. Connect a Google Sheet above and it can save silently in the background instead.';
  // Prefer the append-only token here: this address goes into a shortcut, and
  // shortcut URLs are the one place the secret is visible.
  el('quickUrl').textContent = connected
    ? `${s.syncUrl}?action=add&token=${s.syncAddToken || s.syncToken}&amount=AMOUNT&category=CATEGORY&note=NOTE`
    : `${location.origin}${location.pathname}?amount=AMOUNT&category=CATEGORY&note=NOTE&save=1`;
  el('shortcutFinalStep').innerHTML = connected
    ? '<strong>Get Contents of URL</strong> — pass it that Text. This runs in the background; nothing appears on screen.'
    : '<strong>Open URLs</strong> — pass it that Text.';
}

async function saveSyncSettings() {
  Store.setSettings({
    syncUrl: el('setSyncUrl').value.trim(),
    syncToken: el('setSyncToken').value.trim(),
    syncAddToken: el('setSyncAddToken').value.trim(),
  });
  renderSyncStatus();
  renderShortcutHelp();
}

/**
 * The two URLs involved here look nothing alike but are easy to confuse: the
 * sheet's own address, which is what you see in the browser, and the Web App
 * address, which only exists once the script has been deployed. Pasting the
 * first fails with a network error that explains nothing, so it is worth naming
 * the mistake.
 */
function syncUrlProblem(url) {
  if (/docs\.google\.com\/spreadsheets/i.test(url)) {
    return 'That is the sheet\u2019s own address. The one you need comes from '
      + 'Apps Script \u2192 Deploy \u2192 New deployment \u2192 Web app, and ends in /exec.';
  }
  if (/script\.google\.com/i.test(url) && !/\/exec\/?$/.test(url)) {
    return /\/dev\/?$/.test(url)
      ? 'That is the test address. Use the deployed one, which ends in /exec.'
      : 'That web app URL should end in /exec.';
  }
  if (!/^https:\/\//i.test(url)) return 'The web app URL should start with https://';
  return '';
}

async function checkSyncConnection() {
  const url = el('setSyncUrl').value.trim();
  const token = el('setSyncToken').value.trim();
  if (!url || !token) {
    renderSyncStatus('Enter both the web app URL and the token first.');
    return;
  }
  const problem = syncUrlProblem(url);
  if (problem) {
    renderSyncStatus(problem);
    return;
  }
  renderSyncStatus('Checking…');
  try {
    const info = await Sync.test(url, token);
    await saveSyncSettings();
    // Naming the sheet and its row count is what makes this a real check rather
    // than a handshake: it proves the script reached the spreadsheet, which is
    // the half that actually goes wrong.
    const where = info.sheet ? ` Reached “${info.sheet}” with ${info.rows === 1 ? '1 expense' : `${info.rows || 0} expenses`} in it.` : '';
    renderSyncStatus(`Connected.${where} Tap “Sync now” to send your expenses across.`);
  } catch (err) {
    renderSyncStatus(err.message);
  }
}

// Local edits are pushed shortly after they settle, rather than on every
// keystroke of an amount being typed.
let syncTimer = null;
function scheduleSync() {
  if (!Sync.isConfigured()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncNow({ silent: true }), 1500);
}

async function syncNow({ silent = false } = {}) {
  if (!Sync.isConfigured()) return;
  if (!silent) renderSyncStatus('Syncing…');
  const result = await Sync.run();
  renderAll();
  if (result.ok) {
    lastSyncResult = result;
    renderSyncStatus();
    if (!silent) toast(`Synced · sent ${result.pushed}, received ${result.pulled}`);
  } else if (!silent) {
    renderSyncStatus(result.error);
    toast('Sync failed');
  }
}

function saveCurrency() {
  const [currency, locale] = el('setCurrency').value.split('|');
  Store.setSettings({ currency, locale });
  renderAll();
  toast('Currency updated');
}

function saveBudget() {
  Store.setSettings({ monthlyBudgetMinor: parseAmountToMinor(el('setBudget').value) });
  renderAll();
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function downloadBackup() {
  downloadFile(
    `tracky-backup-${todayStr()}.json`,
    JSON.stringify(Store.exportData(), null, 2),
    'application/json'
  );
}

function downloadCsv() {
  // The BOM makes Excel read it as UTF-8 rather than mangling the currency sign.
  downloadFile(`tracky-${todayStr()}.csv`, `﻿${Store.exportCsv()}`, 'text/csv;charset=utf-8');
  toast('CSV exported');
}

/**
 * Quick add from a URL such as
 * `?amount=250&category=Food&note=Chai&save=1`, which is what lets an iOS
 * Shortcut (Back Tap, Lock Screen, Siri) log without touching the app.
 *
 * With `save=1` the expense is written straight away and confirmed by name.
 * Without it - or if anything about the request is ambiguous - the keypad
 * opens prefilled instead, so nothing is ever guessed on the user's behalf.
 */
function applyQuickAdd() {
  const params = new URLSearchParams(location.search);
  if (!params.has('amount') && !params.has('add')) return;

  const rawAmount = params.get('amount') || '';
  const rawCategory = (params.get('category') || '').trim().toLowerCase();
  const note = (params.get('note') || '').slice(0, 60);
  const autoSave = params.get('save') === '1';

  // Drop the query immediately so reloading the app cannot replay the entry.
  history.replaceState(null, '', location.pathname);

  const minor = parseAmountToMinor(rawAmount);
  const match = rawCategory
    ? Store.getCategories().find((c) => c.id === rawCategory || c.label.toLowerCase() === rawCategory)
    : null;
  // A category that was asked for but not recognised must not fall back to
  // some default - silently filing it under the wrong heading is worse than
  // asking. That case drops through to the keypad.
  const categoryIsClear = !rawCategory || Boolean(match);

  if (autoSave && minor > 0 && categoryIsClear) {
    const category = match ? match.id : state.category;
    try {
      Store.addExpense({ date: todayStr(), amountMinor: minor, category, note });
      renderAll();
      scheduleSync();
      toast(`Saved ${formatMoney(minor, { compact: true })} · ${categoryMeta(category).label}`);
      return;
    } catch (err) {
      toast(err.message);
    }
  }

  openSheet(null);
  if (minor > 0) {
    state.amount = String(minor / Store.MINOR_PER_MAJOR);
    renderAmount();
  }
  if (match) {
    state.category = match.id;
    renderChips();
  }
  if (note) el('noteInput').value = note;
}

function handleImport(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const count = Array.isArray(parsed.expenses) ? parsed.expenses.length : 0;
      if (!window.confirm(`Restore ${count} expenses?\n\nThis REPLACES everything currently in Tracky.`)) return;
      Store.importData(parsed);
      renderAll();
      renderSettings();
      toast('Backup restored');
    } catch (err) {
      toast(err.message);
    } finally {
      el('importFile').value = '';
    }
  };
  reader.readAsText(file);
}

/* ---------- Importing a CSV from another app ----------
   Three rules shape this screen.

   Nothing is written until the last button. Someone moving five years of
   spending across cannot undo a bad import, so every guess this code makes is
   shown, and every one of them is correctable, before anything is saved.

   It asks only what it cannot work out. The date order, which sign means money
   spent, which column is which - each question appears only when the file is
   genuinely ambiguous about it, because a wizard that asks five questions to
   import an obvious file teaches people to click through without reading.

   It never silently drops a row. Rows it could not read are counted, and can be
   listed with their line numbers. */

const csvImport = { text: '', result: null, dateOrder: null, spendSign: null, catMap: {} };

// Another app's category names, mapped to the ones here. Only the obvious
// synonyms - anything unrecognised is offered to the person to place, since
// guessing wrong is worse than asking.
const CATEGORY_SYNONYMS = {
  food: 'food', foods: 'food', dining: 'food', restaurant: 'food', restaurants: 'food',
  'eating out': 'food', meal: 'food', meals: 'food', 'food drink': 'food', cafe: 'food',
  grocery: 'groceries', groceries: 'groceries', supermarket: 'groceries', market: 'groceries',
  transport: 'transport', transportation: 'transport', travel: 'transport', taxi: 'transport',
  cab: 'transport', fuel: 'transport', petrol: 'transport', gas: 'transport', commute: 'transport',
  bus: 'transport', train: 'transport', auto: 'transport', car: 'transport',
  bill: 'bills', bills: 'bills', utilities: 'bills', utility: 'bills', electricity: 'bills',
  water: 'bills', internet: 'bills', phone: 'bills', mobile: 'bills', recharge: 'bills',
  subscription: 'bills', subscriptions: 'bills', rent: 'home', housing: 'home', home: 'home',
  household: 'home', maintenance: 'home', repairs: 'home',
  health: 'health', medical: 'health', medicine: 'health', doctor: 'health', pharmacy: 'health',
  fitness: 'health', hospital: 'health', insurance: 'health',
  shopping: 'shopping', clothes: 'shopping', clothing: 'shopping', apparel: 'shopping',
  electronics: 'shopping', gifts: 'shopping', gift: 'shopping',
  entertainment: 'fun', fun: 'fun', movies: 'fun', movie: 'fun', games: 'fun', hobby: 'fun',
  leisure: 'fun', sports: 'fun', holiday: 'fun', vacation: 'fun',
  education: 'education', school: 'education', college: 'education', course: 'education',
  books: 'education', tuition: 'education',
  other: 'other', misc: 'other', miscellaneous: 'other', general: 'other', uncategorized: 'other',
  uncategorised: 'other', none: 'other',
};

const csvKey = (label) => String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// A created category sits in a list where every other row has a real icon, so a
// placeholder dot would mark it forever as the one that came from a machine.
// Any word in the name can supply one; anything unrecognised gets a luggage tag,
// which reads as "a category" rather than as "something went wrong".
const CATEGORY_ICONS = {
  pet: '\u{1F43E}', pets: '\u{1F43E}', dog: '\u{1F43E}', cat: '\u{1F43E}',
  coffee: '\u{2615}', tea: '\u{2615}', drinks: '\u{1F37A}', alcohol: '\u{1F37A}',
  baby: '\u{1F37C}', kids: '\u{1F9F8}', children: '\u{1F9F8}', toys: '\u{1F9F8}',
  beauty: '\u{1F484}', salon: '\u{1F487}', haircut: '\u{2702}',
  charity: '\u{1F49D}', donation: '\u{1F49D}', gift: '\u{1F381}', gifts: '\u{1F381}',
  travel: '\u{2708}', flight: '\u{2708}', hotel: '\u{1F3E8}', holiday: '\u{1F3D6}',
  fuel: '\u{26FD}', petrol: '\u{26FD}', parking: '\u{1F17F}', car: '\u{1F697}',
  laundry: '\u{1F9FA}', cleaning: '\u{1F9F9}', furniture: '\u{1F6CB}',
  savings: '\u{1F3E6}', investment: '\u{1F4C8}', loan: '\u{1F3E6}', emi: '\u{1F3E6}',
  tax: '\u{1F4C4}', taxes: '\u{1F4C4}', fees: '\u{1F4C4}', fee: '\u{1F4C4}',
  work: '\u{1F4BC}', office: '\u{1F4BC}', business: '\u{1F4BC}',
  pharmacy: '\u{1F48A}', gym: '\u{1F3CB}', fitness: '\u{1F3CB}', sports: '\u{26BD}',
  music: '\u{1F3B5}', books: '\u{1F4DA}', clothes: '\u{1F455}', shoes: '\u{1F45F}',
  phone: '\u{1F4F1}', internet: '\u{1F310}', electricity: '\u{1F4A1}', water: '\u{1F6BF}',
};
const NEW_CATEGORY_ICON = '\u{1F3F7}';

function iconForNewCategory(label) {
  for (const word of csvKey(label).split(' ')) {
    if (CATEGORY_ICONS[word]) return CATEGORY_ICONS[word];
  }
  return NEW_CATEGORY_ICON;
}

// Always with the year: the whole point of this line is the span the file
// covers, and "14 Aug" hides whether that is this year or five years ago.
const spanDate = (iso) => fmtUTC(parseUTC(iso), { day: 'numeric', month: 'short', year: 'numeric' });

// Same name, a known synonym, or nothing - in that order.
function guessCategory(label) {
  const key = csvKey(label);
  if (!key) return 'other';
  const own = Store.getCategories({ includeHidden: true });
  const exact = own.find((c) => csvKey(c.label) === key || c.id === key.replace(/ /g, '-'));
  if (exact) return exact.id;
  const mapped = CATEGORY_SYNONYMS[key];
  if (mapped && own.some((c) => c.id === mapped)) return mapped;
  return '';   // empty means "make one with this name"
}

function startCsvImport(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    csvImport.text = String(reader.result || '');
    csvImport.dateOrder = null;
    csvImport.spendSign = null;
    csvImport.catMap = {};
    readCsv();
    el('csvFile').value = '';
  };
  reader.onerror = () => toast('Could not read that file');
  reader.readAsText(file);
}

function readCsv(columns) {
  const opts = {};
  if (csvImport.dateOrder) opts.dateOrder = csvImport.dateOrder;
  if (columns) opts.columns = columns;
  else if (csvImport.result && csvImport.result.columns) opts.columns = csvImport.result.columns;
  csvImport.result = Csv.read(csvImport.text, opts);
  // A fresh read means fresh categories to place; keep any the person already
  // set, since re-reading after a date-order answer must not throw their work
  // away.
  for (const label of csvImport.result.categories || []) {
    const k = csvKey(label);
    if (!(k in csvImport.catMap)) csvImport.catMap[k] = guessCategory(label);
  }
  renderCsvReport();
}

// The rows that will actually be saved, after the sign question is settled.
function csvKeepers() {
  const r = csvImport.result;
  if (!r || !r.ok) return [];
  if (!r.mixedSigns) return r.records;
  if (csvImport.spendSign === null) return [];
  return r.records.filter((x) => x.negative === (csvImport.spendSign === 'negative'));
}

function renderCsvReport() {
  const box = el('csvReport');
  const r = csvImport.result;
  if (!r) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;

  const parts = [];
  const opt = (v, label, on) => `<option value="${escapeHtml(v)}"${on ? ' selected' : ''}>${escapeHtml(label)}</option>`;

  if (r.needs === 'dateOrder') {
    parts.push(`<p class="import-ask">Dates in this file look like
      <strong>${escapeHtml(String((r.sample[0] || [])[r.columns.date] || ''))}</strong>.
      Which way round is that?</p>
      <div class="import-choices">
        <button class="btn-secondary" data-order="dmy">Day first &middot; 14/08</button>
        <button class="btn-secondary" data-order="mdy">Month first &middot; 08/14</button>
      </div>`);
    box.innerHTML = parts.join('');
    return;
  }

  // Which column is which. Always shown once a file is loaded, because a wrong
  // guess here is the difference between importing someone's history and
  // importing nonsense, and it is invisible unless it is on the screen.
  if (r.header) {
    const pick = (field, allowNone) => {
      const chosen = r.columns[field];
      const opts = (allowNone ? [opt('-1', 'None', chosen === -1)] : [])
        .concat(r.header.map((h, i) => opt(String(i), h || `Column ${i + 1}`, chosen === i)));
      return `<label class="import-map"><span>${field[0].toUpperCase() + field.slice(1)}</span>
        <select data-field="${field}">${opts.join('')}</select></label>`;
    };
    parts.push(`<div class="import-maps">${pick('date')}${pick('amount')}${pick('category', true)}${pick('note', true)}</div>`);
  }

  if (!r.ok) {
    parts.push(`<p class="import-bad">${escapeHtml(r.error)} Set them above.</p>`);
    box.innerHTML = parts.join('');
    return;
  }

  if (r.mixedSigns) {
    parts.push(`<p class="import-ask">This file has both minus and plus amounts, so
      it probably holds money coming in as well as going out. Which ones did you
      <strong>spend</strong>?</p>
      <div class="import-choices">
        <button class="btn-secondary${csvImport.spendSign === 'negative' ? ' chosen' : ''}" data-sign="negative">The minus ones</button>
        <button class="btn-secondary${csvImport.spendSign === 'positive' ? ' chosen' : ''}" data-sign="positive">The plus ones</button>
      </div>`);
  }

  const keep = csvKeepers();

  if (r.categories.length && keep.length) {
    const own = Store.getCategories({ includeHidden: true });
    const rows = r.categories.map((label) => {
      const k = csvKey(label);
      const chosen = csvImport.catMap[k];
      const opts = own.map((c) => opt(c.id, c.label, chosen === c.id))
        .concat(opt('', `Create “${label}”`, !chosen));
      return `<label class="import-map"><span>${escapeHtml(label)}</span>
        <select data-cat="${escapeHtml(k)}">${opts.join('')}</select></label>`;
    });
    parts.push(`<p class="import-head">Their categories, as yours</p>
      <div class="import-maps">${rows.join('')}</div>`);
  }

  if (keep.length) {
    const dates = keep.map((x) => x.date).sort();
    const total = keep.reduce((n, x) => n + x.amountMinor, 0);
    parts.push(`<p class="import-head">What will be added</p>
      <ul class="import-facts">
        <li><strong>${keep.length}</strong> ${keep.length === 1 ? 'expense' : 'expenses'}</li>
        <li>${escapeHtml(spanDate(dates[0]))} to ${escapeHtml(spanDate(dates[dates.length - 1]))}</li>
        <li>${escapeHtml(formatMoney(total, { compact: true }))} in total</li>
      </ul>`);
  } else if (!r.mixedSigns || csvImport.spendSign !== null) {
    parts.push('<p class="import-bad">Nothing in this file could be read as an expense.</p>');
  }

  if (r.rejects.length) {
    parts.push(`<p class="import-skips">${r.rejects.length}
      ${r.rejects.length === 1 ? 'row' : 'rows'} could not be read and will be left out.
      <button class="import-link" id="csvWhyBtn">Which?</button></p>
      <ul class="import-rejects" id="csvRejects" hidden>${r.rejects.slice(0, 20).map((x) =>
        `<li>Line ${x.line} &mdash; ${escapeHtml(x.why)}</li>`).join('')}${
        r.rejects.length > 20 ? `<li>&hellip; and ${r.rejects.length - 20} more</li>` : ''}</ul>`);
  }

  if (keep.length) {
    parts.push(`<button class="btn-secondary import-go" id="csvGoBtn">Add ${keep.length}
      ${keep.length === 1 ? 'expense' : 'expenses'}</button>`);
  }
  parts.push('<button class="import-link" id="csvCancelBtn">Cancel</button>');
  box.innerHTML = parts.join('');
}

function commitCsvImport() {
  const keep = csvKeepers();
  if (!keep.length) return;

  // Create the categories that were left as "Create ...", once each, before
  // any expense points at one.
  const resolved = {};
  for (const label of csvImport.result.categories) {
    const k = csvKey(label);
    let id = csvImport.catMap[k];
    if (!id) {
      try {
        id = Store.addCategory({ label, icon: iconForNewCategory(label) }).id;
      } catch (err) {
        id = 'other';
      }
      csvImport.catMap[k] = id;
    }
    resolved[k] = id;
  }

  const result = Store.importExpenses(keep.map((x) => ({
    date: x.date,
    amountMinor: x.amountMinor,
    category: resolved[csvKey(x.category)] || 'other',
    note: x.note,
  })));

  csvImport.result = null;
  csvImport.text = '';
  renderCsvReport();
  renderAll();
  renderSettings();
  scheduleSync();
  const extra = result.duplicates
    ? ` · skipped ${result.duplicates} already here`
    : '';
  toast(`Added ${result.added} ${result.added === 1 ? 'expense' : 'expenses'}${extra}`);
}

function clearEverything() {
  if (!window.confirm('Erase every expense and reset settings?\n\nThis cannot be undone.')) return;
  if (!window.confirm('Really erase everything? Download a backup first if you are unsure.')) return;
  Store.clearAll();
  state.date = todayStr();
  syncComparePeriod();
  renderAll();
  renderSettings();
  toast('All data erased');
}

// ---------- Navigation ----------

// Tab order, left to right. The swipe walks this list; the tab bar shows it.
const SCREENS = ['stats', 'today', 'settings'];

function showScreen(name, direction) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
  const next = el(`screen-${name}`);
  next.classList.remove('hidden');
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.screen === name));
  if (name === 'stats') renderCompare();
  if (name === 'settings') renderSettings();

  // Slide in from the side the gesture came from, so the tabs feel like a strip
  // you are moving along rather than three unrelated screens being swapped.
  if (direction) {
    next.classList.remove('slide-from-left', 'slide-from-right');
    // Reading offsetWidth forces the class removal to take effect before the new
    // one is added; without it the animation does not restart on a fast repeat.
    void next.offsetWidth;
    next.classList.add(direction > 0 ? 'slide-from-right' : 'slide-from-left');
  }
}

function currentScreen() {
  const open = [...document.querySelectorAll('.screen')].find((s) => !s.classList.contains('hidden'));
  return open ? open.id.replace('screen-', '') : 'today';
}

function stepScreen(dir) {
  const i = SCREENS.indexOf(currentScreen());
  const next = SCREENS[i + dir];
  if (!next) return;
  closeSwipedRow();
  showScreen(next, dir);
}

function renderAll() {
  closeSwipedRow();
  renderToday();
  if (!el('screen-stats').classList.contains('hidden')) renderCompare();
}

// ---------- Init ----------

// The large title fades out and the compact one in as the content passes under
// the bar, so exactly one of the two is legible at any moment.
function watchScroll() {
  document.querySelectorAll('.screen').forEach((screen) => {
    const area = screen.querySelector('.scroll-area');
    if (!area) return;
    const sync = () => screen.classList.toggle('scrolled', area.scrollTop > 22);
    area.addEventListener('scroll', sync, { passive: true });
    sync();
  });
}

function init() {
  watchScroll();

  // Swipe between tabs, the way a photo feed pages between them. Attached to
  // each screen, but standing down whenever the drag started on something that
  // owns horizontal gestures of its own - the chart, the calendar, the headline
  // cards, an expense row - so the two never fight over one finger.
  document.querySelectorAll('.screen').forEach((screen) => {
    onHorizontalSwipe(screen, {
      owner: false,
      threshold: 55,
      onSwipe: (dir, dx, event) => {
        const from = event && event.target;
        if (from && from.closest && from.closest('[data-swipe-owner]')) return;
        stepScreen(dir);
      },
    });
  });
  // The inline script in index.html has already done this before the first
  // paint. Repeating it here covers the case where storage was unreadable then
  // but is fine now - a migration from the old key, most likely.
  applyTheme();

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => showScreen(tab.dataset.screen));
  });

  el('prevDay').addEventListener('click', () => {
    state.date = shiftDate(state.date, -1);
    syncComparePeriod();
    renderAll();
  });
  el('nextDay').addEventListener('click', () => {
    state.date = shiftDate(state.date, 1);
    syncComparePeriod();
    renderAll();
  });
  el('datePicker').addEventListener('change', (e) => {
    if (!e.target.value) return;
    state.date = e.target.value;
    syncComparePeriod();
    renderAll();
  });

  // Swipe the day card to move between days, and the chart to move between
  // The headline cards used to take a horizontal drag too - days on Today,
  // periods on Compare. Both were given up so that swiping between tabs has
  // somewhere to land: with the hero, the chart AND every row claiming the
  // gesture there was nowhere left on the screen to start one. Exactly two
  // things own a horizontal drag now - the chart/calendar strip, and an expense
  // row - and both are things that visibly move under the finger. Days and
  // periods still step with the arrows beside their titles.
  initCompareControls();

  el('openAdd').addEventListener('click', () => openSheet(null));
  el('sheetCancel').addEventListener('click', closeSheet);
  el('sheetSave').addEventListener('click', saveSheet);
  el('sheetDelete').addEventListener('click', deleteFromSheet);
  el('sheetBackdrop').addEventListener('click', (e) => {
    if (e.target === el('sheetBackdrop')) closeSheet();
  });
  el('keypad').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-key]');
    if (btn) pressKey(btn.dataset.key);
  });

  el('themeToggle').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-theme-choice]');
    if (!btn) return;
    Store.setSettings({ theme: btn.dataset.themeChoice });
    applyTheme();
    renderThemeToggle();
  });
  // Only matters while the choice is "match phone", but the listener is cheap
  // and applyTheme() already knows to ignore the OS when it has been overridden.
  darkQuery.addEventListener('change', applyTheme);

  el('setCurrency').addEventListener('change', saveCurrency);
  el('setBudget').addEventListener('change', saveBudget);
  el('setBudget').addEventListener('blur', saveBudget);
  el('updateBtn').addEventListener('click', checkForUpdate);
  el('exportBtn').addEventListener('click', downloadBackup);
  el('exportCsvBtn').addEventListener('click', downloadCsv);
  el('importBtn').addEventListener('click', () => el('importFile').click());
  el('importFile').addEventListener('change', (e) => handleImport(e.target.files[0]));

  el('csvImportBtn').addEventListener('click', () => el('csvFile').click());
  el('csvFile').addEventListener('change', (e) => startCsvImport(e.target.files[0]));
  // One listener for the whole report, since it is rebuilt on every answer.
  el('csvReport').addEventListener('click', (e) => {
    const order = e.target.closest('[data-order]');
    if (order) { csvImport.dateOrder = order.dataset.order; readCsv(); return; }
    const sign = e.target.closest('[data-sign]');
    if (sign) { csvImport.spendSign = sign.dataset.sign; renderCsvReport(); return; }
    if (e.target.closest('#csvWhyBtn')) { el('csvRejects').hidden = !el('csvRejects').hidden; return; }
    if (e.target.closest('#csvGoBtn')) { commitCsvImport(); return; }
    if (e.target.closest('#csvCancelBtn')) {
      csvImport.result = null;
      csvImport.text = '';
      renderCsvReport();
    }
  });
  el('csvReport').addEventListener('change', (e) => {
    const field = e.target.dataset.field;
    if (field) {
      const columns = { ...csvImport.result.columns, [field]: Number(e.target.value) };
      readCsv(columns);
      return;
    }
    const cat = e.target.dataset.cat;
    if (cat !== undefined) {
      csvImport.catMap[cat] = e.target.value;
      renderCsvReport();
    }
  });
  el('clearBtn').addEventListener('click', clearEverything);

  el('catCancel').addEventListener('click', closeCategoryEditor);
  el('catSave').addEventListener('click', saveCategoryEditor);
  el('catBackdrop').addEventListener('click', (e) => {
    if (e.target === el('catBackdrop')) closeCategoryEditor();
  });
  el('setSyncUrl').addEventListener('change', saveSyncSettings);
  el('setSyncToken').addEventListener('change', saveSyncSettings);
  el('setSyncAddToken').addEventListener('change', saveSyncSettings);
  el('syncTestBtn').addEventListener('click', checkSyncConnection);
  el('syncNowBtn').addEventListener('click', () => syncNow());

  el('copyQuickUrl').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(el('quickUrl').textContent);
      toast('Address copied');
    } catch (err) {
      toast('Copy failed — select the address by hand');
    }
  });

  el('dayList').addEventListener('scroll', closeSwipedRow, { passive: true });
  document.querySelector('#screen-today .scroll-area').addEventListener('scroll', closeSwipedRow, { passive: true });

  document.addEventListener('keydown', (e) => {
    if (!el('catBackdrop').classList.contains('hidden')) {
      if (e.key === 'Escape') closeCategoryEditor();
      return;
    }
    if (el('sheetBackdrop').classList.contains('hidden')) return;
    // While a text field has focus it owns its keystrokes - otherwise typing a
    // note would also drive the keypad and Backspace would eat the amount.
    if (e.target instanceof HTMLInputElement && e.target.type !== 'checkbox') {
      if (e.key === 'Escape') closeSheet();
      return;
    }
    if (e.key === 'Escape') closeSheet();
    else if (e.key === 'Enter') saveSheet();
    else if (e.key === 'Backspace') pressKey('back');
    else if (/^[0-9.]$/.test(e.key)) pressKey(e.key);
  });

  renderToday();
  applyQuickAdd();

  // Pull anything logged elsewhere (another device, or a shortcut writing
  // straight to the sheet) whenever the app is opened or returned to.
  syncNow({ silent: true });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncNow({ silent: true });
  });
}

document.addEventListener('DOMContentLoaded', init);
