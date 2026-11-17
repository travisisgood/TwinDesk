import Cocoa
import CryptoKit

// Read-only standalone observer. It neither captures the mouse nor changes KVM.
@MainActor final class EdgeObserver {
    private let side: String
    private var candidate: (wid: Int, pid: Int, frame: CGRect, anchor: CGPoint, display: CGRect, displayID: UInt32, owner: String, layout: String)?
    private var offered = false
    private var lastLayout = ""
    init(side: String) { self.side = side }
    private func displays() -> [(UInt32, CGRect)] {
        var ids = [CGDirectDisplayID](repeating: 0, count: 32), count: UInt32 = 0
        CGGetActiveDisplayList(32, &ids, &count)
        return ids.prefix(Int(count)).filter { CGDisplayMirrorsDisplay($0) == 0 && !(CGDisplayVendorNumber($0) == 0x4d53 && CGDisplayModelNumber($0) == 0x4d54) }.map { ($0, CGDisplayBounds($0)) }
    }
    private func layout() -> String {
        let s = displays().map { "\($0.0):\(NSStringFromRect($0.1))" }.sorted().joined(separator: "|")
        return SHA256.hash(data: Data(s.utf8)).map { String(format: "%02x", $0) }.joined()
    }
    private func observe(_ type: CGEventType, _ event: CGEvent) {
        let point = event.location
        if type == .leftMouseDown {
            candidate = nil; offered = false
            guard let display = displays().first(where: { $0.1.contains(point) }) else { return }
            let root = AXUIElementCreateSystemWide(); AXUIElementSetMessagingTimeout(root, 0.05)
            var hit: AXUIElement?
            guard AXUIElementCopyElementAtPosition(root, Float(point.x), Float(point.y), &hit) == .success, let hit,
                  let role = FinderAccess.value(hit, kAXRoleAttribute) as? String,
                  ["AXWindow", "AXToolbar", "AXGroup", "AXStaticText"].contains(role) else { return }
            let window: AXUIElement
            if role == "AXWindow" { window = hit }
            else {
                guard let raw = FinderAccess.value(hit, kAXWindowAttribute), CFGetTypeID(raw) == AXUIElementGetTypeID() else { return }
                window = (raw as! AXUIElement)
            }
            AXUIElementSetMessagingTimeout(window,0.08)
            var pid: pid_t = 0; AXUIElementGetPid(window, &pid)
            guard NSRunningApplication(processIdentifier: pid)?.bundleIdentifier == "com.apple.finder",
                  let frame = FinderAccess.frame(window), point.y >= frame.minY+4, point.y < frame.minY+52,
                  point.x > frame.minX+72, point.x < frame.maxX-8 else { return }
            let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements],0) as? [[String: Any]] ?? []
            guard let found = list.first(where: { info in
                guard info[kCGWindowOwnerPID as String] as? Int == Int(pid), info[kCGWindowLayer as String] as? Int == 0,
                      let b = info[kCGWindowBounds as String] as? [String: Any], let r = CGRect(dictionaryRepresentation: b as CFDictionary) else { return false }
                return abs(r.minX-frame.minX)<3 && abs(r.minY-frame.minY)<3 && abs(r.width-frame.width)<3 && abs(r.height-frame.height)<3
            }), let wid = found[kCGWindowNumber as String] as? Int else { return }
            candidate = (wid,Int(pid),frame,CGPoint(x:(point.x-frame.minX)/frame.width,y:(point.y-frame.minY)/frame.height),display.1,display.0,event.getIntegerValueField(.eventSourceUserData)==0x4d53 ? "windows" : "mac",layout())
        } else if type == .leftMouseDragged, let c = candidate, !offered {
            guard layout() == c.layout else { candidate = nil; return }
            let crossed: Bool
            switch side {
            case "left": crossed = point.x <= c.display.minX+12
            case "right": crossed = point.x >= c.display.maxX-12
            case "top": crossed = point.y <= c.display.minY+12
            default: crossed = point.y >= c.display.maxY-12
            }
            guard crossed else { return }
            offered = true
            let vertical = side == "left" || side == "right"
            let offset = vertical ? (point.y-c.display.minY)/c.display.height : (point.x-c.display.minX)/c.display.width
            Probe.emit(["event":"edgeOffer", "wid":c.wid,"pid":c.pid,"appId":"com.apple.finder", "side":side,
                "offset":min(1,max(0,offset)),"anchor":["x":c.anchor.x,"y":c.anchor.y],
                "originalBounds":[c.frame.minX,c.frame.minY,c.frame.maxX,c.frame.maxY],
                "displayId":c.displayID,"layoutRevision":c.layout,"pointerOwner":c.owner])
        } else if type == .leftMouseUp {
            if offered { Probe.emit(["event":"sourceButtonUp","injected":event.getIntegerValueField(.eventSourceUserData)==0x4d53]) }
            candidate = nil; offered = false
        }
    }
    static func run(side: String, seconds: Int) async {
        guard ["left","right","top","bottom"].contains(side), (10...3600).contains(seconds) else { Probe.emit(["error":"Invalid observer configuration"]); return }
        let observer = EdgeObserver(side: side)
        let mask = [CGEventType.leftMouseDown,.leftMouseDragged,.leftMouseUp].reduce(CGEventMask(0)) { $0 | (CGEventMask(1) << $1.rawValue) }
        guard let tap = CGEvent.tapCreate(tap:.cghidEventTap,place:.headInsertEventTap,options:.listenOnly,eventsOfInterest:mask,callback:{ _,type,event,info in
            guard let info else { return Unmanaged.passUnretained(event) }
            let observer=Unmanaged<EdgeObserver>.fromOpaque(info).takeUnretainedValue()
            MainActor.assumeIsolated {
                if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
                    Probe.emit(["error":"Edge observation was disabled; abort any pending transfer"])
                } else { observer.observe(type,event) }
            }
            return Unmanaged.passUnretained(event)
        },userInfo:Unmanaged.passUnretained(observer).toOpaque()), let source=CFMachPortCreateRunLoopSource(kCFAllocatorDefault,tap,0) else { Probe.emit(["error":"Normal input observation permission unavailable"]); return }
        CFRunLoopAddSource(CFRunLoopGetMain(),source,.commonModes)
        observer.lastLayout=observer.layout()
        let topologyTimer=Timer.scheduledTimer(withTimeInterval:0.25,repeats:true) { _ in
            MainActor.assumeIsolated {
                let current=observer.layout()
                if current != observer.lastLayout {
                    observer.lastLayout=current;observer.candidate=nil;observer.offered=false
                    Probe.emit(["event":"layoutChanged","layoutRevision":current])
                }
            }
        }
        defer { topologyTimer.invalidate() }
        Probe.emit(["ready":true,"observerOnly":true,"side":side,"layoutRevision":observer.layout()])
        try? await Task.sleep(nanoseconds:UInt64(seconds)*1_000_000_000)
        CFRunLoopRemoveSource(CFRunLoopGetMain(),source,.commonModes);CFMachPortInvalidate(tap)
        withExtendedLifetime(observer) {}
    }
}
