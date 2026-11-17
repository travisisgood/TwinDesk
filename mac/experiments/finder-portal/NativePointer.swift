import Cocoa

// One authenticated source window. No HID posting or physical-window restoration.
@MainActor final class NativePointer {
    typealias SetLocation = @convention(c) (CGEvent, CGPoint) -> Void
    let window: AXUIElement, wid: CGWindowID, pid: pid_t
    private let setLocation: SetLocation
    private var held: Set<Int> = []
    private var heldKeys: Set<Int> = []
    private var point = CGPoint.zero
    private var bounds = CGRect.zero
    private var priorApp: NSRunningApplication?
    private var priorWindow: CFTypeRef?
    private var leased = false
    private var timer: Timer?
    private var lastDown = (button: -1, time: 0.0, point: CGPoint.zero, count: 0)
    private var counts: [Int: Int] = [:]
    private var heldRoutes: [Int:(CGWindowID,CGRect)] = [:]
    var heldCount: Int { held.count }
    var snapshot: [String: Any] { ["held":held.count,"heldKeys":heldKeys.count,"leased":leased,"cursor":NSStringFromPoint(CGEvent(source:nil)?.location ?? .zero),"bounds":NSStringFromRect(FinderAccess.frame(window) ?? .zero)] }

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
        let keys=args["keys"] as? [Int] ?? []
        guard keys.count<=128, keys.allSatisfy({Self.keyName($0) != nil}) else { return false }
        for usage in keys.sorted(by: { ($0>=224 ? 1:0) < ($1>=224 ? 1:0) }) {
            guard let name=Self.keyName(usage),let code=KeyCodes.vk(name),let event=CGEvent(keyboardEventSource:CGEventSource(stateID:.privateState),virtualKey:code,keyDown:false) else { continue }
            if KeyCodes.modifiers[name] != nil { event.type = .flagsChanged }
            event.flags=[];event.setIntegerValueField(CGEventField(rawValue:51)!,value:Int64(wid));event.postToPid(pid)
        }
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
    private static func keyName(_ usage: Int) -> String? {
        if (4...29).contains(usage) { return "Key"+String(UnicodeScalar(65+usage-4)!) }
        if (30...39).contains(usage) { return "Digit"+String((usage-29)%10) }
        if (58...69).contains(usage) { return "F"+String(usage-57) }
        if (89...97).contains(usage) { return "Numpad"+String(usage-88) }
        if (104...115).contains(usage) { return "F"+String(usage-91) }
        let names=[40:"Enter",41:"Escape",42:"Backspace",43:"Tab",44:"Space",45:"Minus",46:"Equal",47:"BracketLeft",48:"BracketRight",49:"Backslash",51:"Semicolon",52:"Quote",53:"Backquote",54:"Comma",55:"Period",56:"Slash",57:"CapsLock",70:"PrintScreen",71:"ScrollLock",72:"Pause",73:"Insert",74:"Home",75:"PageUp",76:"Delete",77:"End",78:"PageDown",79:"ArrowRight",80:"ArrowLeft",81:"ArrowDown",82:"ArrowUp",83:"NumLock",84:"NumpadDivide",85:"NumpadMultiply",86:"NumpadSubtract",87:"NumpadAdd",88:"NumpadEnter",98:"Numpad0",99:"NumpadDecimal",100:"IntlBackslash",101:"ContextMenu",103:"NumpadEqual",224:"ControlLeft",225:"ShiftLeft",226:"AltLeft",227:"MetaLeft",228:"ControlRight",229:"ShiftRight",230:"AltRight",231:"MetaRight"]
        return names[usage]
    }
    private var keyFlags: CGEventFlags {
        var bits: UInt64=0
        for usage in heldKeys {
            if let name=Self.keyName(usage),let modifier=KeyCodes.modifiers[name] { bits |= modifier.flag.rawValue | modifier.device }
        }
        return CGEventFlags(rawValue:bits)
    }
    private func postKey(_ usage: Int, down: Bool) -> Bool {
        guard let name=Self.keyName(usage),let code=KeyCodes.vk(name),
              let event=CGEvent(keyboardEventSource:CGEventSource(stateID:.privateState),virtualKey:code,keyDown:down) else { return false }
        if KeyCodes.modifiers[name] != nil { event.type = .flagsChanged }
        event.flags=keyFlags
        event.setIntegerValueField(CGEventField(rawValue:51)!,value:Int64(wid))
        event.setIntegerValueField(.eventTargetUnixProcessID,value:Int64(pid))
        event.postToPid(pid);return true
    }
    func key(_ args: [String:Any]) async -> [String:Any] {
        guard let phase=args["phase"] as? String,["down","up"].contains(phase),let usage=args["usage"] as? Int,
              let name=Self.keyName(usage),KeyCodes.vk(name) != nil,FinderAccess.inputAllowed(window) else { releaseAll();return ["error":"Unsupported key/source"] }
        if phase=="up" && !heldKeys.contains(usage) { return ["AXError":0] }
        guard await focus() else { releaseAll();return ["error":"Key focus unavailable"] }
        if phase=="down" { heldKeys.insert(usage) } else { heldKeys.remove(usage) }
        guard postKey(usage,down:phase=="down") else { releaseAll();return ["error":"Key construction failed"] }
        heartbeat();return ["AXError":0]
    }
    func text(_ args: [String:Any]) async -> [String:Any] {
        guard let text=args["text"] as? String,text.utf8.count<=4096,FinderAccess.inputAllowed(window),
              keyFlags.intersection([.maskCommand,.maskControl,.maskAlternate]).isEmpty else { return ["error":"Text/source/shortcut state invalid"] }
        guard await focus() else { releaseAll();return ["error":"Text focus unavailable"] }
        // Scalar chunks avoid splitting surrogate pairs; text is committed Unicode,
        // not a second printable hardware key event.
        var chunks=[String](),chunk=""
        for scalar in text.unicodeScalars {
            if chunk.utf16.count+scalar.utf16.count>16 { chunks.append(chunk);chunk="" }
            chunk.unicodeScalars.append(scalar)
        }
        if !chunk.isEmpty { chunks.append(chunk) }
        for chunk in chunks {
            let units=Array(chunk.utf16)
            for down in [true,false] {
                guard let event=CGEvent(keyboardEventSource:CGEventSource(stateID:.privateState),virtualKey:0,keyDown:down) else { return ["error":"Text construction failed"] }
                event.flags=[];event.keyboardSetUnicodeString(stringLength:units.count,unicodeString:units)
                event.setIntegerValueField(CGEventField(rawValue:51)!,value:Int64(wid));event.postToPid(pid)
            }
        }
        heartbeat();return ["AXError":0]
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
        // Route within the same owned popup allowlist used by capture. The
        // normalized receiver point still maps to the original source canvas.
        var targetID=wid,targetBounds=bounds
        let rows=CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements],0) as? [[String:Any]] ?? []
        for row in rows {
            guard row[kCGWindowOwnerPID as String] as? Int == Int(pid),let layer=row[kCGWindowLayer as String] as? Int,layer>0,layer<=101,
                  let raw=row[kCGWindowBounds as String] as? [String:Any],let r=CGRect(dictionaryRepresentation:raw as CFDictionary),
                  r.intersects(bounds),r.contains(location),let id=row[kCGWindowNumber as String] as? UInt32 else { continue }
            targetID=id;targetBounds=r;break
        }
        if phase == "up",let route=heldRoutes[button] { targetID=route.0;targetBounds=route.1 }
        if phase == "down" { heldRoutes[button]=(targetID,targetBounds) }
        let type: NSEvent.EventType
        if phase == "move" { type = held.isEmpty ? .mouseMoved : button == 2 ? .rightMouseDragged : button == 1 ? .otherMouseDragged : .leftMouseDragged }
        else if phase == "down" { type = button == 2 ? .rightMouseDown : button == 1 ? .otherMouseDown : .leftMouseDown }
        else { type = button == 2 ? .rightMouseUp : button == 1 ? .otherMouseUp : .leftMouseUp }
        guard let event = NSEvent.mouseEvent(with: type, location: CGPoint(x: location.x-targetBounds.minX, y: targetBounds.maxY-location.y), modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: Int(targetID), context: nil, eventNumber: 0, clickCount: count, pressure: phase == "up" ? 0 : 1)?.cgEvent else { return false }
        event.flags = keyFlags
        event.location = location
        event.setIntegerValueField(.mouseEventButtonNumber, value: Int64(cgButton.rawValue))
        event.setIntegerValueField(.mouseEventSubtype, value: 3)
        event.setIntegerValueField(.mouseEventClickState, value: Int64(count))
        event.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: Int64(targetID))
        event.setIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent, value: Int64(targetID))
        event.setIntegerValueField(CGEventField(rawValue: 51)!, value: Int64(targetID))
        event.setIntegerValueField(.eventTargetUnixProcessID, value: Int64(pid))
        event.setIntegerValueField(.eventSourceUnixProcessID, value: Int64(getpid()))
        setLocation(event, CGPoint(x: location.x-targetBounds.minX, y: location.y-targetBounds.minY))
        event.postToPid(pid)
        if phase == "up" { heldRoutes.removeValue(forKey:button) }
        return true
    }
    func releaseAll() {
        timer?.invalidate(); timer = nil
        for button in held { _ = post(phase: "up", button: button, at: point, count: counts[button] ?? 1) }
        held.removeAll(); counts.removeAll(); heldRoutes.removeAll()
        // Release ordinary keys before modifiers so no modifier remains stuck.
        for usage in heldKeys.sorted(by: { ($0>=224 ? 1:0) < ($1>=224 ? 1:0) }) {
            heldKeys.remove(usage);_ = postKey(usage,down:false)
        }
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
        event.flags=keyFlags;event.location=point
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
