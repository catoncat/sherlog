## 2025-02-18 - Avoid array spreading inside double traversal
**Learning:** Found a performance bottleneck where `[...messages].reverse().find(...)` was used twice. This does unnecessary array allocations and double-pass array traversal.
**Action:** Replace multiple reverse searches by spreading array with a single reverse loop (`for (let i = arr.length - 1; i >= 0; i--)`), which avoids array allocations completely and allows early returns in O(1) memory.
## 2023-10-27 - Date parsing overhead in sort loops
**Learning:** Found that using `Date.parse(isoString)` inside `Array.prototype.sort()` callbacks is highly inefficient. Since ISO 8601 string formatting preserves lexicographical order for dates and times, parsing dates over and over again for comparisons is pure overhead.
**Action:** Use direct string comparisons (`>` and `<`) for ISO 8601 strings, especially in loops and sorts. It is approximately 40x faster and requires zero memory allocations.
## 2025-02-18 - Avoid array allocations via string.split() and filter() for simple existence checks
**Learning:** Found that using `query.trim().split(/\s+/).filter(Boolean).length >= 2` to test if a string contains multiple tokens is unnecessarily slow because it allocates an array for the split and another for the filter, taking ~78ms per 100k ops instead of ~8.5ms for a direct regex match.
**Action:** When doing simple existence checks (like "does this string have at least two words?"), use `/\s/.test(trimmedString)` instead of splitting and filtering. It operates without array allocations and is approximately 10x faster.
