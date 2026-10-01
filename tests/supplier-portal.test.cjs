const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { PGlite } = require('@electric-sql/pglite');
// Match PostgREST's ISO strings without losing PostgreSQL microseconds.
const dateParsers = { parsers: { 1184: value => value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00') } };

// Run the actual TypeScript server modules against PostgreSQL, with only the
// Supabase HTTP transport and Storage replaced. No production credentials/data.
let transport;
let staffAccess = true;
const modules = new Map();
function load(relative) {
  const file = path.resolve(relative);
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} }; modules.set(file, module);
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const localRequire = name => {
    if (name === 'server-only' || name === 'next/cache') return { revalidatePath() {} };
    if (name === 'next/navigation') return { redirect: location => { throw Object.assign(new Error('redirect'), { location }); } };
    if (name === '@/lib/supabase/server') return { createClient: async () => transport };
    if (name === '@/lib/supabase/admin') return { createAdminClient: () => transport };
    if (name === '@/lib/auth') return { requireSourcingAccess: async () => {
      if (!staffAccess) throw new Error('Access denied');
      return { supabase: transport, user: { id: ids.user } };
    } };
    if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
    return require(name);
  };
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename: file })(localRequire, module, module.exports);
  return module.exports;
}

function adapter(pg) {
  return {
    from(table) {
      let columns = '*', filters = [], values = [], sort = '', maximum = '', update, insert;
      let singular = false, strict = false;
      const add = (column, op, value) => { values.push(value); filters.push(`"${column}" ${op} $${values.length}`); };
      const builder = {
        select(value) { columns = value; return this; },
        eq(column, value) { add(column, '=', value); return this; },
        lte(column, value) { add(column, '<=', value); return this; },
        is(column, value) { assert.equal(value, null); filters.push(`"${column}" is null`); return this; },
        in(column, value) { add(column, '= any', value); filters[filters.length - 1] = `"${column}" = any($${values.length}::uuid[])`; return this; },
        order(column) { sort = ` order by "${column}"`; return this; },
        update(value) { update = value; return this; },
        insert(value) { insert = value; return this; },
        limit(value) { maximum = ` limit ${Number(value)}`; return this; },
        maybeSingle() { singular = true; return this; },
        single() { singular = true; strict = true; return this; },
        async then(resolve, reject) {
          try {
            const where = filters.length ? ` where ${filters.join(' and ')}` : '';
            let sql;
            if (insert) {
              const keys = Object.keys(insert);
              values = Object.values(insert);
              sql = `insert into public."${table}" (${keys.map(key => `"${key}"`).join(',')}) values (${values.map((_, i) => `$${i + 1}`).join(',')}) returning ${columns}`;
            } else if (update) {
              const assignments = Object.entries(update).map(([key, value]) => { values.push(value); return `"${key}"=$${values.length}`; });
              sql = `update public."${table}" set ${assignments.join(',')}${where} returning ${columns}`;
            } else sql = `select ${columns} from public."${table}"${where}${sort}${maximum}`;
            const { rows } = await pg.query(sql, values, dateParsers);
            if (singular && (rows.length > 1 || (strict && !rows.length))) return resolve({ data: null, error: new Error('Invalid row count') });
            resolve({ data: singular ? rows[0] ?? null : rows, error: null });
          } catch (error) { resolve({ data: null, error }); }
        }
      };
      return builder;
    },
    async rpc(name, params) {
      assert.equal(name, 'sourcing_supplier_mutate');
      try {
        const { rows } = await pg.query('select public.sourcing_supplier_mutate($1,$2,$3,$4) as result', [params.p_hash, params.p_item, params.p_operation, params.p_payload]);
        return { data: rows[0].result, error: null };
      } catch (error) { return { data: null, error }; }
    },
    storage: { from() { throw new Error('Storage must not be touched by unauthorized calls'); } }
  };
}

const ids = {
  user: '00000000-0000-4000-8000-000000000001',
  outsider: '00000000-0000-4000-8000-000000000002',
  request: '00000000-0000-4000-8000-000000000010',
  otherRequest: '00000000-0000-4000-8000-000000000011',
  supplier: '00000000-0000-4000-8000-000000000020',
  otherSupplier: '00000000-0000-4000-8000-000000000021',
  item: '00000000-0000-4000-8000-000000000030',
  otherSupplierItem: '00000000-0000-4000-8000-000000000031',
  otherRequestItem: '00000000-0000-4000-8000-000000000032',
  image: '00000000-0000-4000-8000-000000000040'
};
const token = 'a'.repeat(64);

