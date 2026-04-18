## 2024-04-13 - Array Spread inside Hot Loops
**Learning:** In JavaScript, using the array spread operator (`[...arr1, ...arr2]`) inside a frequently called function (like `computeScore` for every connection) causes significant performance overhead due to repeated memory allocations and garbage collection.
**Action:** Always pre-combine arrays and hoist them to the module or class scope when the arrays are static and used in a hot loop.

## 2024-05-24 - Avoiding Higher-Order Array Methods in Hot Loops
**Learning:** Using array iteration methods like `some` and `reduce` in a hot path (such as executing an array of regexes against many strings in `outreachClassifier.js`) incurs significant overhead compared to simple `for` loops, due to anonymous function allocations and callback invocation costs.
**Action:** When working on classification or processing loops that iterate over thousands of objects per run, replace `some`, `reduce`, or `map` with standard `for` loops to minimize CPU cycles and memory allocations.

## 2024-04-18 - Hoisting Regex in Puppeteer Evaluated Functions
**Learning:** In hot loops within `page.evaluate` blocks (like DOM traversal scripts fetching connection cards), creating literal inline regexes (e.g., `/^message$/i.test()`) forces repeated regex compilation and garbage allocation overhead within the headless browser context, creating a specific bottleneck.
**Action:** Always hoist static regex definitions (and static configuration arrays) to the outermost scope of the `page.evaluate` block before running the DOM traversal loops to reduce memory allocation inside the browser.
