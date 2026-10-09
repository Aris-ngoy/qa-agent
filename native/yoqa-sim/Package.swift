// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "yoqa-sim",
    platforms: [.macOS(.v13)],
    targets: [
        // The private CoreSimulator / SimulatorKit calls, loaded at run time from the active Xcode.
        .target(
            name: "SimBridge",
            linkerSettings: [.linkedFramework("IOSurface"), .linkedFramework("AppKit")]
        ),
        .target(name: "YoqaSimCore"),
        .executableTarget(name: "yoqa-sim", dependencies: ["YoqaSimCore", "SimBridge"]),
        .testTarget(name: "YoqaSimCoreTests", dependencies: ["YoqaSimCore", "yoqa-sim"]),
    ]
)
