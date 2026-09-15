---
name: compose-ui
description: Best practices for building UI with Jetpack Compose, focusing on state hoisting, detailed performance optimizations, and theming. Use this when writing or refactoring Composable functions.
---

# Jetpack Compose Best Practices

## Instructions

### 1. State Hoisting (Unidirectional Data Flow)
Make Composables **stateless** whenever possible by moving state to the caller.

```kotlin
@Composable
fun MyComponent(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier
)
```

### 2. Modifiers
*   Always provide `modifier: Modifier = Modifier` as the first optional parameter.
*   Apply to the *root* layout element of your Composable.

### 3. Performance Optimization
*   **`remember`**: Cache expensive calculations across recompositions.
*   **`derivedStateOf`**: Use when state changes frequently but UI only needs threshold reactions.
    ```kotlin
    val showButton by remember {
        derivedStateOf { listState.firstVisibleItemIndex > 0 }
    }
    ```
*   **Lambda Stability**: Prefer method references (`viewModel::onEvent`) or remembered lambdas.

### 4. Theming
*   Use `MaterialTheme.colorScheme` and `MaterialTheme.typography` — never hardcode colors.

### 5. Previews
*   Create a private preview function for every public Composable.
*   Use `@Preview(showBackground = true)` with Light/Dark variants.
