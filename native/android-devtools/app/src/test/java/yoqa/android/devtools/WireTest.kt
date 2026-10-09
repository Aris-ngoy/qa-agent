package yoqa.android.devtools

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream

class WireTest {
    private val button = TreeNode(
        role = "android.widget.Button",
        label = null,
        value = "Allow \"all\"\n\\ ok",
        id = "com.demo:id/allow",
        x = 0.1, y = 0.5, width = 0.4, height = 0.0625,
        enabled = true,
    )

    private fun exchange(request: String, tree: () -> Tree): String {
        val output = ByteArrayOutputStream()
        serveOne(ByteArrayInputStream(request.toByteArray()), output, tree)
        return output.toString(Charsets.UTF_8.name())
    }

    @Test
    fun treeIsJsonWithEscapedStringsAndFractionalBounds() {
        assertEquals(
            "{\"nodes\":[{\"role\":\"android.widget.Button\",\"value\":\"Allow \\\"all\\\"\\n\\\\ ok\"," +
                "\"id\":\"com.demo:id/allow\",\"bounds\":{\"x\":0.1,\"y\":0.5,\"width\":0.4,\"height\":0.0625}," +
                "\"enabled\":true}],\"degraded\":false}",
            encodeTree(Tree(listOf(button), degraded = false)),
        )
    }

    @Test
    fun theDisplaySizeTravelsWithTheTree() {
        assertEquals(
            "{\"nodes\":[],\"degraded\":false,\"display\":{\"width\":2400,\"height\":1080}}",
            encodeTree(Tree(emptyList(), degraded = false, display = DisplaySize(2400, 1080))),
        )
    }

    @Test
    fun getTreeAnswersWithTheTree() {
        val response = exchange("GET /tree HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n") {
            Tree(listOf(button), degraded = false)
        }
        assertTrue(response, response.startsWith("HTTP/1.1 200 OK\r\n"))
        assertTrue(response, response.contains("Content-Type: application/json"))
        assertTrue(response, response.endsWith(encodeTree(Tree(listOf(button), degraded = false))))
    }

    @Test
    fun anEmptyWindowIsReportedDegraded() {
        val response = exchange("GET /tree HTTP/1.1\r\n\r\n") { Tree(emptyList(), degraded = true) }
        assertTrue(response, response.endsWith("{\"nodes\":[],\"degraded\":true}"))
    }

    @Test
    fun statusAnswersWithoutReadingTheTree() {
        val response = exchange("GET /status HTTP/1.1\r\n\r\n") { error("tree must not be read") }
        assertTrue(response, response.startsWith("HTTP/1.1 200 OK\r\n"))
        assertTrue(response, response.endsWith("{\"ok\":true,\"versionCode\":${HELPER_VERSION_CODE}}"))
    }

    @Test
    fun unknownPathsAre404() {
        val response = exchange("GET /nope HTTP/1.1\r\n\r\n") { error("unused") }
        assertTrue(response, response.startsWith("HTTP/1.1 404 Not Found\r\n"))
    }

    @Test
    fun aFailedTreeReadIs500WithTheReason() {
        val response = exchange("GET /tree HTTP/1.1\r\n\r\n") { error("no UiAutomation") }
        assertTrue(response, response.startsWith("HTTP/1.1 500 Internal Server Error\r\n"))
        assertTrue(response, response.endsWith("{\"error\":\"no UiAutomation\"}"))
    }
}
