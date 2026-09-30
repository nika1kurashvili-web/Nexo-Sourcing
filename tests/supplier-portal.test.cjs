const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { PGlite } = require('@electric-sql/pglite');

// Run the actual TypeScript server modules against PostgreSQL, with only the
// Supabase HTTP transport and Storage replaced. No production credentials/data.
let transport;
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
    if (name === '@/lib/supabase/admin') return { createAdminClient: () => transport };
    if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
    return require(name);
  };
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename: file })(localRequire, module, module.exports);
  return module.exports;
}

function adapter(pg) {
  return {
    from(table) {
      let columns = '*', filters = [], values = [], sort = '', maximum = '', update;
      let singular = false, strict = false;
      const add = (column, op, value) => { values.push(value); filters.push(`"${column}" ${op} $${values.length}`); };
      const builder = {
        select(value) { columns = value; return this; },
        eq(column, value) { add(column, '=', value); return this; },
        is(column, value) { assert.equal(value, null); filters.push(`"${column}" is null`); return this; },
        in(column, value) { add(column, '= any', value); filters[filters.length - 1] = `"${column}" = any($${values.length}::uuid[])`; return this; },
        order(column) { sort = ` order by "${column}"`; return this; },
        update(value) { update = value; return this; },
        limit(value) { maximum = ` limit ${Number(value)}`; return this; },
        maybeSingle() { singular = true; return this; },
        single() { singular = true; strict = true; return this; },
        async then(resolve, reject) {
          try {
            const where = filters.length ? ` where ${filters.join(' and ')}` : '';
            let sql;
            if (update) {
              const assignments = Object.entries(update).map(([key, value]) => { values.push(value); return `"${key}"=$${values.length}`; });
              sql = `update public."${table}" set ${assignments.join(',')}${where} returning ${columns}`;
            } else sql = `select ${columns} from public."${table}"${where}${sort}${maximum}`;
            const { rows } = await pg.query(sql, values);
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
    create table public.sourcing_requests(id uuid primary key, request_no text, updated_at timestamptz default now(), company_name text);
    create table public.sourcing_suppliers(id uuid primary key, name text);
    create type supplier_status as enum ('not_sent','sent','waiting','answered','not_found');
    create table public.sourcing_request_items(
      id uuid primary key, request_id uuid references sourcing_requests, supplier_id uuid references sourcing_suppliers,
      item_no integer, product_name text, quantity numeric, unit text, specifications text, image_url text,
      china_price numeric(10,2), currency text, moq numeric, lead_time_days integer, box_length_cm numeric(10,2),
      box_width_cm numeric(10,2), box_height_cm numeric(10,2), weight_kg numeric(10,3), supplier_comment text,
      supplier_status supplier_status, client_price numeric, internal_comment text, client_comment text
    );
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
  transport = adapter(pg);
  const portal = load('lib/supplier-portal.ts');
  const validation = load('lib/supplier-validation.ts');
  const api = load('app/api/supplier/[token]/items/[itemId]/route.ts');
  const imageApi = load('app/api/supplier/[token]/items/[itemId]/images/[imageId]/route.ts');
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
    for (const forbidden of ['client_price','client_comment','internal_comment','SECRET','Other supplier product','Other request product','company_name','created_by','token_hash']) assert.ok(!serialized.includes(forbidden), forbidden);
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
    for (const field of ['client_price','internal_comment','client_comment','supplier_id','request_id','product_name','image_url','quantity','specifications']) {
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
    assert.deepEqual(empty, { items: [], images: [], requestNo: null, supplierName: null });
    assert.equal((await post(ids.item, { operation: 'response', response })).status, 404);
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
  await t.test('revocation blocks reads, updates, images and finalization; token cannot reactivate', async () => {
    await pg.query('update sourcing_supplier_share_links set active=false,revoked_at=now() where id=$1', [linkId]);
    await assert.rejects(portal.readSupplierPortal(token), /invalid or no longer active/);
    assert.equal((await post(ids.item, { operation: 'response', response })).status, 404);
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
    await pg.exec('reset role');
    assert.deepEqual((await pg.query("select public,file_size_limit from storage.buckets where id='sourcing-files'")).rows[0], { public: false, file_size_limit: 10485760 });
  });
});
