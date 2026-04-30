## 2024-04-13 - Array Spread inside Hot Loops
**Learning:** In JavaScript, using the array spread operator (`[...arr1, ...arr2]`) inside a frequently called function (like `computeScore` for every connection) causes significant performance overhead due to repeated memory allocations and garbage collection.
**Action:** Always pre-combine arrays and hoist them to the module or class scope when the arrays are static and used in a hot loop.

## 2024-05-24 - Avoiding Higher-Order Array Methods in Hot Loops
**Learning:** Using array iteration methods like `some` and `reduce` in a hot path (such as executing an array of regexes against many strings in `outreachClassifier.js`) incurs significant overhead compared to simple `for` loops, due to anonymous function allocations and callback invocation costs.
**Action:** When working on classification or processing loops that iterate over thousands of objects per run, replace `some`, `reduce`, or `map` with standard `for` loops to minimize CPU cycles and memory allocations.

## 2024-05-25 - DOM Traversal Hot Paths in Puppeteer
**Learning:** Defining static arrays and using higher-order array methods (`.some`, `.find`) inside per-node helper functions within `page.evaluate` blocks causes severe performance degradation when traversing hundreds of DOM nodes. V8 is forced to repeatedly allocate arrays, compile regexes, and create anonymous callback functions.
**Action:** To prevent performance degradation in Puppeteer `page.evaluate` blocks, always hoist static arrays, configurations, and regex compilations to the outermost scope of the block. Avoid allocating them inside per-node helper functions that are called in hot loops (like DOM traversal) to reduce garbage collection and memory allocation overhead. Use standard `for` loops instead of higher-order array methods.
