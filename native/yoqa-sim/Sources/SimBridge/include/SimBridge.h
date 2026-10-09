#import <Foundation/Foundation.h>
#import <IOSurface/IOSurface.h>

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, YSTouchPhase) {
    YSTouchPhaseDown,
    YSTouchPhaseMove,
    YSTouchPhaseUp,
};

/// Which screen edge a touch starts from. A swipe up from the bottom edge is Home.
typedef NS_ENUM(NSUInteger, YSEdge) {
    YSEdgeNone = 0,
    YSEdgeBottom = 3,
};

/// One booted simulator, driven through CoreSimulator and SimulatorKit: its main display's
/// framebuffer and the Indigo HID touch channel Simulator.app uses.
@interface YSSimulator : NSObject

/// Loads CoreSimulator and the SimulatorKit at `simulatorKitPath`, then finds the booted
/// device. Fails when either framework is missing, the device is not booted, or it has no
/// display or HID channel.
+ (nullable instancetype)simulatorWithUDID:(NSString *)udid
                                 deviceSet:(nullable NSString *)deviceSet
                              developerDir:(NSString *)developerDir
                              simulatorKit:(NSString *)simulatorKitPath
                                     error:(NSError **)error;

/// The main display in pixels.
@property (nonatomic, readonly) CGSize pixelSize;
/// Pixels per point, from the device type.
@property (nonatomic, readonly) double pointScale;

/// Sends one touch at `x`, `y` (0.0–1.0 of the screen) and waits until it is delivered.
/// A move sent sooner than SimulatorKit accepts (about 16 ms after the last) is skipped.
- (BOOL)touch:(YSTouchPhase)phase x:(double)x y:(double)y edge:(YSEdge)edge error:(NSError **)error;

/// The current framebuffer, retained, or NULL when the display has none.
- (nullable IOSurfaceRef)copyFramebuffer CF_RETURNS_RETAINED;

/// Calls `onFrame` on a background queue each time the display draws a new frame.
- (void)observeFrames:(void (^)(void))onFrame;

@end

NS_ASSUME_NONNULL_END
