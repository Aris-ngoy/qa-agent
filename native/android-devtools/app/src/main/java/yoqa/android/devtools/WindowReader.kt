package yoqa.android.devtools

import android.accessibilityservice.AccessibilityServiceInfo
import android.app.UiAutomation
import android.graphics.Point
import android.graphics.Rect
import android.os.SystemClock
import android.view.Display
import android.view.accessibility.AccessibilityNodeInfo

/**
 * Reads the active window the way `uiautomator dump` does: nodes visible to the user, in
 * depth-first order, with bounds clipped to the display, including views not marked
 * important for accessibility.
 */
class WindowReader(private val uiAutomation: UiAutomation, private val display: Display) {
    init {
        val info = uiAutomation.serviceInfo
        info.flags = info.flags or
            AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS or
            AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS
        uiAutomation.serviceInfo = info
    }

    fun read(): Tree {
        val root = activeRoot() ?: return Tree(emptyList(), degraded = true)
        val size = Point()
        @Suppress("DEPRECATION")
        display.getRealSize(size)
        if (size.x <= 0 || size.y <= 0) return Tree(emptyList(), degraded = true)
        val nodes = mutableListOf<TreeNode>()
        walk(root, Rect(0, 0, size.x, size.y), size, nodes)
        return Tree(nodes, degraded = false, display = DisplaySize(size.x, size.y))
    }

    /** The active window's root; it can be briefly missing while a window changes. */
    private fun activeRoot(): AccessibilityNodeInfo? {
        val deadline = SystemClock.uptimeMillis() + ROOT_WAIT_MS
        while (true) {
            uiAutomation.rootInActiveWindow?.let { return it }
            if (SystemClock.uptimeMillis() >= deadline) return null
            SystemClock.sleep(20)
        }
    }

    private fun walk(node: AccessibilityNodeInfo, display: Rect, size: Point, out: MutableList<TreeNode>) {
        val bounds = Rect()
        node.getBoundsInScreen(bounds)
        if (!bounds.intersect(display)) bounds.setEmpty()
        out += TreeNode(
            role = node.className?.toString() ?: "android.view.View",
            label = node.contentDescription?.toString()?.takeIf { it.isNotEmpty() },
            value = node.text?.toString()?.takeIf { it.isNotEmpty() },
            id = node.viewIdResourceName?.takeIf { it.isNotEmpty() },
            x = bounds.left.toDouble() / size.x,
            y = bounds.top.toDouble() / size.y,
            width = bounds.width().toDouble() / size.x,
            height = bounds.height().toDouble() / size.y,
            enabled = node.isEnabled,
        )
        for (index in 0 until node.childCount) {
            val child = node.getChild(index) ?: continue
            if (child.isVisibleToUser) walk(child, display, size, out)
        }
    }

    private companion object {
        const val ROOT_WAIT_MS = 500L
    }
}
