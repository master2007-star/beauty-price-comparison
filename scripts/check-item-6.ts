import assert from "node:assert/strict";
import fixture from "./fixtures/observed-history.json";
import { computePriceHistorySeries, shouldRecordSnapshot } from "../src/lib/db";
import { hasPriceHistoryPoints } from "../src/lib/price-history";

// Replay the actual dated series returned by the deployed history API.
const snapshots = fixture.History.series.map((point) => ({ price: point.price, recorded_at: point.date }));
const history = computePriceHistorySeries(snapshots);
assert.deepEqual(history, fixture.History);
assert.equal(hasPriceHistoryPoints(history), true, "One real dated point must render");
assert.equal(hasPriceHistoryPoints(computePriceHistorySeries([])), false);
const point = snapshots[0];
const sameDay = new Date(point.recorded_at);
const nextDay = new Date(sameDay.getTime() + 24 * 60 * 60 * 1000);
assert.equal(shouldRecordSnapshot(point.price, point.price, point.recorded_at, sameDay), false);
assert.equal(shouldRecordSnapshot(point.price, point.price, point.recorded_at, nextDay), true);
console.log("PASS Item 6: recorded snapshots produce dated points; one day renders; stable prices are recorded on a new day.");
