/// One touch to send, after waiting `delayMs`. Coordinates are 0.0–1.0 of the screen.
public struct TouchStep: Equatable {
    public enum Phase: Equatable { case down, move, up }
    public enum Edge: Equatable { case none, bottom }

    public var phase: Phase
    public var x: Double
    public var y: Double
    public var edge: Edge
    public var delayMs: Double

    public init(phase: Phase, x: Double, y: Double, edge: Edge, delayMs: Double) {
        self.phase = phase
        self.x = x
        self.y = y
        self.edge = edge
        self.delayMs = delayMs
    }
}

/// Touch sequences for each gesture, independent of the simulator they are sent to.
public enum TouchPlan {
    /// UIKit drops a zero-length tap, so a tap is never held for less than this.
    public static let minimumHoldMs = 16.0
    /// SimulatorKit skips a move sent sooner than about 16 ms after the previous one.
    public static let moveIntervalMs = 17.0
    public static let defaultSwipeMs = 200.0

    private static func clamp(_ value: Double) -> Double { min(1, max(0, value)) }

    public static func tap(x: Double, y: Double, holdMs: Double?) -> [TouchStep] {
        let (x, y) = (clamp(x), clamp(y))
        return [
            TouchStep(phase: .down, x: x, y: y, edge: .none, delayMs: 0),
            TouchStep(phase: .up, x: x, y: y, edge: .none, delayMs: max(holdMs ?? minimumHoldMs, minimumHoldMs)),
        ]
    }

    /// Down, evenly spaced moves to `to` over `durationMs`, then Up.
    public static func swipe(
        from: (Double, Double), to: (Double, Double), durationMs: Double?, edge: TouchStep.Edge = .none
    ) -> [TouchStep] {
        let start = (clamp(from.0), clamp(from.1))
        let end = (clamp(to.0), clamp(to.1))
        let duration = max(durationMs ?? defaultSwipeMs, 0)
        let moves = max(1, Int(duration / moveIntervalMs))
        // At least `moveIntervalMs` apart, and together `durationMs` when that allows.
        let interval = max(duration / Double(moves), moveIntervalMs)
        var steps = [TouchStep(phase: .down, x: start.0, y: start.1, edge: edge, delayMs: 0)]
        for index in 1...moves {
            let progress = Double(index) / Double(moves)
            let last = index == moves
            steps.append(TouchStep(
                phase: .move,
                x: last ? end.0 : start.0 + (end.0 - start.0) * progress,
                y: last ? end.1 : start.1 + (end.1 - start.1) * progress,
                edge: edge,
                delayMs: interval
            ))
        }
        steps.append(TouchStep(phase: .up, x: end.0, y: end.1, edge: edge, delayMs: 0))
        return steps
    }

    /// Home on a Face ID iPhone: a swipe up from the bottom edge. Hardware button messages
    /// are not handled by current simulator runtimes.
    public static func home() -> [TouchStep] {
        swipe(from: (0.5, 0.995), to: (0.5, 0.6), durationMs: 200, edge: .bottom)
    }
}
