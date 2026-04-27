## 2024-04-13 - Array Spread inside Hot Loops
**Learning:** In JavaScript, using the array spread operator (`[...arr1, ...arr2]`) inside a frequently called function (like `computeScore` for every connection) causes significant performance overhead due to repeated memory allocations and garbage collection.
**Action:** Always pre-combine arrays and hoist them to the module or class scope when the arrays are static and used in a hot loop.

## 2024-05-24 - Avoiding Higher-Order Array Methods in Hot Loops
**Learning:** Using array iteration methods like `some` and `reduce` in a hot path (such as executing an array of regexes against many strings in `outreachClassifier.js`) incurs significant overhead compared to simple `for` loops, due to anonymous function allocations and callback invocation costs.
**Action:** When working on classification or processing loops that iterate over thousands of objects per run, replace `some`, `reduce`, or `map` with standard `for` loops to minimize CPU cycles and memory allocations.

## 2025-04-27 - [Overlapped network I/O with forced loop delay]
**Learning:** [When dealing with loops that feature an intentional delay (like rate limiting), any sequential network call preceding that delay acts as an N+1 performance bottleneck. In this specific script, the sequential Notion API call took 300ms, effectively making the intentional delay 5300ms instead of 5000ms per iteration.]
**Action:** [Identify sequential network calls directly before intentional delays. Instead of `await networkCall() \n await delay()`, use `const updatePromise = networkCall() \n await Promise.all([delay(), updatePromise])`. Always make sure `updatePromise` has its own isolated `.catch()` so its failures don't interfere with the loop delay or throw uncaught promise rejections.]
