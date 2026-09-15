---
name: compose-performance-audit
description: Audit and improve Jetpack Compose runtime performance. Use when diagnosing slow rendering, janky scrolling, excessive recompositions, or performance issues.
---

# Compose Performance Audit

## Common Code Smells

### Unstable lambda captures
```kotlin
// BAD: New lambda every recomposition
Button(onClick = { viewModel.doSomething(item) }) { ... }

// GOOD: remember or method reference
val onClick = remember(item) { { viewModel.doSomething(item) } }
Button(onClick = onClick) { ... }
```

### Expensive work in composition
```kotlin
// BAD: Sorting on every recomposition
val sorted = items.sortedBy { it.name }

// GOOD: Cache with remember
val sorted = remember(items) { items.sortedBy { it.name } }
```

### Missing keys in LazyColumn
```kotlin
// BAD: Index-based identity
LazyColumn { items(items) { item -> ItemRow(item) } }

// GOOD: Stable key
LazyColumn { items(items, key = { it.id }) { item -> ItemRow(item) } }
```

### Unstable data classes
```kotlin
// BAD: List is not stable
data class UiState(val items: List<Item>)

// GOOD: Annotate or use ImmutableList
@Immutable
data class UiState(val items: ImmutableList<Item>)
```

### State read too early
```kotlin
// BAD: Recomposes whole tree on every scroll
val offset = scrollState.value
Box(modifier = Modifier.offset(y = offset.dp)) { ... }

// GOOD: Defer read to layout phase
Box(modifier = Modifier.offset { IntOffset(0, scrollState.value) }) { ... }
```

## Stability Table

| Type | Stable? | Fix |
|------|---------|-----|
| Primitives | Yes | N/A |
| `data class` (stable fields) | Yes | Ensure all fields stable |
| `List`, `Map`, `Set` | **No** | Use `ImmutableList` |
| Classes with `var` | **No** | Use `@Stable` |
| Lambdas | **No** | `remember { }` |

## Profiling Tools
- **Layout Inspector**: See recomposition counts in Android Studio.
- **Perfetto/System Trace**: Frame timing analysis.
- Always profile on **release build** with R8 — debug builds have 10x overhead.
