import Cocoa

// One authenticated source window. No HID posting or physical-window restoration.
@MainActor final class NativePointer {
    typealias SetLocation = @convention(c) (CGEvent, CGPoint) -> Void
    let window: AXUIElement, wid: CGWindowID, pid: pid_t
    private let setLocation: SetLocation
    private var held: Set<Int> = []
    private var point = CGPoint.zero
    private var bounds = CGRect.zero
    private var priorApp: NSRunningApplication?
    private var priorWindow: CFTypeRef?
    private var leased = false
    private var timer: Timer?
    private var lastDown = (button: -1, time: 0.0, point: CGPoint.zero, count: 0)
    private var counts: [Int: Int] = [:]
    var heldCount: Int { held.count }
    var snapshot: [String: Any] { ["held":held.count,"leased":leased,"cursor":NSStringFromPoint(CGEvent(source:nil)?.location ?? .zero),"bounds":NSStringFromRect(FinderAccess.frame(window) ?? .zero)] }

    init?(window: AXUIElement, wid: CGWindowID, pid: pid_t) {
        guard FinderAccess.backingDisplayID != nil, CGPreflightPostEventAccess(),
              let symbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "CGEventSetWindowLocation") else { return nil }
        self.window = window; self.wid = wid; self.pid = pid
        setLocation = unsafeBitCast(symbol, to: SetLocation.self)
    }
    // Recovery-only entry point used by the pipe owner if this helper exits.
    // It can issue ups only, to the exact still-existing source PID/window.
    static func emergencyRelease(_ args: [String: Any]) -> Bool {
        guard let pid = args["pid"] as? Int32, let wid = args["wid"] as? UInt32,
              let buttons = args["buttons"] as? [Int], buttons.count <= 3,
              buttons.allSatisfy({ (0...2).contains($0) }),
              let x = args["x"] as? Double, let y = args["y"] as? Double,
              x.isFinite, y.isFinite, (0...1).contains(x), (0...1).contains(y),
              let info = (CGWindowListCopyWindowInfo(.optionIncludingWindow, wid) as? [[String: Any]])?.first,
              info[kCGWindowOwnerPID as String] as? Int32 == pid,
              let rawBounds = info[kCGWindowBounds as String] as? [String: Any],
              let bounds = CGRect(dictionaryRepresentation: rawBounds as CFDictionary),
              let symbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "CGEventSetWindowLocation") else { return false }
        let location = CGPoint(x: bounds.minX+x*(bounds.width-1), y: bounds.minY+y*(bounds.height-1))
        for button in buttons {
            let type: NSEvent.EventType = button == 2 ? .rightMouseUp : button == 1 ? .otherMouseUp : .leftMouseUp
            guard let event = NSEvent.mouseEvent(with: type, location: .zero, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: Int(wid), context: nil, eventNumber: 0, clickCount: 1, pressure: 0)?.cgEvent else { return false }
            event.flags = []; event.location = location
            event.setIntegerValueField(.mouseEventButtonNumber, value: Int64(button == 1 ? 2 : button == 2 ? 1 : 0))
            event.setIntegerValueField(.mouseEventSubtype, value: 3)
            event.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: Int64(wid))
            event.setIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent, value: Int64(wid))
            event.setIntegerValueField(CGEventField(rawValue: 51)!, value: Int64(wid))
            unsafeBitCast(symbol, to: SetLocation.self)(event, CGPoint(x: location.x-bounds.minX, y: location.y-bounds.minY))
            event.postToPid(pid)
        }
        return true
    }
    func heartbeat() {
        timer?.invalidate()
        guard leased else { return }
        timer = Timer.scheduledTimer(withTimeInterval: 8, repeats: false) { [weak self] _ in
            Task { @MainActor in self?.releaseAll() }
        }
    }
    private func focus() async -> Bool {
        if !leased {
            priorApp = NSWorkspace.shared.frontmostApplication
            priorWindow = FinderAccess.value(AXUIElementCreateApplication(pid), kAXFocusedWindowAttribute)
            leased = true
        }
        if leased, NSRunningApplication(processIdentifier: pid)?.isActive == true,
           let focused = FinderAccess.value(AXUIElementCreateApplication(pid), kAXFocusedWindowAttribute), CFEqual(focused,window) {
            return FinderAccess.inputAllowed(window)
        }
        NSRunningApplication(processIdentifier: pid)?.activate(options: [])
        let error = AXUIElementSetAttributeValue(AXUIElementCreateApplication(pid), kAXFocusedWindowAttribute as CFString, window)
        // Allow the first AppKit activation to settle before its initial down.
        try? await Task.sleep(nanoseconds: 80_000_000)
        return error == .success && FinderAccess.inputAllowed(window)
    }
    private func post(phase: String, button: Int, at location: CGPoint, count: Int) -> Bool {
        let cgButton: CGMouseButton = button == 1 ? .center : button == 2 ? .right : .left
        let type: NSEvent.EventType
        if phase == "move" { type = held.isEmpty ? .mouseMoved : button == 2 ? .rightMouseDragged : button == 1 ? .otherMouseDragged : .leftMouseDragged }
        else if phase == "down" { type = button == 2 ? .rightMouseDown : button == 1 ? .otherMouseDown : .leftMouseDown }
        else { type = button == 2 ? .rightMouseUp : button == 1 ? .otherMouseUp : .leftMouseUp }
        guard let event = NSEvent.mouseEvent(with: type, location: CGPoint(x: location.x-bounds.minX, y: bounds.maxY-location.y), modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: Int(wid), context: nil, eventNumber: 0, clickCount: count, pressure: phase == "up" ? 0 : 1)?.cgEvent else { return false }
        event.flags = []
        event.location = location
        event.setIntegerValueField(.mouseEventButtonNumber, value: Int64(cgButton.rawValue))
        event.setIntegerValueField(.mouseEventSubtype, value: 3)
        event.setIntegerValueField(.mouseEventClickState, value: Int64(count))
        event.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: Int64(wid))
        event.setIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent, value: Int64(wid))
        event.setIntegerValueField(CGEventField(rawValue: 51)!, value: Int64(wid))
        event.setIntegerValueField(.eventTargetUnixProcessID, value: Int64(pid))
        event.setIntegerValueField(.eventSourceUnixProcessID, value: Int64(getpid()))
        setLocation(event, CGPoint(x: location.x-bounds.minX, y: location.y-bounds.minY))
        event.postToPid(pid)
        return true
    }
    func releaseAll() {
        timer?.invalidate(); timer = nil
        for button in held { _ = post(phase: "up", button: button, at: point, count: counts[button] ?? 1) }
        held.removeAll(); counts.removeAll()
        if leased {
            if let priorWindow { AXUIElementSetAttributeValue(AXUIElementCreateApplication(pid), kAXFocusedWindowAttribute as CFString, priorWindow) }
            // Do not steal focus back if the user switched applications meanwhile.
            if NSWorkspace.shared.frontmostApplication?.processIdentifier == pid, priorApp?.processIdentifier != pid { priorApp?.activate(options: []) }
        }
        leased = false; priorApp = nil; priorWindow = nil
    }
    func wheel(_ args: [String: Any]) async -> [String: Any] {
        guard let x=args["x"] as? Double, let y=args["y"] as? Double,
              let dx=args["deltaX"] as? Double, let dy=args["deltaY"] as? Double,
              [x,y,dx,dy].allSatisfy({$0.isFinite}), (0...1).contains(x), (0...1).contains(y),
              abs(dx)<=4096, abs(dy)<=4096, FinderAccess.inputAllowed(window), let frame=FinderAccess.frame(window) else { releaseAll(); return ["error":"Invalid wheel/source"] }
        bounds=frame;point=CGPoint(x:frame.minX+x*(frame.width-1),y:frame.minY+y*(frame.height-1))
        guard await focus() else { releaseAll(); return ["error":"Wheel focus unavailable"] }
        _ = post(phase:"move",button:0,at:point,count:0)
        guard let event=CGEvent(scrollWheelEvent2Source:CGEventSource(stateID:.privateState),units:.pixel,wheelCount:2,wheel1:Int32(-dy.rounded()),wheel2:Int32(-dx.rounded()),wheel3:0) else { return ["error":"Wheel construction failed"] }
        event.flags=[];event.location=point
        event.setIntegerValueField(.mouseEventWindowUnderMousePointer,value:Int64(wid))
        event.setIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent,value:Int64(wid))
        event.setIntegerValueField(CGEventField(rawValue:51)!,value:Int64(wid))
        event.setIntegerValueField(.eventTargetUnixProcessID,value:Int64(pid))
        setLocation(event,CGPoint(x:point.x-bounds.minX,y:point.y-bounds.minY))
        event.postToPid(pid);heartbeat()
        return ["AXError":0]
    }
    func handle(_ args: [String: Any]) async -> [String: Any] {
        guard let phase = args["phase"] as? String, ["down","up","move"].contains(phase),
              let button = args["button"] as? Int, (0...2).contains(button),
              let x = args["x"] as? Double, let y = args["y"] as? Double,
              x.isFinite, y.isFinite, (0...1).contains(x), (0...1).contains(y),
              FinderAccess.inputAllowed(window), let frame = FinderAccess.frame(window) else {
            releaseAll(); return ["error": "Pointer source/arguments unavailable"]
        }
        bounds = frame; point = CGPoint(x: frame.minX+x*(frame.width-1), y: frame.minY+y*(frame.height-1))
        if phase == "up" && !held.contains(button) { return ["AXError": 0, "held": held.count] }
        if phase == "down" && held.contains(button) { return ["error": "Button already held"] }
        if phase != "move" || !held.isEmpty {
            guard await focus() else { releaseAll(); return ["error": "Backing source focus unavailable"] }
        }
        var actualButton = button
        if phase == "move", let down = held.sorted().first { actualButton = down }
        if phase == "down" {
            let now = ProcessInfo.processInfo.systemUptime
            let close = hypot(point.x-lastDown.point.x,point.y-lastDown.point.y) <= 5
            let count = lastDown.button == button && now-lastDown.time <= NSEvent.doubleClickInterval && close ? min(3,lastDown.count+1) : 1
            lastDown = (button,now,point,count); counts[button] = count
            held.insert(button) // Record before posting so every failure path can release.
        }
        guard post(phase: phase, button: actualButton, at: point, count: counts[actualButton] ?? 0) else {
            releaseAll(); return ["error": "Native pointer construction failed"]
        }
        if phase == "up" { held.remove(button); counts.removeValue(forKey: button) }
        // Keep the remote focus lease until receiver blur/releaseAll, rather
        // than paying activation/restoration delays for every click/move.
        heartbeat()
        guard FinderAccess.inputAllowed(window) else { releaseAll(); return ["error": "Source left backing", "fatal": true] }
        return ["AXError": 0, "held": held.count]
    }
}
