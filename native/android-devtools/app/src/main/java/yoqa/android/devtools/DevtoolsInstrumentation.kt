package yoqa.android.devtools

import android.app.Instrumentation
import android.app.UiAutomation
import android.content.Context
import android.hardware.display.DisplayManager
import android.os.Bundle
import android.util.Log
import android.view.Display
import java.net.InetAddress
import java.net.ServerSocket

/**
 * Started by the runner with
 * `am instrument -w -e port 7421 yoqa.android.devtools/.DevtoolsInstrumentation`.
 * It serves `GET /status` and `GET /tree` on the device's loopback until the runner
 * force-stops the package, which also releases the UiAutomation connection.
 */
class DevtoolsInstrumentation : Instrumentation() {
    private var port = DEFAULT_PORT

    override fun onCreate(arguments: Bundle?) {
        super.onCreate(arguments)
        port = arguments?.getString("port")?.toIntOrNull() ?: DEFAULT_PORT
        start()
    }

    override fun onStart() {
        super.onStart()
        val uiAutomation = getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES)
        val displays = context.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
        val reader = WindowReader(uiAutomation, displays.getDisplay(Display.DEFAULT_DISPLAY))
        try {
            ServerSocket(port, BACKLOG, InetAddress.getLoopbackAddress()).use { server ->
                Log.i(TAG, "listening on 127.0.0.1:$port")
                while (true) {
                    server.accept().use { socket ->
                        try {
                            serveOne(socket.getInputStream(), socket.getOutputStream(), reader::read)
                        } catch (error: Exception) {
                            Log.w(TAG, "request failed", error)
                        }
                    }
                }
            }
        } catch (error: Exception) {
            Log.e(TAG, "server stopped", error)
            finish(1, Bundle().apply { putString("error", error.toString()) })
        }
    }

    private companion object {
        const val TAG = "YoqaDevtools"
        const val DEFAULT_PORT = 7421
        const val BACKLOG = 8
    }
}
