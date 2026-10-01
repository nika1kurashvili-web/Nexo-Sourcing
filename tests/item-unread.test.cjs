const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, mocks) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`)(name => mocks[name], module, module.exports);
  return module.exports;
}

test('timestamp comparisons preserve microseconds and equivalent timezone offsets', () => {
  const { hasUnreadUpdate, timestampMicros, parseSeenThrough } = load('lib/item-unread.ts', {});
  assert.equal(hasUnreadUpdate('2026-10-01T12:00:00.123457Z', '2026-10-01T12:00:00.123456Z'), true);
  assert.equal(timestampMicros('2026-10-01T12:00:00.123456Z'), timestampMicros('2026-10-01T16:00:00.123456+04:00'));
  assert.equal(hasUnreadUpdate(null, null), false);
  assert.equal(hasUnreadUpdate('2026-10-01T12:00:00Z', null), true);
  assert.throws(() => parseSeenThrough({ seenThrough: 'invalid' }));
  assert.throws(() => parseSeenThrough({ seenThrough: '2026-10-01T12:00:00Z', supplier_id: 'other' }));
});

test('item acknowledgement is interaction-only, retries failures, and cannot clear newer props', async () => {
  // Persistent React state/ref slots allow rerendering the actual hook without a DOM.
  const slots = []; let cursor = 0; let refreshes = 0; let calls = 0;
  const router = { refresh() { refreshes++; } };
  const { useItemSeen } = load('components/useItemSeen.ts', {
    react: {
      useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = value; }]; },
      useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
      useCallback(fn) { return fn; }
    },
    'next/navigation': { useRouter: () => router }
  });
  const render = version => { cursor = 0; return useItemSeen('/item/seen', version, true); };
  const oldFetch = global.fetch;
  let finish;
  try {
    global.fetch = async (_, init) => { calls++; assert.equal(JSON.parse(init.body).seenThrough, 'first'); return new Promise(resolve => { finish = resolve; }); };
    let state = render('first');
    assert.equal(calls, 0, 'Page mounting/rerendering must not acknowledge');
    const pending = state.markSeen();
    state = render('second');
    finish(new Response(JSON.stringify({ ok: true, seenThrough: 'first' })));
    await pending;
    assert.equal(render('second').unread, true, 'Old response must not hide new update');
    global.fetch = async () => new Response('{}', { status: 500 });
    await render('second').markSeen();
    assert.equal(render('second').unread, true);
    global.fetch = async () => new Response('{}', { status: 409 });
    await render('second').markSeen();
    assert.equal(refreshes, 1);
    assert.equal(render('second').unread, true);
    global.fetch = async () => new Response(JSON.stringify({ ok: true, seenThrough: 'second' }));
    await render('second').markSeen();
    assert.equal(render('second').unread, false);
    assert.equal(render('third').unread, true);
  } finally { global.fetch = oldFetch; }
});
