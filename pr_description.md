🧹 [Code Health] Fix swallowed promise errors

🎯 What: Replaced empty `.catch(() => {})` blocks with proper error or warning logs (`console.error` and `console.warn`) for tracking and UI interaction promises.
💡 Why: Swallowed promise rejections hide critical failures (like tracking updates failing) and make debugging difficult. Logging the error messages improves observability and maintainability.
✅ Verification: Ran syntax checks (`node -c`) and all unit tests (`npm test`). Verified the changes don't alter the program's control flow.
✨ Result: Tracking errors are now properly logged as errors, and non-critical UI interaction failures are logged as warnings, matching the codebase conventions.
