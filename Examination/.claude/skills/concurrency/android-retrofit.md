---
name: android-retrofit
description: Expert guidance on setting up and using Retrofit for type-safe HTTP networking in Android. Covers service definitions, coroutines, OkHttp configuration, and Hilt integration.
---

# Android Networking with Retrofit

### Service Definition
```kotlin
interface ExamApi {
    @GET("exams/{examId}")
    suspend fun getExam(@Path("examId") examId: Long): ExamDto

    @POST("student/exams/{examId}/start")
    suspend fun startAttempt(
        @Path("examId") examId: Long,
        @Body request: StartAttemptRequest
    ): StartAttemptResponse

    @PUT("attempts/{attemptId}/answers")
    suspend fun saveAnswer(
        @Path("attemptId") attemptId: Long,
        @Body answer: SaveAnswerRequest
    ): SaveAnswerResponse
}
```

### Hilt Network Module
```kotlin
@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {
    @Provides @Singleton
    fun provideOkHttpClient(sessionStore: SessionStore): OkHttpClient =
        OkHttpClient.Builder()
            .addInterceptor { chain ->
                val token = sessionStore.getToken()
                val request = if (token != null) {
                    chain.request().newBuilder()
                        .addHeader("Authorization", "Bearer $token")
                        .build()
                } else chain.request()
                chain.proceed(request)
            }
            .connectTimeout(30, TimeUnit.SECONDS)
            .build()

    @Provides @Singleton
    fun provideRetrofit(client: OkHttpClient): Retrofit = Retrofit.Builder()
        .baseUrl(BuildConfig.API_BASE_URL)
        .client(client)
        .addConverterFactory(GsonConverterFactory.create())
        .build()
}
```

### Repository Error Handling
```kotlin
class ExamRepository @Inject constructor(private val api: ExamApi) {
    suspend fun getExam(examId: Long): Result<ExamDto> = runCatching {
        api.getExam(examId)
    }
}
```

### Checklist
- [ ] All network calls use `suspend` functions.
- [ ] Auth token injected via OkHttp `Interceptor`, not per-call.
- [ ] Map API DTOs to domain models in repository.
- [ ] `connectTimeout` and `readTimeout` always set.
