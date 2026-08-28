/**
 * Reading an expense CSV exported by some other app.
 *
 * Kept apart from both storage and the UI because this is the part that has to
 * cope with files nobody here has seen: another app's column names, another
 * country's date order, another currency's idea of what a decimal point is. It
 * is pure - text in, records out - which is what makes it testable against real
 * exports rather than only against files we wrote ourselves.
 *
 * Nothing here writes anything. The caller decides what to keep.
 */
const Csv = (() => {
  // ---------------------------------------------------------------- parsing

  /**
   * Splits CSV text into rows of cells.
   *
   * Written out by hand rather than split(',') because every real export
   * eventually contains a note with a comma in it, and a naive split silently
   * shifts every column after it - the kind of corruption that looks like data
   * rather than an error.
   */
  function parseRows(text, delimiter) {
    const src = String(text || '').replace(/^﻿/, ''); // strip a BOM
    const d = delimiter || sniffDelimiter(src);
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;

    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (quoted) {
        if (c === '"') {
          // "" inside a quoted field is one literal quote.
          if (src[i + 1] === '"') { cell += '"'; i++; }
          else quoted = false;
        } else {
          cell += c;
        }
        continue;
      }
      if (c === '"') { quoted = true; continue; }
      if (c === d) { row.push(cell); cell = ''; continue; }
      if (c === '\r') continue;                 // CRLF and CR both end a line
      if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
      cell += c;
    }
    row.push(cell);
    rows.push(row);

    // Trailing newline leaves one empty row; so do blank lines mid-file.
    return rows
      .map((r) => r.map((v) => v.trim()))
      .filter((r) => r.some((v) => v !== ''));
  }

  /**
   * Comma, semicolon or tab.
   *
   * Exports from a machine set to a comma-decimal locale use semicolons, and a
   * file like that read as comma-separated parses as one column - which shows
   * up as "no date column found" rather than as the delimiter problem it is.
   */
  function sniffDelimiter(text) {
    const line = String(text).split(/\r?\n/).find((l) => l.trim()) || '';
    let best = ',';
    let bestCount = 0;
    for (const d of [',', ';', '\t', '|']) {
      // Count only outside quotes, so a note full of commas cannot win.
      let count = 0;
      let quoted = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') quoted = !quoted;
        else if (c === d && !quoted) count++;
      }
      if (count > bestCount) { best = d; bestCount = count; }
    }
    return best;
  }

  // ------------------------------------------------------------- the header

  // Names seen across the common expense apps, lowercased. Order matters only
  // in that the first hit wins, so the more specific names come first.
  const HEADER_HINTS = {
    date: ['date', 'transaction date', 'txn date', 'time', 'datetime', 'day', 'when', 'posted'],
    amount: ['amount', 'amount spent', 'value', 'total', 'price', 'cost', 'debit', 'money', 'sum', 'expense'],
    category: ['category', 'categories', 'tag', 'tags', 'type', 'group', 'label'],
    note: ['note', 'notes', 'description', 'memo', 'comment', 'title', 'name', 'merchant', 'payee', 'details', 'remark', 'remarks'],
  };

  function normHeader(h) {
    return String(h || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  /**
   * Guesses which column is which, and says so rather than assuming.
   *
   * An exact header match is taken first and a partial one only after every
   * column has had its chance at an exact match - otherwise a file with both
   * "Date" and "Date created" can have the wrong one claimed by whichever
   * happens to come first.
   */
  function sniffColumns(header) {
    const norm = header.map(normHeader);
    const out = { date: -1, amount: -1, category: -1, note: -1 };
    const taken = new Set();

    for (const pass of ['exact', 'partial']) {
      for (const field of ['date', 'amount', 'category', 'note']) {
        if (out[field] !== -1) continue;
        for (let i = 0; i < norm.length; i++) {
          if (taken.has(i) || !norm[i]) continue;
          const hit = HEADER_HINTS[field].some((h) =>
            pass === 'exact' ? norm[i] === h : norm[i].includes(h));
          if (hit) { out[field] = i; taken.add(i); break; }
        }
      }
    }
    return out;
  }

  // ------------------------------------------------------------- the values

  /**
   * Reads a money value without guessing which mark is the decimal point.
   *
   * "1,234.56" and "1.234,56" are the same amount written by two conventions,
   * and picking wrong is off by a factor of a hundred rather than visibly
   * broken. The rule used here is that the LAST separator is the decimal one
   * when it leaves 1 or 2 digits behind it, and a thousands separator
   * otherwise - which reads both conventions correctly without being told.
   */
  function parseAmount(raw) {
    let s = String(raw == null ? '' : raw).trim();
    if (!s) return null;
    const negative = /^\(.*\)$/.test(s) || s.includes('-');
    s = s.replace(/[()]/g, '');
    // Drop currency symbols, letters (INR, Rs, USD) and spaces.
    s = s.replace(/[^0-9.,-]/g, '').replace(/-/g, '');
    if (!s) return null;

    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    const cut = Math.max(lastDot, lastComma);
    let whole = s;
    let frac = '';
    if (cut !== -1) {
      const after = s.length - cut - 1;
      if (after >= 1 && after <= 2) {         // a decimal point
        whole = s.slice(0, cut);
        frac = s.slice(cut + 1);
      }
    }
    whole = whole.replace(/[.,]/g, '');
    if (!whole && !frac) return null;
    const minor = Math.round(Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2)));
    if (!isFinite(minor)) return null;
    return { minor, negative };
  }

  const MONTHS = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };

  /**
   * Reads a date to YYYY-MM-DD.
   *
   * `order` is 'dmy' or 'mdy' and is consulted ONLY where the value is
   * genuinely ambiguous. 2026-08-14 and "14 Aug 2026" say what they mean; 08/09
   * does not, and no amount of cleverness makes it.
   */
  function parseDate(raw, order) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return null;

    // ISO first, including a timestamp tail.
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return ymd(m[1], m[2], m[3]);

    // A written month is unambiguous whichever side it sits.
    m = s.match(/^(\d{1,2})[\s-]*([a-z]{3,})[\s,-]*(\d{2,4})/i);
    if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) {
      return ymd(year(m[3]), MONTHS[m[2].slice(0, 3).toLowerCase()], m[1]);
    }
    m = s.match(/^([a-z]{3,})[\s-]*(\d{1,2})[\s,-]*(\d{2,4})/i);
    if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) {
      return ymd(year(m[3]), MONTHS[m[1].slice(0, 3).toLowerCase()], m[2]);
    }

    // Two numbers and a year: this is where the order actually matters.
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (m) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      // A value over 12 can only be a day, whatever the file claims.
      if (a > 12) return ymd(year(m[3]), b, a);
      if (b > 12) return ymd(year(m[3]), a, b);
      return order === 'mdy' ? ymd(year(m[3]), a, b) : ymd(year(m[3]), b, a);
    }
    return null;
  }

  function year(y) {
    const n = Number(y);
    if (String(y).length <= 2) return n + (n > 70 ? 1900 : 2000);
    return n;
  }

  function ymd(y, m, d) {
    const Y = Number(y);
    const M = Number(m);
    const D = Number(d);
    if (!Y || M < 1 || M > 12 || D < 1 || D > 31) return null;
    // Reject a day the month does not have, rather than letting Date roll it
    // forward into a silently wrong month.
    const probe = new Date(Date.UTC(Y, M - 1, D));
    if (probe.getUTCMonth() !== M - 1 || probe.getUTCDate() !== D) return null;
    const p = (n) => String(n).padStart(2, '0');
    return `${Y}-${p(M)}-${p(D)}`;
  }

  /**
   * Says whether the file can be read day-first or month-first without the
   * caller having to look, so the question is only ever asked when it is real.
   *
   * Returns 'dmy', 'mdy' or 'ask'.
   */
  function sniffDateOrder(values) {
    let dayFirst = 0;
    let monthFirst = 0;
    let ambiguous = 0;
    for (const v of values) {
      const m = String(v || '').trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
      if (!m) continue;                       // ISO or written-month: no vote
      const a = Number(m[1]);
      const b = Number(m[2]);
      if (a > 12 && b <= 12) dayFirst++;
      else if (b > 12 && a <= 12) monthFirst++;
      else ambiguous++;
    }
    if (dayFirst && !monthFirst) return 'dmy';
    if (monthFirst && !dayFirst) return 'mdy';
    if (!ambiguous) return 'dmy';             // nothing ambiguous to decide
    return 'ask';
  }

  // -------------------------------------------------------------- the whole

  /**
   * Turns a file into a report: what was read, what could not be, and why.
   *
   * Deliberately returns rejects with reasons rather than quietly dropping
   * them. Someone importing five years of spending needs to know that eleven
   * rows did not make it, and which.
   */
  function read(text, options) {
    const opts = options || {};
    const rows = parseRows(text, opts.delimiter);
    if (!rows.length) return { ok: false, error: 'That file is empty.' };

    const header = rows[0];
    const columns = opts.columns || sniffColumns(header);
    const body = rows.slice(1);

    if (columns.date === -1 || columns.amount === -1) {
      return {
        ok: false,
        error: 'Could not find a date column and an amount column.',
        header,
        columns,
        sample: body.slice(0, 5),
      };
    }

    const dateOrder = opts.dateOrder
      || sniffDateOrder(body.map((r) => r[columns.date]));
    if (dateOrder === 'ask') {
      return { ok: false, needs: 'dateOrder', header, columns, sample: body.slice(0, 5) };
    }

    const records = [];
    const rejects = [];
    let positives = 0;
    let negatives = 0;

    body.forEach((r, i) => {
      const line = i + 2;                     // 1-based, plus the header
      const date = parseDate(r[columns.date], dateOrder);
      const amount = parseAmount(r[columns.amount]);
      if (!date) { rejects.push({ line, why: 'no date I could read', cells: r }); return; }
      if (!amount || amount.minor === 0) {
        rejects.push({ line, why: 'no amount I could read', cells: r });
        return;
      }
      if (amount.negative) negatives++; else positives++;
      records.push({
        line,
        date,
        amountMinor: amount.minor,
        negative: amount.negative,
        category: columns.category === -1 ? '' : String(r[columns.category] || '').trim(),
        note: columns.note === -1 ? '' : String(r[columns.note] || '').trim(),
      });
    });

    return {
      ok: true,
      header,
      columns,
      dateOrder,
      records,
      rejects,
      // Both signs present means the file probably holds income as well as
      // spending, and only the person who exported it knows which is which.
      mixedSigns: positives > 0 && negatives > 0,
      categories: distinct(records.map((r) => r.category).filter(Boolean)),
    };
  }

  function distinct(list) {
    const seen = new Set();
    const out = [];
    for (const v of list) {
      const k = v.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(v);
    }
    return out.sort((a, b) => a.localeCompare(b));
  }

  return { parseRows, sniffDelimiter, sniffColumns, parseAmount, parseDate, sniffDateOrder, read };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Csv;
