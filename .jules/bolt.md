## 2024-04-13 - Array Spread inside Hot Loops
**Learning:** In JavaScript, using the array spread operator (`[...arr1, ...arr2]`) inside a frequently called function (like `computeScore` for every connection) causes significant performance overhead due to repeated memory allocations and garbage collection.
**Action:** Always pre-combine arrays and hoist them to the module or class scope when the arrays are static and used in a hot loop.

## 2024-05-24 - Avoiding Higher-Order Array Methods in Hot Loops
**Learning:** Using array iteration methods like `some` and `reduce` in a hot path (such as executing an array of regexes against many strings in `outreachClassifier.js`) incurs significant overhead compared to simple `for` loops, due to anonymous function allocations and callback invocation costs.
**Action:** When working on classification or processing loops that iterate over thousands of objects per run, replace `some`, `reduce`, or `map` with standard `for` loops to minimize CPU cycles and memory allocations.

## 2026-04-29 - getComputedStyle Optimization in DOM Queries
**Learning:** Calling `window.getComputedStyle()` during DOM node filtering (e.g., inside `querySelectorAll('*').filter()`) triggers massive reflow overhead. Checking simple geometric properties (like `scrollHeight > clientHeight`) *after* computing style causes significant performance issues in large pages.
**Action:** Always perform fast geometric property checks (like `scrollHeight > clientHeight`) before invoking expensive methods like `window.getComputedStyle(element)` to avoid unnecessary reflows.
