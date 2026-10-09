import CoreImage
import IOSurface
import SimBridge
import YoqaSimCore

/// Wraps the booted simulator for the core: touch input and framebuffer frames.
final class SimulatorDevice: TouchDevice, FrameSource {
    private let simulator: YSSimulator
    private let context = CIContext(options: [.cacheIntermediates: false])

    init(_ simulator: YSSimulator) {
        self.simulator = simulator
    }

    var pixelSize: CGSize { simulator.pixelSize }
    var pointScale: Double { simulator.pointScale }

    func send(_ step: TouchStep) throws {
        let phase: YSTouchPhase = switch step.phase {
        case .down: .down
        case .move: .move
        case .up: .up
        }
        try simulator.touch(phase, x: step.x, y: step.y, edge: step.edge == .bottom ? .bottom : .none)
    }

    func currentImage() -> CGImage? {
        guard let surface = simulator.copyFramebuffer() else { return nil }
        // Hold the surface still while it is copied, so a frame never tears.
        IOSurfaceLock(surface, .readOnly, nil)
        defer { IOSurfaceUnlock(surface, .readOnly, nil) }
        let image = CIImage(ioSurface: surface)
        return context.createCGImage(image, from: image.extent)
    }
}
