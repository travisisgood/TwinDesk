import Cocoa

// Diagnostic only: one harmless click on the disposable Finder Name header.
// Never advertised as a viewer capability. No HID/session/global event posting.
enum RawInputProbe {
    @MainActor static func sort(window: AXUIElement, wid: CGWindowID, pid: pid_t, focus: Bool = false, appKit: Bool = false, tagged: Bool = false, windowLocation: Bool = false, skyRoute: Bool = false, bottomLocal: Bool = false, activate: Bool = false) async -> [String: Any] {
        guard FinderAccess.inputAllowed(window),
              let header = FinderAccess.nodes(window).first(where: { FinderAccess.value($0, kAXDescriptionAttribute) as? String == "Name" }),
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
        let before = FinderAccess.describe(header)
        let point = CGPoint(x: frame.midX, y: frame.midY)
        let source = CGEventSource(stateID: .privateState)
        for type in [CGEventType.leftMouseDown, .leftMouseUp] {
            let bounds = FinderAccess.frame(window) ?? .zero
            let local = NSPoint(x: point.x - bounds.minX, y: bounds.maxY - point.y)
            let native = appKit ? NSEvent.mouseEvent(with: type == .leftMouseDown ? .leftMouseDown : .leftMouseUp,
                location: local, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                windowNumber: Int(wid), context: nil, eventNumber: 0, clickCount: 1, pressure: type == .leftMouseDown ? 1 : 0)?.cgEvent : nil
            guard let event = appKit ? native : CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: point, mouseButton: .left) else { return ["error": "Could not construct diagnostic event"] }
            event.setIntegerValueField(.mouseEventClickState, value: 1)
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
        try? await Task.sleep(nanoseconds: 500_000_000)
        let afterCursor = CGEvent(source: nil)?.location ?? .zero
        return ["method": "CGEvent.postToPid plus explicit window fields", "activationRequested": activate, "appActiveDuring": NSRunningApplication(processIdentifier: pid)?.isActive ?? false, "bottomLocal": bottomLocal, "skyRoute": skyRoute, "explicitWindowLocation": windowLocation, "experimentalWindowTag": tagged, "appKitWindowEvent": appKit, "focusRequested": focus, "focusAXError": focusResult, "backingAfter": FinderAccess.inputAllowed(window), "before": before, "after": FinderAccess.describe(header),
                "minimizedAfter": FinderAccess.value(window, kAXMinimizedAttribute) as? Bool ?? false,
                "cursorBefore": NSStringFromPoint(cursor), "cursorAfter": NSStringFromPoint(afterCursor)]
    }
}
