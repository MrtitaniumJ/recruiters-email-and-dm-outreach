## 2024-04-13 - Array Spread inside Hot Loops
**Learning:** In JavaScript, using the array spread operator (`[...arr1, ...arr2]`) inside a frequently called function (like `computeScore` for every connection) causes significant performance overhead due to repeated memory allocations and garbage collection.
**Action:** Always pre-combine arrays and hoist them to the module or class scope when the arrays are static and used in a hot loop.

## 2024-05-24 - Avoiding Higher-Order Array Methods in Hot Loops
**Learning:** Using array iteration methods like `some` and `reduce` in a hot path (such as executing an array of regexes against many strings in `outreachClassifier.js`) incurs significant overhead compared to simple `for` loops, due to anonymous function allocations and callback invocation costs.
**Action:** When working on classification or processing loops that iterate over thousands of objects per run, replace `some`, `reduce`, or `map` with standard `for` loops to minimize CPU cycles and memory allocations.
## 2026-04-24 - Avoid Manual Array Iteration Micro-Optimizations
**Learning:** Replacing native array methods like `.some()` or `.includes()` with manual `for` loops for micro-optimization is an anti-pattern. Modern JS engines optimize native array methods extremely well. Doing this degrades readability without providing meaningful performance gains and violates the directive not to sacrifice readability for micro-optimizations.
**Action:** Rely on native array methods (`.some()`, `.includes()`, etc.) for array checks instead of writing custom `for` loops, especially when the target arrays are relatively small.

## 2026-04-24 - Hoist Array Transformations Outside Loops
**Learning:** Putting operations that allocate new arrays, like `.map()`, inside loops (such as `forEach` over DOM elements) creates massive overhead by re-allocating memory and processing the array repeatedly for every iteration.
**Action:** Always hoist array transformations and parsing outside of hot loops.
