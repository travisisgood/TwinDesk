import Cocoa

private final class ProbeEventObservation {
    let marker: Int64 = Int64.random(in: 1...Int64.max)
    var events: [[String: Any]] = []
}

// Diagnostic only: one harmless click on the disposable Finder Name header.
// Never advertised as a viewer capability. No HID/session/global event posting.
enum RawInputProbe {
    @MainActor static func sort(window: AXUIElement, wid: CGWindowID, pid: pid_t, focus: Bool = false, appKit: Bool = false, tagged: Bool = false, windowLocation: Bool = false, skyRoute: Bool = false, bottomLocal: Bool = false, activate: Bool = false, backgroundCommand: Bool = false, target: String = "Name", clicks: Int = 1) async -> [String: Any] {
        guard FinderAccess.inputAllowed(window),
              let header = FinderAccess.nodes(window).first(where: { (FinderAccess.value($0, kAXDescriptionAttribute) as? String == target || FinderAccess.value($0, kAXValueAttribute) as? String == target) && FinderAccess.frame($0) != nil }),
              let frame = FinderAccess.frame(header) else { return ["error": "Backing/minimized fixture Name header unavailable"] }
        typealias SetWindowLocation = @convention(c) (CGEvent, CGPoint) -> Void
        let locationSymbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "CGEventSetWindowLocation")
        if windowLocation && locationSymbol == nil { return ["error": "Window location SPI unavailable"] }
        typealias PostToPid = @convention(c) (pid_t, CGEvent) -> Void
        let sky = skyRoute ? dlopen("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight", RTLD_LAZY) : nil
        defer { if let sky { dlclose(sky) } }
        let postSymbol = sky.flatMap { dlsym($0, "SLEventPostToPid") }
        if skyRoute && postSymbol == nil { return ["error": "Window-targeted routing SPI unavailable"] }
        let cursor = CGEvent(source: nil)?.location ?? .zero
        let app = AXUIElementCreateApplication(pid)
        let previous = FinderAccess.value(app, kAXFocusedWindowAttribute)
        let priorApp = NSWorkspace.shared.frontmostApplication
        if activate {
            guard FinderAccess.backingDisplayID != nil else { return ["error": "Activation diagnostic requires backing"] }
            NSRunningApplication(processIdentifier: pid)?.activate(options: [])
            try? await Task.sleep(nanoseconds: 300_000_000)
        }
        defer { if activate, priorApp?.processIdentifier != pid { priorApp?.activate(options: []) } }
        var focusResult: Int32 = 0
        if focus {
            guard FinderAccess.backingDisplayID != nil else { return ["error": "Focus diagnostic requires backing display"] }
            focusResult = AXUIElementSetAttributeValue(app, kAXFocusedWindowAttribute as CFString, window).rawValue
            try? await Task.sleep(nanoseconds: 200_000_000)
        }
        defer {
            if focus, let previous { AXUIElementSetAttributeValue(app, kAXFocusedWindowAttribute as CFString, previous) }
        }
        guard FinderAccess.inputAllowed(window) else { return ["error": "Source left backing display after focus", "focusAXError": focusResult] }
        let observation = ProbeEventObservation()
        let mask = (CGEventMask(1) << CGEventType.leftMouseDown.rawValue) | (CGEventMask(1) << CGEventType.leftMouseUp.rawValue)
        let tap = CGEvent.tapCreateForPid(pid: pid, place: .headInsertEventTap, options: .listenOnly,
            eventsOfInterest: mask, callback: { _, type, event, info in
                guard let info else { return Unmanaged.passUnretained(event) }
                let observed = Unmanaged<ProbeEventObservation>.fromOpaque(info).takeUnretainedValue()
                if event.getIntegerValueField(.eventSourceUserData) == observed.marker {
                    observed.events.append(["type": type.rawValue, "location": NSStringFromPoint(event.location),
                        "window": event.getIntegerValueField(.mouseEventWindowUnderMousePointer),
                        "targetPid": event.getIntegerValueField(.eventTargetUnixProcessID),
                        "appKitWindowNumber": NSEvent(cgEvent: event)?.windowNumber ?? -1,
                        "privateWindow": event.getIntegerValueField(CGEventField(rawValue: 51)!)])
                }
                return Unmanaged.passUnretained(event)
            }, userInfo: Unmanaged.passUnretained(observation).toOpaque())
        let tapSource = tap.flatMap { CFMachPortCreateRunLoopSource(kCFAllocatorDefault, $0, 0) }
        if let tapSource { CFRunLoopAddSource(CFRunLoopGetMain(), tapSource, .commonModes) }
        defer {
            if let tapSource { CFRunLoopRemoveSource(CFRunLoopGetMain(), tapSource, .commonModes) }
            if let tap { CFMachPortInvalidate(tap) }
        }
        let before = FinderAccess.describe(header)
        let point = CGPoint(x: frame.midX, y: frame.midY)
        let source = CGEventSource(stateID: .privateState)
        for click in 1...clicks {
        for type in [CGEventType.leftMouseDown, .leftMouseUp] {
            let bounds = FinderAccess.frame(window) ?? .zero
            let local = NSPoint(x: point.x - bounds.minX, y: bounds.maxY - point.y)
            let native = appKit ? NSEvent.mouseEvent(with: type == .leftMouseDown ? .leftMouseDown : .leftMouseUp,
                location: local, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                windowNumber: Int(wid), context: nil, eventNumber: 0, clickCount: click, pressure: type == .leftMouseDown ? 1 : 0)?.cgEvent : nil
            guard let event = appKit ? native : CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: point, mouseButton: .left) else { return ["error": "Could not construct diagnostic event"] }
            event.flags = backgroundCommand ? .maskCommand : []
            event.setIntegerValueField(.eventSourceUserData, value: observation.marker)
            event.setIntegerValueField(.mouseEventClickState, value: Int64(click))
            event.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: Int64(wid))
            event.setIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent, value: Int64(wid))
            if tagged {
                // Experimental AppKit window routing tag; never a public capability.
                event.setIntegerValueField(.mouseEventSubtype, value: 3)
                event.setIntegerValueField(CGEventField(rawValue: 51)!, value: Int64(wid))
                event.setIntegerValueField(.eventTargetUnixProcessID, value: Int64(pid))
                event.setIntegerValueField(.eventSourceUnixProcessID, value: Int64(getpid()))
            }
            if windowLocation, let locationSymbol {
                event.location = point
                unsafeBitCast(locationSymbol, to: SetWindowLocation.self)(event, CGPoint(x: point.x-bounds.minX, y: bottomLocal ? bounds.maxY-point.y : point.y-bounds.minY))
            }
            if skyRoute, let postSymbol { unsafeBitCast(postSymbol, to: PostToPid.self)(pid, event) }
            else { event.postToPid(pid) }
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
        }
        try? await Task.sleep(nanoseconds: 500_000_000)
        let afterCursor = CGEvent(source: nil)?.location ?? .zero
        return ["target": target, "clicks": clicks, "postEventAccess": CGPreflightPostEventAccess(), "pidTapCreated": tap != nil, "observedEvents": observation.events, "method": skyRoute ? "SLEventPostToPid with window fields" : "CGEvent.postToPid plus explicit window fields", "backgroundCommand": backgroundCommand, "focusedWindowMatches": (FinderAccess.value(app, kAXFocusedWindowAttribute).map { CFEqual($0, window) }) ?? false, "windowMain": FinderAccess.value(window, kAXMainAttribute) as? Bool ?? false, "activationRequested": activate, "appActiveDuring": NSRunningApplication(processIdentifier: pid)?.isActive ?? false, "bottomLocal": bottomLocal, "skyRoute": skyRoute, "explicitWindowLocation": windowLocation, "experimentalWindowTag": tagged, "appKitWindowEvent": appKit, "focusRequested": focus, "focusAXError": focusResult, "backingAfter": FinderAccess.inputAllowed(window), "before": before, "after": FinderAccess.describe(header),
                "minimizedAfter": FinderAccess.value(window, kAXMinimizedAttribute) as? Bool ?? false,
                "cursorBefore": NSStringFromPoint(cursor), "cursorAfter": NSStringFromPoint(afterCursor)]
    }
}
