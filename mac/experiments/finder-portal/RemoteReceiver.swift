import Cocoa

// Native individual-window shell. Network authentication and bounds are checked
// by receiver.js, then image dimensions are independently checked after decoding.
@MainActor final class RemoteReceiver: NSObject, NSWindowDelegate {
    let window = PortalWindow(contentRect: NSRect(x: 160, y: 120, width: 800, height: 550), styleMask: [.borderless, .miniaturizable, .resizable], backing: .buffered, defer: false)
    let image = PortalImage()
    var seq = 0
    var capabilities: [String] = []
    var search = ""
    var replaceSearch = false
    override init() {
        super.init()
        NSApp.setActivationPolicy(.regular)
        window.isReleasedWhenClosed = false; window.delegate = self
        window.isOpaque = false; window.backgroundColor = .clear
        image.imageScaling = .scaleProportionallyUpOrDown; window.contentView = image
        image.click = { [weak self] point in
            guard let self, self.seq > 0, self.capabilities.contains("pressAt") else { return }
            Probe.emit(["event": "input", "frameSeq": self.seq, "op": "pressAt", "args": ["x": point.x, "y": point.y]])
        }
        image.key = { [weak self] event in self?.key(event) }
    }
    func key(_ event: NSEvent) {
        if event.modifierFlags.contains(.command) {
            if event.charactersIgnoringModifiers == "m" { window.miniaturize(nil) }
            else if event.charactersIgnoringModifiers == "w" { window.close() }
            else if event.charactersIgnoringModifiers == "a" { replaceSearch = true }
            return
        }
        guard seq > 0 else { return }
        if event.keyCode == 36, capabilities.contains("confirmSearch") {
            Probe.emit(["event": "input", "frameSeq": seq, "op": "confirmSearch", "args": [:]]); return
        }
        guard capabilities.contains("setSearchText") else { return }
        if replaceSearch { search = ""; replaceSearch = false }
        if event.keyCode == 51 { if !search.isEmpty { search.removeLast() } }
        else if let chars = event.characters, !event.modifierFlags.contains(.control), chars.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }) { search += chars }
        else { return }
        guard search.utf8.count <= 4096 else { search = ""; return }
        Probe.emit(["event": "input", "frameSeq": seq, "op": "setSearchText", "args": ["text": search]])
    }
    func windowDidMiniaturize(_ notification: Notification) { Probe.emit(["event": "minimized", "value": true]) }
    func windowDidDeminiaturize(_ notification: Notification) { Probe.emit(["event": "minimized", "value": false]) }
    func windowWillClose(_ notification: Notification) { Probe.emit(["event": "close"]); NSApp.terminate(nil) }
    func accept(_ m: [String: Any]) throws {
        let type = m["type"] as? String
        if type == "window" {
            capabilities = m["capabilities"] as? [String] ?? []
            window.title = m["title"] as? String ?? "Remote window"
            if let icon = m["iconPng"] as? String, let data = Data(base64Encoded: icon),
               let rep = NSBitmapImageRep(data: data), rep.pixelsWide <= 512, rep.pixelsHigh <= 512 {
                NSApp.applicationIconImage = NSImage(data: data)
            }
            if let size = m["logicalSize"] as? [String: Double], let w = size["width"], let h = size["height"], w > 0, h > 0 {
                let screen = NSScreen.main?.visibleFrame.size ?? NSSize(width: 1000, height: 700)
                let scale = min(1, min(screen.width / w, screen.height / h))
                window.setContentSize(NSSize(width: w * scale, height: h * scale))
            }
        } else if type == "frame" {
            guard let encoded = m["png"] as? String, let data = Data(base64Encoded: encoded),
                  let size = m["pixelSize"] as? [String: Int], let rep = NSBitmapImageRep(data: data),
                  rep.pixelsWide == size["width"], rep.pixelsHigh == size["height"],
                  let r = m["contentRect"] as? [String: Double], let x = r["x"], let y = r["y"], let w = r["width"], let h = r["height"],
                  let cg = rep.cgImage?.cropping(to: CGRect(x: x, y: y, width: w, height: h)), let frameSeq = m["seq"] as? Int else {
                throw NSError(domain: "Frame decode failed", code: 1)
            }
            image.image = NSImage(cgImage: cg, size: NSSize(width: cg.width, height: cg.height))
            if seq == 0 { window.makeKeyAndOrderFront(nil) }
            seq = frameSeq
            Probe.emit(["event": "frameAck", "seq": seq, "width": rep.pixelsWide, "height": rep.pixelsHigh])
        } else if type == "minimize" { window.miniaturize(nil) }
        else if type == "restore" { window.deminiaturize(nil) }
        else if type == "close" { window.close() }
        else { throw NSError(domain: "Unsupported receiver command", code: 2) }
    }
    static func run() async {
        let receiver = RemoteReceiver()
        Probe.emit(["event": "ready"])
        while let line = await Task.detached(operation: { readLine() }).value {
            do {
                guard line.utf8.count <= 12 * 1024 * 1024, let data = line.data(using: .utf8),
                      let m = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw NSError(domain: "Invalid receiver command", code: 3) }
                try receiver.accept(m)
            } catch { Probe.emit(["event": "error", "detail": "Native receiver rejected frame or metadata"]); break }
        }
        receiver.window.orderOut(nil)
    }
}
