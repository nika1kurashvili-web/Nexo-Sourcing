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

test("quantity suggestions count as proposals and change the proposed total", () => {
  const totals = orderTotals([{ quantity: 10, unit_price: 2, proposed_quantity: 12 }, { quantity: 5, unit_price: 1, proposed_price: 3, proposed_quantity: 4 }], []);
  assert.equal(totals.total, 25);
  assert.equal(totals.proposals, 2);
  assert.equal(totals.proposedTotal, 36);
});

test("total quantity adds up all lines", () => {
  assert.equal(orderTotals([{ quantity: 10, unit_price: 1 }, { quantity: 20, unit_price: null }], []).totalQuantity, 30);
});

import { computeCost, COST_DEFAULTS } from "../lib/landed-cost.ts";

test("landed cost: CNY price, transport by the larger of volume and weight, customs on price + transport", () => {
  const product = { price: 10, currency: "CNY", qty_in_box: 100, box_length_cm: 60, box_width_cm: 60, box_height_cm: 120, weight_kg: 20 };
  const cost = computeCost(product, COST_DEFAULTS);
  assert.ok(cost.ok);
  assert.equal(cost.basis, "volume");
  assert.ok(Math.abs(cost.price - 10 * 1.03 / 2.49) < 1e-9);
  assert.ok(Math.abs(cost.transport - 0.432 / 100 * 270 * 2.65) < 1e-9);
  assert.ok(Math.abs(cost.total - (cost.price + cost.transport) * 1.18) < 1e-9);
  const heavy = computeCost({ ...product, weight_kg: 400 }, COST_DEFAULTS);
  assert.ok(heavy.ok && heavy.basis === "weight");
  assert.ok(Math.abs(heavy.transport - 400 / 100 * 1.1 * 2.65) < 1e-9);
  const usd = computeCost({ ...product, currency: "USD" }, COST_DEFAULTS);
  assert.ok(usd.ok && Math.abs(usd.price - 10 * 1.03 * 2.65) < 1e-9);
  assert.equal(computeCost({ ...product, qty_in_box: null }, COST_DEFAULTS).ok, false);
  assert.equal(computeCost({ price: 5, currency: "EUR", qty_in_box: 1, weight_kg: 1 }, COST_DEFAULTS).ok, false);
  const weightOnly = computeCost({ price: 5, currency: "GEL", qty_in_box: 30, weight_kg: 2 }, COST_DEFAULTS);
  assert.ok(weightOnly.ok && Math.abs(weightOnly.transport - 2 / 30 * 1.1 * 2.65) < 1e-9);
});

test("air products use the air numbers", () => {
  const settings = { land: { ...COST_DEFAULTS.land }, air: { ...COST_DEFAULTS.air, usd_per_kg: 6, customs: 0.1 } };
  const product = { price: 5, currency: "GEL", qty_in_box: 30, weight_kg: 2, shipping_method: "air" };
  const air = computeCost(product, settings);
  assert.ok(air.ok && air.method === "air" && Math.abs(air.transport - 2 / 30 * 6 * 2.65) < 1e-9);
  assert.ok(Math.abs(air.customs - (5 + air.transport) * 0.1) < 1e-9);
  const land = computeCost({ ...product, shipping_method: "land" }, settings);
  assert.ok(land.ok && land.method === "land" && Math.abs(land.transport - 2 / 30 * 1.1 * 2.65) < 1e-9);
  assert.equal(computeCost({ ...product, shipping_method: undefined }, settings).method, "land");
});

import { balanceTone } from "../lib/orders.ts";

test("balance tone: green when settled, yellow while owing, red when overpaid", () => {
  assert.equal(balanceTone({ total: 100, paid: 100, balance: 0 }), "paid");
  assert.equal(balanceTone({ total: 100, paid: 40, balance: 60 }), "due");
  assert.equal(balanceTone({ total: 100, paid: 0, balance: 100 }), "due");
  assert.equal(balanceTone({ total: 100, paid: 120, balance: -20 }), "over");
  assert.equal(balanceTone({ total: 0, paid: 0, balance: 0 }), "none");
});

import { completionInfo, formatDate } from "../lib/orders.ts";

test("completion date: days left, today, overdue", () => {
  assert.equal(completionInfo(null, "2026-11-09"), null);
  assert.deepEqual(completionInfo("2026-11-20", "2026-11-09"), { text: "in 11 days", tone: "ok" });
  assert.deepEqual(completionInfo("2026-11-11", "2026-11-09"), { text: "in 2 days", tone: "soon" });
  assert.deepEqual(completionInfo("2026-11-09", "2026-11-09"), { text: "today", tone: "soon" });
  assert.deepEqual(completionInfo("2026-11-08", "2026-11-09"), { text: "1 day overdue", tone: "late" });
  assert.deepEqual(completionInfo("2026-11-01", "2026-11-09"), { text: "8 days overdue", tone: "late" });
  assert.deepEqual(completionInfo("2026-11-01", "2026-11-09", true), { text: "all ready", tone: "done" });
  assert.equal(formatDate("2026-11-09"), "09 Nov 2026");
  assert.equal(formatDate(null), "—");
});
