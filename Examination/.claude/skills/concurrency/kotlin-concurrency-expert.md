---
name: kotlin-concurrency-expert
description: Kotlin Coroutines review and remediation for Android. Use when asked to review concurrency usage, fix coroutine-related bugs, improve thread safety, or resolve lifecycle issues in Kotlin/Android code.
---

# Kotlin Concurrency Expert

## Critical Rules

### Dispatcher Injection (Testability)
```kotlin
// CORRECT
class UserRepository(private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO) {
    suspend fun fetchUser() = withContext(ioDispatcher) { ... }
}
```

### Lifecycle-Aware Collection
```kotlin
// CORRECT
viewLifecycleOwner.lifecycleScope.launch {
    viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
        viewModel.uiState.collect { state -> updateUI(state) }
    }
}
// INCORRECT: launchWhenStarted is deprecated
```

### State Encapsulation
```kotlin
class MyViewModel : ViewModel() {
    private val _uiState = MutableStateFlow(UiState())
    val uiState: StateFlow<UiState> = _uiState.asStateFlow() // Expose read-only
}
```

### Exception Handling — Always rethrow CancellationException
```kotlin
try {
    doSuspendWork()
} catch (e: CancellationException) {
    throw e // MUST rethrow!
} catch (e: Exception) {
    handleError(e)
}
```

### Cooperative Cancellation
```kotlin
suspend fun processLargeList(items: List<Item>) {
    items.forEach { item ->
        ensureActive() // Check cancellation in tight loops
        processItem(item)
    }
}
```

### Callback Conversion
```kotlin
fun locationUpdates(): Flow<Location> = callbackFlow {
    val listener = LocationListener { location -> trySend(location) }
    locationManager.requestLocationUpdates(listener)
    awaitClose { locationManager.removeUpdates(listener) }
}
```

## Scope Guidelines

| Scope | Use When |
|-------|----------|
| `viewModelScope` | ViewModel operations |
| `lifecycleScope` | UI operations in Activity/Fragment |
| `repeatOnLifecycle` | Flow collection in UI |
| `GlobalScope` | **NEVER USE** |

## Common Fixes

- **ANR**: Move heavy work to `withContext(Dispatchers.IO)`.
- **Memory leaks**: Replace `GlobalScope` with `viewModelScope` or `lifecycleScope`.
- **Lifecycle issues**: Replace `launchWhenStarted` with `repeatOnLifecycle`.
- **Race conditions**: Use `MutableStateFlow.update { }` for atomic updates.
