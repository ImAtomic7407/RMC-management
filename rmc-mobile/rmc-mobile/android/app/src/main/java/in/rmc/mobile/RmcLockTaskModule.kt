package `in`.rmc.mobile

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

class RmcLockTaskModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        @Volatile var instance: RmcLockTaskModule? = null
    }

    init {
        instance = this
    }

    private var lockMonitorHandler: Handler? = null
    private var isLockTaskActive = false

    override fun getName(): String = "RmcLockTaskModule"

    // Required by React Native NativeEventEmitter (RN 0.65+)
    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}

    @ReactMethod
    fun startLock() {
        val activity = reactContext.currentActivity ?: run {
            emitLockStarted(false, "No foreground activity")
            return
        }
        activity.runOnUiThread {
            try {
                activity.startLockTask()
                isLockTaskActive = true
                startUnpinMonitor()
                emitLockStarted(true, null)
            } catch (e: Exception) {
                e.printStackTrace()
                isLockTaskActive = false
                emitLockStarted(false, e.message ?: e.javaClass.simpleName)
            }
        }
    }

    private fun emitLockStarted(success: Boolean, error: String?) {
        val p = Arguments.createMap()
        p.putBoolean("success", success)
        if (error != null) p.putString("error", error)
        emitEvent("onLockStarted", p)
    }

    @ReactMethod
    fun stopLock() {
        val activity = reactContext.currentActivity ?: return
        activity.runOnUiThread {
            try {
                isLockTaskActive = false
                lockMonitorHandler?.removeCallbacksAndMessages(null)
                lockMonitorHandler = null
                activity.stopLockTask()
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    @ReactMethod
    fun notifyUnpinned() {
        if (isLockTaskActive && !isSystemInLockTaskMode()) {
            isLockTaskActive = false
            lockMonitorHandler?.removeCallbacksAndMessages(null)
            lockMonitorHandler = null
            emitEvent("onAppUnpinned", null)
        }
    }

    // Screen-off (timeout or power button) is explicitly ignored —
    // isScreenInteractive() returns false in that case.
    @ReactMethod
    fun notifyFocusLost() {
        if (isLockTaskActive && isSystemInLockTaskMode() && isScreenInteractive()) {
            emitEvent("onFocusLost", null)
        }
    }

    private fun isScreenInteractive(): Boolean {
        val pm = reactContext.getSystemService(Context.POWER_SERVICE) as PowerManager
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT_WATCH) {
            pm.isInteractive
        } else {
            @Suppress("DEPRECATION")
            pm.isScreenOn
        }
    }

    private fun startUnpinMonitor() {
        val handler = Handler(Looper.getMainLooper())
        lockMonitorHandler = handler
        val checker = object : Runnable {
            override fun run() {
                if (!isLockTaskActive) return
                if (!isSystemInLockTaskMode()) {
                    isLockTaskActive = false
                    lockMonitorHandler = null
                    emitEvent("onAppUnpinned", null)
                    return
                }
                handler.postDelayed(this, 500)
            }
        }
        handler.postDelayed(checker, 500)
    }

    private fun isSystemInLockTaskMode(): Boolean {
        val am = reactContext.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            am.lockTaskModeState != ActivityManager.LOCK_TASK_MODE_NONE
        } else {
            @Suppress("DEPRECATION")
            am.isInLockTaskMode
        }
    }

    private fun emitEvent(eventName: String, params: Any?) {
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }
}
