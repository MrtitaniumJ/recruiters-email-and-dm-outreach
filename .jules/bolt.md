## 2024-04-13 - Array Spread inside Hot Loops
**Learning:** In JavaScript, using the array spread operator (`[...arr1, ...arr2]`) inside a frequently called function (like `computeScore` for every connection) causes significant performance overhead due to repeated memory allocations and garbage collection.
**Action:** Always pre-combine arrays and hoist them to the module or class scope when the arrays are static and used in a hot loop.

## 2024-05-24 - Avoiding Higher-Order Array Methods in Hot Loops
**Learning:** Using array iteration methods like `some` and `reduce` in a hot path (such as executing an array of regexes against many strings in `outreachClassifier.js`) incurs significant overhead compared to simple `for` loops, due to anonymous function allocations and callback invocation costs.
**Action:** When working on classification or processing loops that iterate over thousands of objects per run, replace `some`, `reduce`, or `map` with standard `for` loops to minimize CPU cycles and memory allocations.

## 2024-05-25 - Puppeteer page.evaluate Higher Order Array Methods
**Learning:** Running higher order array methods (like `.map`, `.filter`, `.forEach`, `.slice`) inside DOM node traversal loops within Puppeteer`s `page.evaluate` context incurs massive CPU and memory overhead due to repeated allocation of anonymous functions and temporary arrays. Recompiling literal regexes on every iteration multiplies this penalty.
**Action:** Always hoist static regexes and variables outside of the per-node loop logic. Replace `.filter`, `.map`, and `.forEach` inside hot paths with basic `for` loops, minimizing temporary array allocations to improve browser performance.
