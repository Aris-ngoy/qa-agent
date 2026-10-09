// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "yoqa-sim",
    platforms: [.macOS(.v13)],
    targets: [
        .target(name: "YoqaSimCore"),
        .executableTarget(name: "yoqa-sim", dependencies: ["YoqaSimCore"]),
        .testTarget(name: "YoqaSimCoreTests", dependencies: ["YoqaSimCore", "yoqa-sim"]),
    ]
)
