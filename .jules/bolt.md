## 2024-04-13 - Array Spread inside Hot Loops
**Learning:** In JavaScript, using the array spread operator (`[...arr1, ...arr2]`) inside a frequently called function (like `computeScore` for every connection) causes significant performance overhead due to repeated memory allocations and garbage collection.
**Action:** Always pre-combine arrays and hoist them to the module or class scope when the arrays are static and used in a hot loop.

## 2024-05-24 - Avoiding Higher-Order Array Methods in Hot Loops
**Learning:** Using array iteration methods like `some` and `reduce` in a hot path (such as executing an array of regexes against many strings in `outreachClassifier.js`) incurs significant overhead compared to simple `for` loops, due to anonymous function allocations and callback invocation costs.
**Action:** When working on classification or processing loops that iterate over thousands of objects per run, replace `some`, `reduce`, or `map` with standard `for` loops to minimize CPU cycles and memory allocations.

## 2024-05-24 - Avoiding Expensive getComputedStyle in Large DOM Traversals
**Learning:** Calling `window.getComputedStyle(element)` on every DOM node (`document.querySelectorAll('*')`) to find scrollable elements blocks the main thread severely, especially on complex pages like LinkedIn with thousands of nodes. Array allocation methods like `Array.from().filter().sort()` further add garbage collection overhead in hot Puppeteer `page.evaluate` blocks.
**Action:** When searching for specific layout or style properties across all DOM nodes, always perform fast geometric checks (like `scrollHeight > clientHeight`) *before* invoking expensive style methods. Use standard `for` loops without large array allocations to reduce overhead.
