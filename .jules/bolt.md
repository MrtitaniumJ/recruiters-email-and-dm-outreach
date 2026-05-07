## 2024-04-13 - Array Spread inside Hot Loops
**Learning:** In JavaScript, using the array spread operator (`[...arr1, ...arr2]`) inside a frequently called function (like `computeScore` for every connection) causes significant performance overhead due to repeated memory allocations and garbage collection.
**Action:** Always pre-combine arrays and hoist them to the module or class scope when the arrays are static and used in a hot loop.

## 2024-05-24 - Avoiding Higher-Order Array Methods in Hot Loops
**Learning:** Using array iteration methods like `some` and `reduce` in a hot path (such as executing an array of regexes against many strings in `outreachClassifier.js`) incurs significant overhead compared to simple `for` loops, due to anonymous function allocations and callback invocation costs.
**Action:** When working on classification or processing loops that iterate over thousands of objects per run, replace `some`, `reduce`, or `map` with standard `for` loops to minimize CPU cycles and memory allocations.
## 2026-05-07 - Expensive getComputedStyle in DOM Filtering Loops
**Learning:** In Puppeteer's `page.evaluate` blocks, calling `window.getComputedStyle(element)` on every element returned by `querySelectorAll('*')` forces expensive style recalculations. For operations that only care about scrollable elements, this is massively inefficient as most elements are not physically scrollable.
**Action:** When filtering DOM nodes for scrollability, always short-circuit the filter with a fast geometric property check (like `element.scrollHeight <= element.clientHeight`) before ever calling `getComputedStyle`.
