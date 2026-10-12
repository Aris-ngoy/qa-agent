import SwiftUI

/// The host app the UI-test runner is built against. One screen; it never drives anything.
@main
struct YoqaRunnerApp: App {
    var body: some Scene {
        WindowGroup {
            VStack(spacing: 16) {
                // 22 on 96 approximates the iOS app-icon corner radius.
                Image("Logo")
                    .resizable()
                    .frame(width: 96, height: 96)
                    .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                Text("Yoqa Runner")
                    .font(.title2)
            }
            .padding()
        }
    }
}
