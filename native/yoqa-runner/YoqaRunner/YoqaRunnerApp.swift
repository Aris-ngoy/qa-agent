import SwiftUI

/// The host app the UI-test runner is built against. One screen; it never drives anything.
@main
struct YoqaRunnerApp: App {
    var body: some Scene {
        WindowGroup {
            Text("Yoqa Runner")
                .font(.title2)
                .padding()
        }
    }
}
