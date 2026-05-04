## 2024-04-13 - Array Spread inside Hot Loops
**Learning:** In JavaScript, using the array spread operator (`[...arr1, ...arr2]`) inside a frequently called function (like `computeScore` for every connection) causes significant performance overhead due to repeated memory allocations and garbage collection.
**Action:** Always pre-combine arrays and hoist them to the module or class scope when the arrays are static and used in a hot loop.

## 2024-05-24 - Avoiding Higher-Order Array Methods in Hot Loops
**Learning:** Using array iteration methods like `some` and `reduce` in a hot path (such as executing an array of regexes against many strings in `outreachClassifier.js`) incurs significant overhead compared to simple `for` loops, due to anonymous function allocations and callback invocation costs.
**Action:** When working on classification or processing loops that iterate over thousands of objects per run, replace `some`, `reduce`, or `map` with standard `for` loops to minimize CPU cycles and memory allocations.
## 2024-05-25 - Hoisting Static Arrays out of Puppeteer `page.evaluate` Hot Loops
**Learning:** In Puppeteer `page.evaluate` blocks, nesting static configurations (like arrays of regex patterns) inside helper functions that are called recursively or in loops over large DOM node lists causes severe performance degradation due to repeated array allocation and garbage collection.
**Action:** To prevent performance degradation in Puppeteer `page.evaluate` blocks, always hoist static arrays, configurations, and regex compilations to the outermost scope of the block. Avoid allocating them inside per-node helper functions that are called in hot loops (like DOM traversal) to reduce garbage collection and memory allocation overhead.
