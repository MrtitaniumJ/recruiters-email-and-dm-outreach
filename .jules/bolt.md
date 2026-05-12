## 2024-04-13 - Array Spread inside Hot Loops
**Learning:** In JavaScript, using the array spread operator (`[...arr1, ...arr2]`) inside a frequently called function (like `computeScore` for every connection) causes significant performance overhead due to repeated memory allocations and garbage collection.
**Action:** Always pre-combine arrays and hoist them to the module or class scope when the arrays are static and used in a hot loop.

## 2024-05-24 - Avoiding Higher-Order Array Methods in Hot Loops
**Learning:** Using array iteration methods like `some` and `reduce` in a hot path (such as executing an array of regexes against many strings in `outreachClassifier.js`) incurs significant overhead compared to simple `for` loops, due to anonymous function allocations and callback invocation costs.
**Action:** When working on classification or processing loops that iterate over thousands of objects per run, replace `some`, `reduce`, or `map` with standard `for` loops to minimize CPU cycles and memory allocations.

## 2024-05-25 - Puppeteer page.evaluate Array Allocations
**Learning:** Allocating large arrays or compiling regexes inside helper functions defined within a Puppeteer `page.evaluate` block can cause severe performance degradation when those helpers are invoked in a hot loop (like traversing every DOM node). This forces the browser's JavaScript engine to repeatedly allocate memory and trigger garbage collection on the main thread.
**Action:** Always hoist static arrays, configurations, and regex compilations to the outermost scope of the `page.evaluate` block so they are initialized only once per page context.
