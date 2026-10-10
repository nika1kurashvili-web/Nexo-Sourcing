import test from "node:test";
import assert from "node:assert/strict";
import { orderTotals, lineTotal, parseAmount, validDate } from "../lib/orders.ts";
import { skuCandidates } from "../lib/photo-match.ts";
import { readXlsx, writeXlsx } from "../lib/xlsx-lite.ts";

test("order totals count only approved prices and subtract payments", () => {
  const totals = orderTotals(
    [{ quantity: 10, unit_price: 2.5 }, { quantity: 3, unit_price: null, proposed_price: 4 }, { quantity: 1.5, unit_price: 0.1, proposed_price: 0.2 }],
    ["10", 5.25]
  );
  assert.equal(totals.total, 25.15);
  assert.equal(totals.paid, 15.25);
  assert.equal(totals.balance, 9.9);
  assert.equal(totals.unpriced, 1);
  assert.equal(totals.proposals, 2);
  assert.equal(totals.proposedTotal, 37.3);
  assert.equal(lineTotal(3, null), null);
});

test("floating point sums stay exact to the cent", () => {
  const totals = orderTotals(Array.from({ length: 10 }, () => ({ quantity: 1, unit_price: 0.1 })), [0.3]);
  assert.equal(totals.total, 1);
  assert.equal(totals.balance, 0.7);
});

test("amount and date validation", () => {
  assert.equal(parseAmount("12,5", "x"), 12.5);
  assert.equal(parseAmount("", "x", { allowEmpty: true }), null);
  assert.throws(() => parseAmount("-1", "x"));
  assert.throws(() => parseAmount("1e5", "x"));
  assert.throws(() => parseAmount("0", "x", { min: 0.01 }));
  assert.ok(validDate("2026-10-10"));
  assert.ok(!validDate("2026-02-30"));
  assert.ok(!validDate("10/10/2026"));
});

test("photo names map to product codes", () => {
  assert.deepEqual(skuCandidates("P00012.jpg"), ["p00012"]);
  assert.ok(skuCandidates("P00012_2.JPG").includes("p00012"));
  assert.ok(skuCandidates("P00012 (3).png").includes("p00012"));
  assert.ok(skuCandidates("C:\\fakepath\\AB-7-2.webp").includes("ab-7"));
  assert.equal(skuCandidates("P00012_2.jpg")[0], "p00012_2");
});

test("xlsx writer output can be read back, including special characters", () => {
  const buffer = writeXlsx([{ name: "Products", rows: [["Code", "Name", "Price"], ["00123", 'Cup & <Saucer> "x" ქართული', 12.5], ["P2", "Plate", null]] }]);
  const sheet = readXlsx(buffer);
  assert.equal(sheet.name, "Products");
  assert.deepEqual(sheet.rows[1], ["00123", 'Cup & <Saucer> "x" ქართული', "12.5"]);
  assert.deepEqual(sheet.rows[2].slice(0, 2), ["P2", "Plate"]);
});

test("garbage is rejected as an Excel file", () => {
  assert.throws(() => readXlsx(Buffer.from("not a zip file at all, just text")), /Excel/);
});

import { parseOrderSheet } from "../lib/order-import.ts";

test("order sheet: reads barcode + quantity, merges repeats, reports bad rows", () => {
  const ok = parseOrderSheet([["Barcode", "Quantity"], ["P00001", "10"], ["p00001", "5"], ["P00002", "2,5"], ["", ""]]);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.lines.length, 2);
  assert.equal(ok.lines[0].quantity, 15);
  assert.equal(ok.lines[1].quantity, 2.5);
  assert.equal(ok.warnings.length, 1);
  const bad = parseOrderSheet([["Code", "Qty"], ["A", "0"], ["", "3"], ["B", "x"]]);
  assert.equal(bad.errors.length, 3);
  assert.equal(parseOrderSheet([["Name", "Qty"]]).errors.length, 1);
  assert.equal(parseOrderSheet([]).errors.length, 1);
});
