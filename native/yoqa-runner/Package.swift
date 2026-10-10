// swift-tools-version:5.9
import PackageDescription

// The runner's HTTP core. `YoqaRunner.xcodeproj` compiles these same sources into its UI-test
// bundle on the iPhone; the package builds them for macOS so the wire protocol is tested on the host.
let package = Package(
    name: "yoqa-runner",
    platforms: [.macOS(.v13), .iOS(.v17)],
    targets: [
        .target(name: "YoqaRunnerCore"),
        .testTarget(name: "YoqaRunnerCoreTests", dependencies: ["YoqaRunnerCore"]),
    ]
)
