#import "SimBridge.h"
#import <AppKit/AppKit.h>
#import <dlfcn.h>
#import <objc/message.h>

// Reverse-engineered from SimulatorKit (Xcode 27). Builds an Indigo HID touch message for a
// point given as a fraction of the screen (when size is 1x1). Target 0x32 is the touchscreen.
typedef void *(*YSIndigoMouseMessage)(CGPoint *point, CGPoint *secondPoint, uint32_t target,
                                      NSEventType type, NSUInteger edge, double width, double height);
static const uint32_t YSIndigoTouchTarget = 0x32;
static const NSUInteger YSDeviceStateBooted = 3;
static const int64_t YSSendTimeoutNanos = 1 * NSEC_PER_SEC;

#define YS_SEND(Type, ...) ((Type)objc_msgSend)(__VA_ARGS__)

static NSError *YSError(NSString *format, ...) NS_FORMAT_FUNCTION(1, 2);
static NSError *YSError(NSString *format, ...) {
    va_list args;
    va_start(args, format);
    NSString *message = [[NSString alloc] initWithFormat:format arguments:args];
    va_end(args);
    return [NSError errorWithDomain:@"yoqa-sim" code:1 userInfo:@{NSLocalizedDescriptionKey: message}];
}

static id YSCall(id target, NSString *selector) {
    SEL sel = NSSelectorFromString(selector);
    return [target respondsToSelector:sel] ? YS_SEND(id (*)(id, SEL), target, sel) : nil;
}

@implementation YSSimulator {
    id _device;
    id _hid;
    id _display;
    YSIndigoMouseMessage _mouseMessage;
    NSUUID *_callbackID;
}

+ (instancetype)simulatorWithUDID:(NSString *)udid
                        deviceSet:(NSString *)deviceSet
                     developerDir:(NSString *)developerDir
                     simulatorKit:(NSString *)simulatorKitPath
                            error:(NSError **)error {
    if (!dlopen("/Library/Developer/PrivateFrameworks/CoreSimulator.framework/CoreSimulator", RTLD_NOW)) {
        if (error) *error = YSError(@"CoreSimulator did not load: %s", dlerror());
        return nil;
    }
    NSString *binary = [simulatorKitPath stringByAppendingPathComponent:@"SimulatorKit"];
    void *simulatorKit = dlopen(binary.fileSystemRepresentation, RTLD_NOW);
    if (!simulatorKit) {
        if (error) *error = YSError(@"SimulatorKit did not load: %s", dlerror());
        return nil;
    }
    YSIndigoMouseMessage mouseMessage = (YSIndigoMouseMessage)dlsym(simulatorKit, "IndigoHIDMessageForMouseNSEvent");
    if (!mouseMessage) {
        if (error) *error = YSError(@"SimulatorKit has no IndigoHIDMessageForMouseNSEvent");
        return nil;
    }

    NSError *inner = nil;
    id context = YS_SEND(id (*)(id, SEL, id, NSError **), NSClassFromString(@"SimServiceContext"),
                         NSSelectorFromString(@"sharedServiceContextForDeveloperDir:error:"), developerDir, &inner);
    id set = deviceSet
        ? YS_SEND(id (*)(id, SEL, id, NSError **), context, NSSelectorFromString(@"deviceSetWithPath:error:"), deviceSet, &inner)
        : YS_SEND(id (*)(id, SEL, NSError **), context, NSSelectorFromString(@"defaultDeviceSetWithError:"), &inner);
    if (!set) {
        if (error) *error = YSError(@"no CoreSimulator device set (%@)", inner.localizedDescription ?: @"unknown");
        return nil;
    }
    NSUUID *uuid = [[NSUUID alloc] initWithUUIDString:udid];
    id device = uuid ? [YSCall(set, @"devicesByUDID") objectForKey:uuid] : nil;
    if (!device) {
        if (error) *error = YSError(@"simulator %@ not found", udid);
        return nil;
    }
    if (YS_SEND(NSUInteger (*)(id, SEL), device, NSSelectorFromString(@"state")) != YSDeviceStateBooted) {
        if (error) *error = YSError(@"simulator %@ is not booted", udid);
        return nil;
    }

    id display = [self mainDisplayOf:device];
    if (!display) {
        if (error) *error = YSError(@"simulator %@ has no display framebuffer", udid);
        return nil;
    }
    id hid = YS_SEND(id (*)(id, SEL, id, NSError **), [NSClassFromString(@"SimulatorKit.SimDeviceLegacyHIDClient") alloc],
                     NSSelectorFromString(@"initWithDevice:error:"), device, &inner);
    if (![hid respondsToSelector:NSSelectorFromString(@"sendWithMessage:freeWhenDone:completionQueue:completion:")]) {
        if (error) *error = YSError(@"no HID channel to %@ (%@)", udid, inner.localizedDescription ?: @"this SimulatorKit can't send messages");
        return nil;
    }
    SEL screenCallbacks = NSSelectorFromString(@"registerScreenCallbacksWithUUID:callbackQueue:frameCallback:surfacesChangedCallback:propertiesChangedCallback:");
    SEL damageCallbacks = NSSelectorFromString(@"registerCallbackWithUUID:damageRectanglesCallback:");
    if (![display respondsToSelector:screenCallbacks] && ![display respondsToSelector:damageCallbacks]) {
        if (error) *error = YSError(@"simulator %@ reports no frame updates", udid);
        return nil;
    }

    YSSimulator *simulator = [[YSSimulator alloc] init];
    simulator->_device = device;
    simulator->_hid = hid;
    simulator->_display = display;
    simulator->_mouseMessage = mouseMessage;
    return simulator;
}

