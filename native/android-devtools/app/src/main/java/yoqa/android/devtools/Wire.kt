package yoqa.android.devtools

import java.io.BufferedReader
import java.io.InputStream
import java.io.InputStreamReader
import java.io.OutputStream

/** Keep equal to `versionCode` in app/build.gradle.kts; the runner reads it from `GET /status`. */
const val HELPER_VERSION_CODE = 1

/** One node of the foreground window. Bounds are fractions (0.0–1.0) of the display. */
data class TreeNode(
    val role: String,
    /** Content description. */
    val label: String?,
    /** Text. */
    val value: String?,
    /** Resource id. */
    val id: String?,
    val x: Double,
    val y: Double,
    val width: Double,
    val height: Double,
    val enabled: Boolean,
)

/** The display's current size in pixels; it follows rotation, as `uiautomator dump` bounds do. */
data class DisplaySize(val width: Int, val height: Int)

/** The foreground window. `degraded` means no window could be read, so `nodes` is empty. */
data class Tree(val nodes: List<TreeNode>, val degraded: Boolean, val display: DisplaySize? = null)

private fun jsonString(value: String): String {
    val out = StringBuilder("\"")
    for (char in value) {
        when {
            char == '"' -> out.append("\\\"")
            char == '\\' -> out.append("\\\\")
            char == '\n' -> out.append("\\n")
            char == '\r' -> out.append("\\r")
            char == '\t' -> out.append("\\t")
            char < ' ' -> out.append(String.format("\\u%04x", char.code))
            else -> out.append(char)
        }
    }
    return out.append('"').toString()
}

private fun jsonNumber(value: Double): String = if (value.isFinite()) value.toString() else "0"

fun encodeTree(tree: Tree): String {
    val nodes = tree.nodes.joinToString(",") { node ->
        val fields = mutableListOf("\"role\":${jsonString(node.role)}")
        node.label?.let { fields += "\"label\":${jsonString(it)}" }
        node.value?.let { fields += "\"value\":${jsonString(it)}" }
        node.id?.let { fields += "\"id\":${jsonString(it)}" }
        fields += "\"bounds\":{\"x\":${jsonNumber(node.x)},\"y\":${jsonNumber(node.y)}," +
            "\"width\":${jsonNumber(node.width)},\"height\":${jsonNumber(node.height)}}"
        fields += "\"enabled\":${node.enabled}"
        "{${fields.joinToString(",")}}"
    }
    val display = tree.display?.let { ",\"display\":{\"width\":${it.width},\"height\":${it.height}}" } ?: ""
    return "{\"nodes\":[$nodes],\"degraded\":${tree.degraded}$display}"
}

private fun respond(output: OutputStream, status: String, body: String) {
    val bytes = body.toByteArray(Charsets.UTF_8)
    val head = "HTTP/1.1 $status\r\n" +
        "Content-Type: application/json\r\n" +
        "Content-Length: ${bytes.size}\r\n" +
        "Connection: close\r\n\r\n"
    output.write(head.toByteArray(Charsets.US_ASCII))
    output.write(bytes)
    output.flush()
}

/**
 * Answer one HTTP request: `GET /status` or `GET /tree`. The runner reaches this through
 * `adb forward`, one request per connection.
 */
fun serveOne(input: InputStream, output: OutputStream, readTree: () -> Tree) {
    val reader = BufferedReader(InputStreamReader(input, Charsets.US_ASCII))
    val requestLine = reader.readLine() ?: return
    while (true) {
        val header = reader.readLine() ?: break
        if (header.isEmpty()) break
    }
    val path = requestLine.split(" ").getOrNull(1)?.substringBefore('?')
    when (path) {
        "/status" -> respond(output, "200 OK", "{\"ok\":true,\"versionCode\":$HELPER_VERSION_CODE}")
        "/tree" -> {
            val body = try {
                encodeTree(readTree())
            } catch (error: Throwable) {
                respond(output, "500 Internal Server Error", "{\"error\":${jsonString(error.message ?: error.toString())}}")
                return
            }
            respond(output, "200 OK", body)
        }
        else -> respond(output, "404 Not Found", "{\"error\":\"not found\"}")
    }
}