test('supplier portal security boundaries', async t => {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true),'')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    create table auth.users(id uuid primary key);
    create table public.sourcing_users(user_id uuid primary key references auth.users(id), active boolean);
    create table public.sourcing_requests(id uuid primary key default gen_random_uuid(), request_no text default 'REQ-NEW',
      created_at timestamptz not null default now(), updated_at timestamptz default now(), company_name text,
      company_id uuid, title text, client_contact text, notes text, created_by uuid, status text default 'new');
    create table public.sourcing_suppliers(id uuid primary key, name text);
    create type supplier_status as enum ('not_sent','sent','waiting','answered','not_found');
    create table public.sourcing_request_items(
      id uuid primary key, request_id uuid references sourcing_requests, supplier_id uuid references sourcing_suppliers,
      item_no integer, product_name text, quantity numeric, unit text, specifications text, image_url text,
      china_price numeric(10,2), currency text, moq numeric, lead_time_days integer, box_length_cm numeric(10,2),
      box_width_cm numeric(10,2), box_height_cm numeric(10,2), weight_kg numeric(10,3), supplier_comment text,
      supplier_status supplier_status, client_price numeric, internal_comment text, client_comment text,
      nexo_changed_at timestamptz, supplier_seen_at timestamptz, supplier_changed_at timestamptz, nexo_seen_at timestamptz
    );
    create table public.sourcing_request_item_images(id uuid primary key default gen_random_uuid(),
      request_item_id uuid references sourcing_request_items(id), object_path text, sort_order integer, created_by uuid);
    create table public.sourcing_activity_log(id uuid default gen_random_uuid(), request_id uuid, request_item_id uuid, user_id uuid not null, action text, details text);
    create table storage.buckets(id text primary key, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    insert into storage.buckets values ('sourcing-files',false,null,null);
    grant all on all tables in schema public to service_role;
    grant select on public.sourcing_users, public.sourcing_request_items to authenticated;
    insert into auth.users values ('${ids.user}'), ('${ids.outsider}');
    insert into sourcing_users values ('${ids.user}',true);
    insert into sourcing_requests(id,request_no,company_name) values ('${ids.request}','REQ-1','SECRET COMPANY'),('${ids.otherRequest}','REQ-2','OTHER COMPANY');
    insert into sourcing_suppliers values ('${ids.supplier}','Supplier A'),('${ids.otherSupplier}','Supplier B');
    insert into sourcing_request_items(id,request_id,supplier_id,item_no,product_name,quantity,unit,specifications,supplier_status,internal_comment,client_comment,client_price)
    values ('${ids.item}','${ids.request}','${ids.supplier}',1,'Kettle',10,'pcs','Steel','not_sent','INTERNAL SECRET','CLIENT SECRET',999),
    ('${ids.otherSupplierItem}','${ids.request}','${ids.otherSupplier}',2,'Other supplier product',1,'pcs','Private','sent','INTERNAL SECRET','CLIENT SECRET',999),
    ('${ids.otherRequestItem}','${ids.otherRequest}','${ids.supplier}',1,'Other request product',1,'pcs','Private','sent','INTERNAL SECRET','CLIENT SECRET',999);
  `);
  await pg.exec(fs.readFileSync('supabase/migrations/20260930_supplier_portal.sql', 'utf8'));
  await pg.exec(fs.readFileSync('supabase/migrations/20261001_item_unread.sql', 'utf8'));
  const existingCreated = (await pg.query('select created_at from sourcing_requests where id=$1', [ids.request])).rows[0].created_at;
  const deadlineMigration = fs.readFileSync('supabase/migrations/20260930_request_deadlines.sql', 'utf8');
  await pg.exec(deadlineMigration);
  await pg.exec(deadlineMigration); // Safe to re-run without changing existing data.
  assert.deepEqual((await pg.query('select created_at, deadline_at from sourcing_requests where id=$1', [ids.request])).rows[0], { created_at: existingCreated, deadline_at: null });
  await pg.query("update sourcing_requests set deadline_at='2026-12-31T14:00:00Z' where id=$1", [ids.request]);
  transport = adapter(pg);
  const portal = load('lib/supplier-portal.ts');
  const validation = load('lib/supplier-validation.ts');
  const api = load('app/api/supplier/[token]/items/[itemId]/route.ts');
  const imageApi = load('app/api/supplier/[token]/items/[itemId]/images/[imageId]/route.ts');
  const shareActions = load('app/share-link-actions.ts');
  const requestActions = load('app/actions.ts');
  const supplierSeen = load('app/api/supplier/[token]/items/[itemId]/seen/route.ts');
  const nexoSeen = load('app/api/requests/[requestId]/items/[itemId]/seen/route.ts');
  const unread = load('lib/item-unread.ts');
  const versions = async () => (await pg.query('select nexo_changed_at,supplier_seen_at,supplier_changed_at,nexo_seen_at from sourcing_request_items where id=$1', [ids.item], dateParsers)).rows[0];
  const seen = (handler, params, seenThrough) => handler.POST(new Request('https://sourcing.nexo.ge/api/seen', {
    method: 'POST', headers: { origin: 'https://sourcing.nexo.ge', 'content-type': 'application/json' },
    body: JSON.stringify({ seenThrough })
  }), { params: Promise.resolve(params) });
  const insertLink = async (raw, request = ids.request, supplier = ids.supplier, expires = null) => {
    const { rows } = await pg.query(`insert into sourcing_supplier_share_links(request_id,supplier_id,token_hash,created_by,expires_at) values($1,$2,$3,$4,$5) returning id`, [request, supplier, portal.hashToken(raw), ids.user, expires]);
    return rows[0].id;
  };
  const linkId = await insertLink(token);
  const response = Object.fromEntries(validation.RESPONSE_NUMBERS.map(key => [key, '1.25']));
  Object.assign(response, { lead_time_days: '5', currency: 'USD', supplier_status: 'answered', supplier_comment: 'Ready' });
  async function post(itemId, body, raw = token, origin = 'https://sourcing.nexo.ge') {
    return api.POST(new Request(`https://sourcing.nexo.ge/api/supplier/${raw}/items/${itemId}`, {
      method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body)
    }), { params: Promise.resolve({ token: raw, itemId }) });
  }

  await t.test('active link reads only both-scoped items and a safe field projection', async () => {
    const result = await portal.readSupplierPortal(token);
    assert.deepEqual(result.items.map(item => item.id), [ids.item]);
    assert.equal(result.requestNo, 'REQ-1');
    const serialized = JSON.stringify(result);
    for (const forbidden of ['client_price','client_comment','internal_comment','SECRET','Other supplier product','Other request product','company_name','created_by','token_hash','supplier_changed_at','nexo_seen_at']) assert.ok(!serialized.includes(forbidden), forbidden);
    assert.equal(new Date(result.deadlineAt).toISOString(), '2026-12-31T14:00:00.000Z');
  });
  await t.test('invalid/missing tokens and tampered item IDs reveal nothing', async () => {
    for (const raw of ['', 'bad', 'b'.repeat(64)]) await assert.rejects(portal.readSupplierPortal(raw), /invalid or no longer active/);
    for (const itemId of [ids.otherSupplierItem, ids.otherRequestItem, 'bad-id']) {
      const result = await post(itemId, { operation: 'response', response });
      assert.equal(result.status, 404);
      assert.deepEqual(await result.json(), { error: portal.INVALID_LINK });
      const imageResult = await imageApi.GET(new Request('https://sourcing.nexo.ge'), { params: Promise.resolve({ token, itemId, imageId: 'reference' }) });
      assert.equal(imageResult.status, 404);
    }
  });
  await t.test('allow-list rejects private fields, bad values and cross-origin writes', async () => {
    for (const field of ['client_price','internal_comment','client_comment','supplier_id','request_id','product_name','image_url','quantity','unit','specifications','deadline_at','created_at']) {
      const result = await post(ids.item, { operation: 'response', response: { ...response, [field]: 'ATTACK' } });
      assert.equal(result.status, 400, field);
    }
    for (const value of [-1, 'NaN', Infinity, {}, true, '1e999', ' ']) assert.throws(() => validation.parseSupplierResponse({ ...response, china_price: value }));
    assert.throws(() => validation.parseSupplierResponse({ ...response, lead_time_days: '1.2' }));
    assert.equal((await post(ids.item, { operation: 'response', response }, token, 'https://evil.example')).status, 400);
  });
  await t.test('valid update persists decimal response fields, logs, and leaves private fields unchanged', async () => {
    const result = await post(ids.item, { operation: 'response', response });
    assert.equal(result.status, 200);
    assert.match(result.headers.get('cache-control'), /no-store/);
    const { rows } = await pg.query('select * from sourcing_request_items where id=$1', [ids.item]);
    assert.equal(Number(rows[0].china_price), 1.25);
    assert.equal(rows[0].internal_comment, 'INTERNAL SECRET');
    assert.equal(Number(rows[0].client_price), 999);
    assert.equal(rows[0].supplier_status, 'answered');
    assert.equal((await pg.query("select count(*)::int as n from sourcing_activity_log where action='supplier_item_updated'")).rows[0].n, 1);
  });
  await t.test('new assignments appear and reassigned items disappear without new links', async () => {
    await pg.query('update sourcing_request_items set supplier_id=$1 where id=$2', [ids.supplier, ids.otherSupplierItem]);
    assert.equal((await portal.readSupplierPortal(token)).items.length, 2);
    await pg.query('update sourcing_request_items set supplier_id=$1 where request_id=$2', [ids.otherSupplier, ids.request]);
    const empty = await portal.readSupplierPortal(token);
    assert.deepEqual(empty, { items: [], images: [], referenceImages: [], requestNo: null, supplierName: null, createdAt: null, deadlineAt: null });
    assert.equal((await post(ids.item, { operation: 'response', response })).status, 404);
    assert.equal((await post(ids.item, { operation: 'prepare_image', mime: 'image/png', size: 16 })).status, 404);
    await pg.query('update sourcing_request_items set supplier_id=$1 where id=$2', [ids.supplier, ids.item]);
  });
  await t.test('SQL rechecks assignment even after the server authorization check', async () => {
    const scope = await portal.supplierScope(token);
    await portal.scopedItem(scope, ids.item);
    await pg.query('update sourcing_request_items set supplier_id=$1 where id=$2', [ids.otherSupplier, ids.item]);
    const result = await transport.rpc('sourcing_supplier_mutate', { p_hash: scope.hash, p_item: ids.item, p_operation: 'response', p_payload: validation.parseSupplierResponse(response) });
    assert.ok(result.error);
    await pg.query('update sourcing_request_items set supplier_id=$1 where id=$2', [ids.supplier, ids.item]);
  });
  await t.test('upload intent is scoped and cannot replace the Nexo reference image', async () => {
    const args = { p_hash: portal.hashToken(token), p_item: ids.item, p_operation: 'prepare_image', p_payload: { id: ids.image, mime_type: 'image/png', byte_size: 16 } };
    const image = await transport.rpc('sourcing_supplier_mutate', args);
    assert.equal(image.error, null);
    assert.equal(image.data.path, `requests/${ids.request}/supplier/${ids.supplier}/${ids.item}/${ids.image}`);
    assert.ok((await transport.rpc('sourcing_supplier_mutate', { ...args, p_item: ids.otherRequestItem })).error);
    const bad = await post(ids.item, { operation: 'finish_image', imageId: ids.otherSupplierItem });
    assert.equal(bad.status, 404);
    for (const mime of ['image/svg+xml','text/html','application/pdf']) assert.equal((await post(ids.item, { operation: 'prepare_image', mime, size: 100 })).status, 400);
    assert.equal((await post(ids.item, { operation: 'prepare_image', mime: 'image/png', size: 10485761 })).status, 400);
    assert.equal(validation.imageMime(new TextEncoder().encode('<svg onload="alert(1)"></svg>')), null);
    assert.equal(validation.imageMime(new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0])), 'image/png');
  });
  await t.test('signed upload finalizes only verified images; downloads reauthorize and never expose signed URLs', async () => {
    const png = new Blob([new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0,0,0,0,0])], { type: 'image/png' });
    const objects = new Map();
    let issuedPath;
    const originalStorage = transport.storage;
    const originalFetch = global.fetch;
    transport.storage = { from(bucket) {
      assert.equal(bucket, 'sourcing-files');
      return {
        async createSignedUploadUrl(objectPath, options) {
          assert.deepEqual(options, { upsert: false }); issuedPath = objectPath;
          return { data: { token: 'one-object-upload-capability' }, error: null };
        },
        async download(objectPath) { return { data: objects.get(objectPath), error: null }; },
        async remove(paths) { paths.forEach(path => objects.delete(path)); return { error: null }; },
        async createSignedUrl(objectPath, expires) {
          assert.equal(expires, 15);
          return { data: { signedUrl: 'https://storage.test/' + objectPath }, error: null };
        }
      };
    } };
    global.fetch = async (url, init) => {
      assert.equal(init.cache, 'no-store');
      return new Response(objects.get(String(url).replace('https://storage.test/', '')));
    };
    try {
      const beforeUpload = await versions();
      const prepare = await post(ids.item, { operation: 'prepare_image', mime: 'image/png', size: png.size });
      assert.deepEqual(await versions(), beforeUpload, 'Preparing an upload must not notify');
      assert.equal(prepare.status, 200);
      const capability = await prepare.json();
      assert.equal(capability.path, issuedPath);
      assert.equal(capability.uploadToken, 'one-object-upload-capability');
      objects.set(capability.path, png);
      assert.equal((await post(ids.otherSupplierItem, { operation: 'finish_image', imageId: capability.id })).status, 404);
      assert.equal((await post(ids.item, { operation: 'finish_image', imageId: capability.id })).status, 200);
      assert.ok(unread.timestampMicros((await versions()).supplier_changed_at) > unread.timestampMicros(beforeUpload.supplier_changed_at), 'Completed upload must notify Nexo');
      assert.ok((await portal.readSupplierPortal(token)).images.some(image => image.id === capability.id));
      const params = { token, itemId: ids.item, imageId: capability.id };
      const download = await imageApi.GET(new Request('https://sourcing.nexo.ge'), { params: Promise.resolve(params) });
      assert.equal(download.status, 200);
      assert.equal(download.headers.get('content-type'), 'image/png');
      assert.equal(download.headers.get('location'), null);
      assert.match(download.headers.get('cache-control'), /no-store/);
      assert.equal((await download.arrayBuffer()).byteLength, png.size);
      await pg.query('update sourcing_request_items set supplier_id=$1 where id=$2', [ids.otherSupplier, ids.item]);
      assert.equal((await imageApi.GET(new Request('https://sourcing.nexo.ge'), { params: Promise.resolve(params) })).status, 404);
      await pg.query('update sourcing_request_items set supplier_id=$1 where id=$2', [ids.supplier, ids.item]);
      const spoof = await (await post(ids.item, { operation: 'prepare_image', mime: 'image/png', size: 16 })).json();
      objects.set(spoof.path, new Blob(['<svg>attack</svg>'], { type: 'image/png' }));
      assert.equal((await post(ids.item, { operation: 'finish_image', imageId: spoof.id })).status, 400);
      assert.ok(!objects.has(spoof.path));
      assert.ok(!(await portal.readSupplierPortal(token)).images.some(image => image.id === spoof.id));
      assert.equal((await pg.query('select image_url from sourcing_request_items where id=$1', [ids.item])).rows[0].image_url, null);
    } finally { transport.storage = originalStorage; global.fetch = originalFetch; }
  });
  await t.test('Nexo visible edits and reference edits stamp versions; private edits and reads do not acknowledge', async () => {
    await pg.query("select set_config('test.uid',$1,false)", [ids.user]);
    try {
      await pg.query("update sourcing_request_items set product_name='Updated kettle' where id=$1", [ids.item]);
      const first = await versions();
      assert.ok(first.nexo_changed_at);
      await pg.query("update sourcing_request_items set internal_comment='Private edit', client_price=123 where id=$1", [ids.item]);
      assert.deepEqual(await versions(), first);
      const gallery = (await pg.query("insert into sourcing_request_item_images(request_item_id,object_path,sort_order) values($1,'reference',0) returning id", [ids.item])).rows[0].id;
      const added = await versions();
      assert.ok(unread.timestampMicros(added.nexo_changed_at) > unread.timestampMicros(first.nexo_changed_at));
      await pg.query('update sourcing_request_item_images set sort_order=1 where id=$1', [gallery]);
      const reordered = await versions();
      assert.ok(unread.timestampMicros(reordered.nexo_changed_at) > unread.timestampMicros(added.nexo_changed_at));
      await pg.query('delete from sourcing_request_item_images where id=$1', [gallery]);
      assert.ok(unread.timestampMicros((await versions()).nexo_changed_at) > unread.timestampMicros(reordered.nexo_changed_at));
    } finally { await pg.query("select set_config('test.uid','',false)"); }
    const before = await versions();
    await portal.readSupplierPortal(token);
    assert.deepEqual(await versions(), before);
  });
  await t.test('supplier seen persists exact version, rejects stale microseconds and both scope violations', async () => {
    const params = { token, itemId: ids.item };
    const stamp = '2026-10-01T12:00:00.123456+00:00';
    await pg.query('update sourcing_request_items set nexo_changed_at=$1,supplier_seen_at=null where id=$2', [stamp, ids.item]);
    assert.equal((await seen(supplierSeen, params, stamp)).status, 200);
    let v = await versions();
    assert.equal(unread.hasUnreadUpdate(v.nexo_changed_at, v.supplier_seen_at), false);
    const newer = '2026-10-01T12:00:00.123457+00:00';
    await pg.query('update sourcing_request_items set nexo_changed_at=$1 where id=$2', [newer, ids.item]);
    assert.equal((await seen(supplierSeen, params, stamp)).status, 409);
    v = await versions();
    assert.equal(unread.hasUnreadUpdate(v.nexo_changed_at, v.supplier_seen_at), true);
    for (const itemId of [ids.otherRequestItem, ids.otherSupplierItem]) assert.equal((await seen(supplierSeen, { token, itemId }, newer)).status, 404);
    assert.equal((await seen(supplierSeen, { token: 'b'.repeat(64), itemId: ids.item }, newer)).status, 404);
    assert.equal((await seen(supplierSeen, params, newer)).status, 200);
  });
  await t.test('every response field and repeated save stamps supplier version; Nexo seen is exact and authenticated', async () => {
    const params = { requestId: ids.request, itemId: ids.item };
    const changed = { ...response };
    for (const key of Object.keys(response)) {
      const before = await versions();
      changed[key] = key === 'supplier_comment' ? 'New comment' : key === 'currency' ? 'CNY' : key === 'supplier_status' ? 'waiting' : '2';
      assert.equal((await post(ids.item, { operation: 'response', response: changed })).status, 200, key);
      const after = await versions();
      assert.ok(unread.timestampMicros(after.supplier_changed_at) > unread.timestampMicros(before.supplier_changed_at), key);
      assert.equal(after.nexo_changed_at, before.nexo_changed_at, 'Supplier write must not echo to supplier');
      assert.equal(unread.hasUnreadUpdate(after.supplier_changed_at, after.nexo_seen_at), true);
      assert.equal((await seen(nexoSeen, params, after.supplier_changed_at)).status, 200);
      const acknowledged = await versions();
      assert.equal(unread.hasUnreadUpdate(acknowledged.supplier_changed_at, acknowledged.nexo_seen_at), false);
    }
    const before = await versions();
    assert.equal((await post(ids.item, { operation: 'response', response: changed })).status, 200);
    assert.ok(unread.timestampMicros((await versions()).supplier_changed_at) > unread.timestampMicros(before.supplier_changed_at));
    await pg.query("update sourcing_request_items set supplier_changed_at='2026-10-01T12:00:00.123457Z' where id=$1", [ids.item]);
    assert.equal((await seen(nexoSeen, params, '2026-10-01T12:00:00.123456Z')).status, 409);
    // A supplier save between the Nexo route's SELECT and UPDATE must fail its CAS.
    const originalFrom = transport.from;
    transport.from = table => {
      const builder = originalFrom(table);
      const originalUpdate = builder.update;
      builder.update = function (values) {
        if (table === 'sourcing_request_items' && values.nexo_seen_at) {
          const originalThen = this.then;
          this.then = async function (resolve, reject) {
            await pg.query("update sourcing_request_items set supplier_changed_at='2026-10-01T12:00:00.123458Z' where id=$1", [ids.item]);
            return originalThen.call(this, resolve, reject);
          };
        }
        return originalUpdate.call(this, values);
      };
      return builder;
    };
    const beforeRace = await versions();
    try { assert.equal((await seen(nexoSeen, params, '2026-10-01T12:00:00.123457Z')).status, 409); }
    finally { transport.from = originalFrom; }
    assert.equal((await versions()).nexo_seen_at, beforeRace.nexo_seen_at);
    assert.equal((await seen(nexoSeen, { ...params, requestId: ids.otherRequest }, '2026-10-01T12:00:00.123457Z')).status, 404);
    staffAccess = false;
    try { assert.equal((await seen(nexoSeen, params, '2026-10-01T12:00:00.123457Z')).status, 401); }
    finally { staffAccess = true; }
  });
  await t.test('revocation blocks reads, updates, images and finalization; token cannot reactivate', async () => {
    await pg.query('update sourcing_supplier_share_links set active=false,revoked_at=now() where id=$1', [linkId]);
    await assert.rejects(portal.readSupplierPortal(token), /invalid or no longer active/);
    assert.equal((await seen(supplierSeen, { token, itemId: ids.item }, '2026-10-01T12:00:00Z')).status, 404);
    assert.equal((await post(ids.item, { operation: 'response', response })).status, 404);
    assert.equal((await post(ids.item, { operation: 'prepare_image', mime: 'image/png', size: 16 })).status, 404);
    assert.equal((await post(ids.item, { operation: 'finish_image', imageId: ids.image })).status, 404);
    assert.equal((await imageApi.GET(new Request('https://sourcing.nexo.ge'), { params: Promise.resolve({ token, itemId: ids.item, imageId: ids.image }) })).status, 404);
    await assert.rejects(pg.query('update sourcing_supplier_share_links set active=true,revoked_at=null where id=$1', [linkId]), /immutable/);
    const replacement = 'c'.repeat(64);
    await insertLink(replacement);
    assert.equal((await portal.readSupplierPortal(replacement)).items.length, 1);
    await assert.rejects(portal.readSupplierPortal(token));
  });
  await t.test('expired link fails without exposing request/supplier existence', async () => {
    const expired = 'd'.repeat(64);
    await insertLink(expired, ids.otherRequest, ids.supplier, '2000-01-01T00:00:00Z');
    await assert.rejects(portal.readSupplierPortal(expired), /invalid or no longer active/);
    assert.equal((await seen(supplierSeen, { token: expired, itemId: ids.otherRequestItem }, '2026-10-01T12:00:00Z')).status, 404);
  });
  await t.test('admin creation/revocation requires staff, stores hashes only, logs events, and replaces tokens', async () => {
    const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-configuration-placeholder';
    try {
      staffAccess = false;
      await assert.rejects(shareActions.createSupplierLink(ids.request, ids.otherSupplier, 30), /Access denied/);
      await assert.rejects(shareActions.revokeSupplierLink(ids.request, ids.supplier, linkId), /Access denied/);
      staffAccess = true;
      assert.ok((await shareActions.createSupplierLink(ids.otherRequest, ids.otherSupplier, 30)).error);
      const created = await shareActions.createSupplierLink(ids.request, ids.otherSupplier, 30);
      assert.ok(created.url, created.error);
      const raw = created.url.split('/').pop();
      assert.match(raw, /^[a-f0-9]{64}$/);
      const stored = (await pg.query('select * from sourcing_supplier_share_links where id=$1', [created.id])).rows[0];
      assert.equal(stored.token_hash, portal.hashToken(raw));
      assert.ok(!JSON.stringify(stored).includes(raw));
      assert.equal((await portal.readSupplierPortal(raw)).items.length, 1);
      assert.ok((await shareActions.createSupplierLink(ids.request, ids.otherSupplier, 30)).error);
      const beforeCount = (await pg.query('select count(*)::int as n from sourcing_request_items')).rows[0].n;
      assert.equal((await shareActions.revokeSupplierLink(ids.request, ids.otherSupplier, created.id)).ok, true);
      await assert.rejects(portal.readSupplierPortal(raw));
      const replacement = await shareActions.createSupplierLink(ids.request, ids.otherSupplier, 7);
      assert.ok(replacement.url, replacement.error);
      assert.notEqual(replacement.url, created.url);
      assert.equal((await portal.readSupplierPortal(replacement.url.split('/').pop())).items.length, 1);
      await shareActions.revokeSupplierLink(ids.request, ids.otherSupplier, replacement.id);
      assert.equal((await pg.query('select count(*)::int as n from sourcing_request_items')).rows[0].n, beforeCount);
      const actions = (await pg.query('select action,details from sourcing_activity_log')).rows;
      for (const action of ['supplier_link_created','supplier_link_revoked','supplier_item_updated','supplier_image_uploaded']) assert.ok(actions.some(row => row.action === action), action);
      assert.ok(!JSON.stringify(actions).includes(raw));
    } finally {
      staffAccess = true;
      if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
    }
  });
  await t.test('authenticated request deadlines persist, clear, preserve creation/status, and reject invalid input', async () => {
    const form = new FormData(); form.set('id', ids.request); form.set('deadline_at', '2026-10-05T18:42');
    staffAccess = false;
    await assert.rejects(requestActions.updateRequestDeadlineAction(form), /Access denied/);
    staffAccess = true;
    assert.equal(await requestActions.updateRequestDeadlineAction(form), undefined);
    const read = async () => (await pg.query('select deadline_at,created_at,status from sourcing_requests where id=$1', [ids.request])).rows[0];
    const saved = await read();
    assert.equal(new Date(saved.deadline_at).toISOString(), '2026-10-05T14:42:00.000Z');
    assert.deepEqual(saved.created_at, existingCreated);
    assert.equal(saved.status, 'new');
    form.set('deadline_at', '2026-02-30T12:00');
    assert.ok((await requestActions.updateRequestDeadlineAction(form)).error);
    assert.deepEqual(await read(), saved);
    form.set('deadline_at', '');
    assert.equal(await requestActions.updateRequestDeadlineAction(form), undefined);
    assert.equal((await read()).deadline_at, null);
    assert.equal((await pg.query("select count(*)::int as n from sourcing_activity_log where action='request_deadline_changed'")).rows[0].n, 2);
    const newRequest = new FormData(); newRequest.set('title', 'Deadline creation test'); newRequest.set('deadline_at', '2026-10-10T09:30');
    await assert.rejects(requestActions.createRequestAction(newRequest), error => error.location?.startsWith('/requests/'));
    const created = (await pg.query("select deadline_at,created_at from sourcing_requests where title='Deadline creation test'")).rows[0];
    assert.equal(new Date(created.deadline_at).toISOString(), '2026-10-10T05:30:00.000Z');
    assert.ok(created.created_at);
    newRequest.set('title', 'No deadline test'); newRequest.delete('deadline_at');
    await assert.rejects(requestActions.createRequestAction(newRequest), error => error.location?.startsWith('/requests/'));
    assert.equal((await pg.query("select deadline_at from sourcing_requests where title='No deadline test'")).rows[0].deadline_at, null);
  });
  await t.test('RLS denies anonymous/nonmember access and RPC execution', async () => {
    await pg.exec('set role anon');
    await assert.rejects(pg.query('select * from sourcing_supplier_share_links'), /permission denied/);
    await assert.rejects(pg.query('select * from sourcing_supplier_images'), /permission denied/);
    await assert.rejects(pg.query("select sourcing_supplier_mutate('x',$1,'response','{}')", [ids.item]), /permission denied/);
    await pg.exec('reset role');
    await pg.query("select set_config('test.uid',$1,false)", [ids.outsider]);
    await pg.exec('set role authenticated');
    assert.equal((await pg.query('select id from sourcing_supplier_share_links')).rows.length, 0);
    await assert.rejects(pg.query('select token_hash from sourcing_supplier_share_links'), /permission denied/);
    await assert.rejects(pg.query("select sourcing_supplier_mutate('x',$1,'response','{}')", [ids.item]), /permission denied/);
    await pg.exec('reset role');
    await pg.query("select set_config('test.uid',$1,false)", [ids.user]);
    await pg.exec('set role authenticated');
    assert.ok((await pg.query('select id from sourcing_supplier_share_links')).rows.length > 0);
    // The same limited role used by admin actions can insert/return only the id
    // and revoke, but cannot read hashes or reactivate/alter link identities.
    const staffHash = portal.hashToken('e'.repeat(64));
    const staffLink = (await pg.query('insert into sourcing_supplier_share_links(request_id,supplier_id,token_hash,created_by) values($1,$2,$3,$4) returning id', [ids.request, ids.otherSupplier, staffHash, ids.user])).rows[0].id;
    await pg.query('update sourcing_supplier_share_links set active=false,revoked_at=now() where id=$1', [staffLink]);
    await assert.rejects(pg.query('update sourcing_supplier_share_links set active=true,revoked_at=null where id=$1', [staffLink]));
    await assert.rejects(pg.query('update sourcing_supplier_share_links set request_id=$1 where id=$2', [ids.otherRequest, staffLink]), /permission denied/);
    await pg.exec('reset role');
    assert.deepEqual((await pg.query("select public,file_size_limit from storage.buckets where id='sourcing-files'")).rows[0], { public: false, file_size_limit: 10485760 });
  });
});
