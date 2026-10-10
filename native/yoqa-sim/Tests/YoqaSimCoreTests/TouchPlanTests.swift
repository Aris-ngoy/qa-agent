import XCTest
@testable import YoqaSimCore

final class TouchPlanTests: XCTestCase {
    func testTapIsDownHoldUpWithA16msDefault() {
        XCTAssertEqual(TouchPlan.tap(x: 0.25, y: 0.5, holdMs: nil), [
            TouchStep(phase: .down, x: 0.25, y: 0.5, edge: .none, delayMs: 0),
            TouchStep(phase: .up, x: 0.25, y: 0.5, edge: .none, delayMs: 16),
        ])
    }

    func testZeroLengthTapsAreNeverSent() {
        for hold in [0.0, -5, 3] {
            XCTAssertEqual(TouchPlan.tap(x: 0.5, y: 0.5, holdMs: hold).last?.delayMs, 16, "holdMs \(hold)")
        }
        XCTAssertEqual(TouchPlan.tap(x: 0.5, y: 0.5, holdMs: 600).last?.delayMs, 600)
    }

    func testCoordinatesAreClampedToTheScreen() {
        XCTAssertEqual(TouchPlan.tap(x: -0.2, y: 1.4, holdMs: nil).first, TouchStep(phase: .down, x: 0, y: 1, edge: .none, delayMs: 0))
    }

    func testSwipeMovesInStepsSimulatorKitAccepts() {
        let plan = TouchPlan.swipe(from: (0.5, 0.9), to: (0.5, 0.1), durationMs: 200)
        XCTAssertEqual(plan.first, TouchStep(phase: .down, x: 0.5, y: 0.9, edge: .none, delayMs: 0))
        XCTAssertEqual(plan.last, TouchStep(phase: .up, x: 0.5, y: 0.1, edge: .none, delayMs: 0))
        let moves = plan.filter { $0.phase == .move }
        XCTAssertEqual(moves.count, 11)
        XCTAssertTrue(moves.allSatisfy { $0.delayMs >= 17 }, "\(moves.map(\.delayMs))")
        XCTAssertEqual(moves.last.map { [$0.x, $0.y] }, [0.5, 0.1])
        XCTAssertEqual(moves.map(\.delayMs).reduce(0, +), 200, accuracy: 0.001)
    }

    func testAShortSwipeStillMovesOnce() {
        XCTAssertEqual(TouchPlan.swipe(from: (0, 0), to: (1, 1), durationMs: 0).filter { $0.phase == .move }.count, 1)
    }

    func testHomeIsASwipeUpFromTheBottomEdge() {
        let plan = TouchPlan.home()
        XCTAssertTrue(plan.allSatisfy { $0.edge == .bottom })
        XCTAssertEqual(plan.first?.phase, .down)
        XCTAssertGreaterThan(plan.first?.y ?? 0, 0.99)
        XCTAssertLessThan(plan.last?.y ?? 1, 0.7)
    }
}
