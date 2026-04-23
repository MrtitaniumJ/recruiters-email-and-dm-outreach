## 2024-04-13 - Array Spread inside Hot Loops
**Learning:** In JavaScript, using the array spread operator (`[...arr1, ...arr2]`) inside a frequently called function (like `computeScore` for every connection) causes significant performance overhead due to repeated memory allocations and garbage collection.
**Action:** Always pre-combine arrays and hoist them to the module or class scope when the arrays are static and used in a hot loop.

## 2024-05-24 - Avoiding Higher-Order Array Methods in Hot Loops
**Learning:** Using array iteration methods like `some` and `reduce` in a hot path (such as executing an array of regexes against many strings in `outreachClassifier.js`) incurs significant overhead compared to simple `for` loops, due to anonymous function allocations and callback invocation costs.
**Action:** When working on classification or processing loops that iterate over thousands of objects per run, replace `some`, `reduce`, or `map` with standard `for` loops to minimize CPU cycles and memory allocations.
## 2026-04-23 - Concurrency for network requests in runJobMatcher
**Learning:** Sequential processing in `runJobMatcher` caused high latency when checking multiple company career pages. Refactoring from a `for...of` loop to concurrent `Promise.all(Array.from().map())` reduces execution time dramatically (from ~1282ms to ~516ms for 50 companies).
**Action:** When making independent network requests, use `Promise.all` with `.map` instead of sequential loops to minimize total latency.