/// The display port whose descriptor serves a framebuffer, preferring the main display (class 0).
+ (id)mainDisplayOf:(id)device {
    id fallback = nil;
    for (id port in YSCall(YSCall(device, @"io"), @"ioPorts")) {
        id descriptor = YSCall(port, @"descriptor");
        if (![descriptor respondsToSelector:NSSelectorFromString(@"framebufferSurface")]) continue;
        id state = YSCall(descriptor, @"state");
        SEL displayClass = NSSelectorFromString(@"displayClass");
        if ([state respondsToSelector:displayClass] && YS_SEND(unsigned short (*)(id, SEL), state, displayClass) == 0) {
            return descriptor;
        }
        fallback = fallback ?: descriptor;
    }
    return fallback;
}

- (CGSize)pixelSize {
    IOSurfaceRef surface = [self copyFramebuffer];
    if (!surface) return CGSizeZero;
    CGSize size = CGSizeMake(IOSurfaceGetWidth(surface), IOSurfaceGetHeight(surface));
    CFRelease(surface);
    return size;
}

- (double)pointScale {
    id deviceType = YSCall(_device, @"deviceType");
    SEL scale = NSSelectorFromString(@"mainScreenScale");
    return [deviceType respondsToSelector:scale] ? YS_SEND(float (*)(id, SEL), deviceType, scale) : 1;
}

- (BOOL)touch:(YSTouchPhase)phase x:(double)x y:(double)y edge:(YSEdge)edge error:(NSError **)error {
    NSEventType type = phase == YSTouchPhaseDown ? NSEventTypeLeftMouseDown
        : phase == YSTouchPhaseUp ? NSEventTypeLeftMouseUp
        : NSEventTypeLeftMouseDragged;
    CGPoint point = CGPointMake(x, y);
    void *message = _mouseMessage(&point, NULL, YSIndigoTouchTarget, type, edge, 1, 1);
    if (!message) {
        if (phase == YSTouchPhaseMove) return YES;
        if (error) *error = YSError(@"SimulatorKit built no touch message");
        return NO;
    }
    dispatch_semaphore_t delivered = dispatch_semaphore_create(0);
    __block NSError *sendError = nil;
    YS_SEND(void (*)(id, SEL, void *, BOOL, id, id), _hid,
            NSSelectorFromString(@"sendWithMessage:freeWhenDone:completionQueue:completion:"), message, YES,
            dispatch_get_global_queue(QOS_CLASS_USER_INTERACTIVE, 0), ^(NSError *failure) {
                sendError = failure;
                dispatch_semaphore_signal(delivered);
            });
    if (dispatch_semaphore_wait(delivered, dispatch_time(DISPATCH_TIME_NOW, YSSendTimeoutNanos)) != 0) {
        if (error) *error = YSError(@"the simulator did not take the touch within 1 s");
        return NO;
    }
    if (sendError) {
        if (error) *error = sendError;
        return NO;
    }
    return YES;
}

- (IOSurfaceRef)copyFramebuffer {
    id surface = YSCall(_display, @"framebufferSurface");
    if (!surface) return NULL;
    return (IOSurfaceRef)CFRetain((__bridge CFTypeRef)surface);
}

- (void)observeFrames:(void (^)(void))onFrame {
    _callbackID = [NSUUID UUID];
    dispatch_queue_t queue = dispatch_queue_create("yoqa-sim.frames", DISPATCH_QUEUE_SERIAL);
    SEL screen = NSSelectorFromString(@"registerScreenCallbacksWithUUID:callbackQueue:frameCallback:surfacesChangedCallback:propertiesChangedCallback:");
    if ([_display respondsToSelector:screen]) {
        YS_SEND(void (*)(id, SEL, id, id, id, id, id), _display, screen, _callbackID, queue,
                ^{ onFrame(); }, ^(id surfaces) { onFrame(); }, ^(id properties) { onFrame(); });
        return;
    }
    YS_SEND(void (*)(id, SEL, id, id), _display, NSSelectorFromString(@"registerCallbackWithUUID:damageRectanglesCallback:"),
            _callbackID, ^(id rectangles) { dispatch_async(queue, onFrame); });
}

@end
