import CoreGraphics
import XCTest
@testable import YoqaSimCore

/// Frames drawn in one flat shade, standing in for the simulator framebuffer.
final class ShadeSource: FrameSource {
    var shade: CGFloat = 1
    private(set) var reads = 0

    func currentImage() -> CGImage? {
        reads += 1
        let context = CGContext(data: nil, width: 40, height: 80, bitsPerComponent: 8, bytesPerRow: 0,
                                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue)!
        context.setFillColor(CGColor(red: shade, green: shade, blue: shade, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: 40, height: 80))
        return context.makeImage()
    }
}

final class FrameStoreTests: XCTestCase {
    func testServesTheLatestFrameWithoutReadingAgainUntilANewOneArrives() throws {
        let source = ShadeSource()
        let store = FrameStore(source: source)
        let first = try XCTUnwrap(store.frame(scale: 1, format: .png))
        let again = try XCTUnwrap(store.frame(scale: 1, format: .png))
        XCTAssertEqual(source.reads, 1)
        XCTAssertEqual(again.data, first.data)
        XCTAssertEqual(again.sequence, first.sequence)
        XCTAssertEqual(Array(first.data.prefix(4)), [0x89, 0x50, 0x4E, 0x47])
    }

    func testTheHashFollowsThePixels() throws {
        let source = ShadeSource()
        let store = FrameStore(source: source)
        let white = try XCTUnwrap(store.frame(scale: 1, format: .png))

        store.frameArrived()
        let sameWhite = try XCTUnwrap(store.frame(scale: 0.25, format: .jpeg))
        XCTAssertEqual(sameWhite.hash, white.hash, "an unchanged screen keeps its hash")
        XCTAssertGreaterThan(sameWhite.sequence, white.sequence)

        source.shade = 0
        store.frameArrived()
        let black = try XCTUnwrap(store.frame(scale: 1, format: .png))
        XCTAssertNotEqual(black.hash, white.hash)
    }

    func testAFormatReadRecentlyIsReadyWhenTheNextFrameArrives() throws {
        let source = ShadeSource()
        let store = FrameStore(source: source)
        _ = store.frame(scale: 1, format: .png)
        source.shade = 0
        store.frameArrived()
        store.waitUntilWarm()
        let readsBefore = source.reads

        let black = try XCTUnwrap(store.frame(scale: 1, format: .png))
        _ = store.frame(scale: FrameStore.preview.scale, format: FrameStore.preview.format)

        XCTAssertEqual(source.reads, readsBefore, "both were encoded before anyone asked")
        XCTAssertGreaterThan(black.sequence, 1)
    }

    func testScaleAndFormat() throws {
        let store = FrameStore(source: ShadeSource())
        let quarter = try XCTUnwrap(store.frame(scale: 0.25, format: .jpeg))
        XCTAssertEqual(Array(quarter.data.prefix(2)), [0xFF, 0xD8])
        let image = try XCTUnwrap(CGImageSourceCreateImageAtIndex(CGImageSourceCreateWithData(quarter.data as CFData, nil)!, 0, nil))
        XCTAssertEqual([image.width, image.height], [10, 20])
    }

    func testNoFramebufferIsNoFrame() {
        final class Empty: FrameSource { func currentImage() -> CGImage? { nil } }
        XCTAssertNil(FrameStore(source: Empty()).frame(scale: 1, format: .png))
    }
}
