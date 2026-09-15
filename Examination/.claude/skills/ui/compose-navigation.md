---
name: compose-navigation
description: Implement navigation in Jetpack Compose using Navigation Compose. Use when asked to set up navigation, pass arguments between screens, handle deep links, or structure multi-screen apps.
---

# Compose Navigation

## Setup

```kotlin
dependencies {
    implementation("androidx.navigation:navigation-compose:2.8.5")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
}
plugins { kotlin("plugin.serialization") version "2.0.21" }
```

## Type-Safe Routes

```kotlin
@Serializable object Home
@Serializable data class Profile(val userId: String)
@Serializable data class Settings(val section: String? = null)
```

## NavHost

```kotlin
NavHost(navController, startDestination = Home) {
    composable<Home> { HomeScreen(onNavigateToProfile = { navController.navigate(Profile(it)) }) }
    composable<Profile> { backStackEntry ->
        val profile: Profile = backStackEntry.toRoute()
        ProfileScreen(userId = profile.userId)
    }
}
```

## Navigation Patterns

```kotlin
// Navigate forward
navController.navigate(Profile(userId = "user123"))
// Navigate and clear back stack
navController.navigate(Home) { popUpTo<Home> { inclusive = true } }
// Back
navController.popBackStack()
```

## ViewModel Argument Access

```kotlin
@HiltViewModel
class ProfileViewModel @Inject constructor(savedStateHandle: SavedStateHandle) : ViewModel() {
    private val profile: Profile = savedStateHandle.toRoute<Profile>()
}
```

## Critical Rules

- Use `@Serializable` routes — never string-based routes.
- Pass only IDs/primitives as arguments, never complex objects.
- Use `popUpTo` + `launchSingleTop` for bottom navigation.
- Use `FLAG_IMMUTABLE` for PendingIntents (Android 12+).
