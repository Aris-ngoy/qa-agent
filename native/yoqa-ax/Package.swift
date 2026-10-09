// swift-tools-version:5.9
import PackageDescription

// Built for the iOS simulator (`simctl spawn` runs it inside one); the core also builds for
// macOS so its tests and the binary's wire-protocol tests run on the host.
let package = Package(
    name: "yoqa-ax",
    platforms: [.macOS(.v13), .iOS(.v17)],
    targets: [
        .target(name: "YoqaAxCore"),
        .executableTarget(name: "yoqa-ax", dependencies: ["YoqaAxCore"]),
        .testTarget(name: "YoqaAxCoreTests", dependencies: ["YoqaAxCore", "yoqa-ax"]),
    ]
)
