const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const source = ts.transpileModule(fs.readFileSync('lib/request-dates.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const loaded = { exports: {} };
vm.runInThisContext(`(function(module,exports){${source}\n})`)(loaded, loaded.exports);
const { parseDeadlineInput, deadlineInputValue, deadlineState, formatRequestDate } = loaded.exports;

test('deadline input round-trips Tbilisi time independently of server timezone', () => {
  assert.equal(parseDeadlineInput('2026-10-05T18:42'), '2026-10-05T14:42:00.000Z');
  assert.equal(deadlineInputValue('2026-10-05T14:42:00Z'), '2026-10-05T18:42');
  assert.equal(parseDeadlineInput('2026-10-05T00:15'), '2026-10-04T20:15:00.000Z');
  assert.match(formatRequestDate('2026-09-30T14:42:00Z', true), /Sep 30, 2026.*6:42 PM/);
});

test('optional deadlines clear to null and invalid dates are rejected', () => {
  assert.equal(parseDeadlineInput(''), null);
  assert.equal(parseDeadlineInput(null), null);
  assert.equal(deadlineInputValue(null), '');
  assert.equal(formatRequestDate(null), 'Not set');
  for (const value of ['not a date','2026-02-30T12:00','2026-13-01T12:00','2026-09-30T24:00','2026-09-30T12:60','2026-10-05T12:00Z','2026-10-05T12:00+04:00']) {
    assert.throws(() => parseDeadlineInput(value), /valid deadline/, value);
  }
  assert.equal(parseDeadlineInput('2028-02-29T12:00'), '2028-02-29T08:00:00.000Z');
});

test('deadline badges respect exact time, local midnight and closed statuses', () => {
  const now = new Date('2026-09-30T20:30:00Z'); // Oct 1, 00:30 in Tbilisi
  assert.equal(deadlineState('2026-10-01T08:00:00Z', 'new', now), 'today');
  assert.equal(deadlineState('2026-09-30T21:00:00Z', 'new', now), 'today');
  assert.equal(deadlineState('2026-09-30T20:29:00Z', 'new', now), 'overdue');
  assert.equal(deadlineState('2026-10-01T20:01:00Z', 'new', now), null);
  for (const status of ['approved','rejected','cancelled']) {
    assert.equal(deadlineState('2026-09-29T08:00:00Z', status, now), null);
    assert.equal(deadlineState('2026-10-01T08:00:00Z', status, now), null);
  }
  assert.equal(deadlineState(null, 'new', now), null);
  assert.equal(deadlineState('bad date', 'new', now), null);
});
