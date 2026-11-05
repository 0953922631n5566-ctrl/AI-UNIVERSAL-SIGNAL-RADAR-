'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {expectedWeekdayHours,summarizeCoverage}=require('../scripts/download-historical');
test('coverage denominator excludes weekend hours',()=>{
 assert.equal(expectedWeekdayHours(new Date('2026-11-02T00:00:00Z'),new Date('2026-11-08T00:00:00Z')),120);
});
test('coverage includes cached and newly downloaded hours',()=>{
 const c=summarizeCoverage(new Date('2026-11-02T00:00:00Z'),new Date('2026-11-06T00:00:00Z'),{downloaded:40,cached:60,missingProvider:10,failedAfterRetries:10});
 assert.equal(c.expectedWeekdayHours,120);assert.equal(c.availableHours,100);assert.equal(c.coveragePct,83.33);
 assert.equal(c.missingProviderHours,10);assert.equal(c.failedAfterRetriesHours,10);
});
