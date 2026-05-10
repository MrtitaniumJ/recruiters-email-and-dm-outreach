## 2024-04-13 - Array Spread inside Hot Loops
**Learning:** In JavaScript, using the array spread operator (`[...arr1, ...arr2]`) inside a frequently called function (like `computeScore` for every connection) causes significant performance overhead due to repeated memory allocations and garbage collection.
**Action:** Always pre-combine arrays and hoist them to the module or class scope when the arrays are static and used in a hot loop.

## 2024-05-24 - Avoiding Higher-Order Array Methods in Hot Loops
**Learning:** Using array iteration methods like `some` and `reduce` in a hot path (such as executing an array of regexes against many strings in `outreachClassifier.js`) incurs significant overhead compared to simple `for` loops, due to anonymous function allocations and callback invocation costs.
**Action:** When working on classification or processing loops that iterate over thousands of objects per run, replace `some`, `reduce`, or `map` with standard `for` loops to minimize CPU cycles and memory allocations.

## 2024-05-24 - Hoisting Arrays Without Changing Semantics
**Learning:** When hoisting regex arrays out of hot loops in puppeteer `page.evaluate` to avoid recreation, there is a risk of inadvertently modifying the regexes themselves (e.g. adding a `$` to an anchor or changing from `/word/` to `/word/`). This happened while hoisting generic url patterns, which changed behavior from 'prefix match' to 'exact string match', breaking valid generic detection.
**Action:** When implementing hoisting optimizations, verify that the static content remains functionally identical to the source.
