import test from "node:test";
import assert from "node:assert/strict";
import { isFalseSignalInvalidated } from "../src/false-signal-guard.js";

test("CALL is invalidated only after price breaks below its source midpoint buffer",()=>{
 assert.equal(isFalseSignalInvalidated({signal:"CALL",price:1.0998,invalidationPrice:1.1000,buffer:0.00005}),true);
 assert.equal(isFalseSignalInvalidated({signal:"CALL",price:1.09996,invalidationPrice:1.1000,buffer:0.00005}),false);
});

test("PUT is invalidated only after price breaks above its source midpoint buffer",()=>{
 assert.equal(isFalseSignalInvalidated({signal:"PUT",price:1.1002,invalidationPrice:1.1000,buffer:0.00005}),true);
 assert.equal(isFalseSignalInvalidated({signal:"PUT",price:1.10004,invalidationPrice:1.1000,buffer:0.00005}),false);
});

test("invalid inputs and unknown directions never invalidate",()=>{
 assert.equal(isFalseSignalInvalidated({signal:"WAIT",price:1,invalidationPrice:1}),false);
 assert.equal(isFalseSignalInvalidated({signal:"CALL",price:NaN,invalidationPrice:1}),false);
});
