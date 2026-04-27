## 2024-04-13 - Array Spread inside Hot Loops
**Learning:** In JavaScript, using the array spread operator (`[...arr1, ...arr2]`) inside a frequently called function (like `computeScore` for every connection) causes significant performance overhead due to repeated memory allocations and garbage collection.
**Action:** Always pre-combine arrays and hoist them to the module or class scope when the arrays are static and used in a hot loop.

## 2024-05-24 - Avoiding Higher-Order Array Methods in Hot Loops
**Learning:** Using array iteration methods like `some` and `reduce` in a hot path (such as executing an array of regexes against many strings in `outreachClassifier.js`) incurs significant overhead compared to simple `for` loops, due to anonymous function allocations and callback invocation costs.
**Action:** When working on classification or processing loops that iterate over thousands of objects per run, replace `some`, `reduce`, or `map` with standard `for` loops to minimize CPU cycles and memory allocations.

## 2024-05-18 - [Parallelize Notion updates to fix sequential blocking bottleneck]
**Learning:** Sequential bounded-delay API updates (`await this.request(...)` followed by `await sleep(...)`) inside sequential application automation loops blocks overall progress significantly (N+1 database update problem) even when rate limiting is necessary.
**Action:** Lift the sequential update logic out of the hot loop. Instead, collect the entities inside the loop, and use parallel chunked processing `await Promise.all(chunk.map(...))` at the end to parallelize the sleep-delays safely within rate limits. This achieves near-linear speedups corresponding to the concurrency factor without breaking existing single-update function logic.
