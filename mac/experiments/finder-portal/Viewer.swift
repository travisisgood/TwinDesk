import Cocoa
import ScreenCaptureKit
import CoreMedia
import CoreImage

final class FrameSink: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    let ci = CIContext()
    var receive: (@Sendable (CGImage) -> Void)?
    var failure: (@Sendable (String) -> Void)?
    func stream(_ stream: SCStream, didStopWithError error: Error) { failure?(String(describing: error)) }
    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, sampleBuffer.isValid,
              let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let status = attachments.first?[.status] as? Int, status == SCFrameStatus.complete.rawValue,
              let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let ciImage = CIImage(cvPixelBuffer: pixels)
        if let image = ci.createCGImage(ciImage, from: ciImage.extent) { receive?(image) }
    }
}

@MainActor final class PortalImage: NSImageView {
    var click: ((CGPoint) -> Void)?
    var key: ((NSEvent) -> Void)?
    override var acceptsFirstResponder: Bool { true }
    override func keyDown(with event: NSEvent) { key?(event) }
    override func mouseDown(with event: NSEvent) {
        window?.makeFirstResponder(self)
        guard let image else { return }
        let p = convert(event.locationInWindow, from: nil)
        let scale = min(bounds.width / image.size.width, bounds.height / image.size.height)
        let size = NSSize(width: image.size.width * scale, height: image.size.height * scale)
        let rect = NSRect(x: (bounds.width - size.width) / 2, y: (bounds.height - size.height) / 2, width: size.width, height: size.height)
        guard rect.contains(p) else { return }
        click?(CGPoint(x: (p.x - rect.minX) / rect.width, y: 1 - (p.y - rect.minY) / rect.height))
    }
}

@MainActor final class PortalWindow: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

@MainActor final class PortalViewer: NSObject, NSWindowDelegate {
    let window: NSWindow
    let image = PortalImage()
    let sink = FrameSink()
    var stream: SCStream?
    var captureBusy = false
    private var ownedWindowIDs: [CGWindowID] = []
    private var popupRefreshGeneration: Int?
    var latestFrame: CGImage?
    var captureConfig: SCStreamConfiguration?
    var frames = 0
    var snapshotFrames = 0
    var snapshotTask: Task<Void, Never>?
    var lastError: String?
    var lastInput: [String: Any]?
    var replaceSearch = false
    var source: SCWindow
    var logicalSize: CGSize
    var captureGeneration = 0
    lazy var sourceAX: AXUIElement? = FinderAccess.window(pid: source.owningApplication!.processID, title: source.title ?? "")
    init(source: SCWindow, presentsWindow: Bool = true) {
        self.source = source
        logicalSize = source.frame.size
        window = PortalWindow(contentRect: NSRect(x: 160, y: 120, width: 800, height: 550), styleMask: FinderAccess.backingDisplayID == nil ? [.titled, .closable, .miniaturizable, .resizable] : [.borderless, .miniaturizable, .resizable], backing: .buffered, defer: false)
        super.init()
        NSApp.setActivationPolicy(presentsWindow ? .regular : .accessory)
        if presentsWindow { NSApp.applicationIconImage = NSWorkspace.shared.icon(forFile: "/System/Library/CoreServices/Finder.app") }
        window.title = "Finder Portal — search and sorting"
        window.isReleasedWhenClosed = false
        window.delegate = self
        image.imageScaling = .scaleProportionallyUpOrDown
        window.contentView = image
        image.click = { [weak self] p in self?.click(p) }
        image.key = { [weak self] e in self?.typeSearch(e) }
        sink.receive = { [weak self] cg in Task { @MainActor in
            guard let self else { return }
            self.latestFrame = cg
            self.frames += 1
            self.image.image = NSImage(cgImage: cg, size: NSSize(width: cg.width, height: cg.height))
        } }
        sink.failure = { [weak self] error in Task { @MainActor in self?.lastError = error } }
    }
    private func popupIDs() -> [CGWindowID] {
        guard let pid=source.owningApplication?.processID else { return [] }
        let rows=CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements],0) as? [[String:Any]] ?? []
        return rows.compactMap { row in
            guard row[kCGWindowOwnerPID as String] as? Int == Int(pid),
                  let layer=row[kCGWindowLayer as String] as? Int,layer>0,layer<=101,
                  let raw=row[kCGWindowBounds as String] as? [String:Any],let rect=CGRect(dictionaryRepresentation:raw as CFDictionary),
                  rect.intersects(source.frame),let wid=row[kCGWindowNumber as String] as? UInt32 else { return nil }
            return wid
        }.sorted()
    }
    func refreshOwnedWindows() {
        guard ProcessInfo.processInfo.environment["FINDER_CHILD_CAPTURE"] == "1",let displayID=FinderAccess.backingDisplayID,
              popupRefreshGeneration == nil,let stream else { return }
        let ids=popupIDs();guard ids != ownedWindowIDs else { return }
        let generation=captureGeneration, source=self.source
        popupRefreshGeneration=generation
        // Enumeration/filter updates can take hundreds of milliseconds. They
        // must not hold the request/reply pipe ahead of a mouse-up or key-up.
        Task { @MainActor [weak self] in
            guard let self else { return }
            defer { if self.popupRefreshGeneration==generation { self.popupRefreshGeneration=nil } }
            do {
                let content=try await SCShareableContent.excludingDesktopWindows(true,onScreenWindowsOnly:false)
                guard self.captureGeneration==generation else { return }
                guard let display=content.displays.first(where:{$0.displayID==displayID}) else { throw NSError(domain:"Backing display missing",code:1) }
                let windows=[source]+content.windows.filter { ids.contains($0.windowID) && $0.owningApplication?.processID==source.owningApplication?.processID }
                try await stream.updateContentFilter(SCContentFilter(display:display,including:windows))
                guard self.captureGeneration==generation else { return }
                self.ownedWindowIDs=ids
            } catch { if self.captureGeneration==generation { self.lastError="Owned popup filter failed: \(error)" } }
        }
    }
    func start(showWindow: Bool = true, pixelScale: Double = 2) async throws {
        captureGeneration += 1
        popupRefreshGeneration = nil
        latestFrame = nil
        let generation = captureGeneration
        let cfg = SCStreamConfiguration()
        cfg.width = Int(ceil(logicalSize.width * pixelScale)); cfg.height = Int(ceil(logicalSize.height * pixelScale))
        cfg.minimumFrameInterval = CMTime(value: 1, timescale: 30)
        cfg.queueDepth = 3; cfg.showsCursor = false; cfg.capturesAudio = false
        cfg.ignoreShadowsSingleWindow = true
        cfg.scalesToFit = true
        captureConfig = cfg
        sink.receive = { [weak self] cg in Task { @MainActor in
            guard let self, self.captureGeneration == generation,
                  cg.width == cfg.width, cg.height == cfg.height else { return }
            self.latestFrame = cg
            self.frames += 1
            self.image.image = NSImage(cgImage: cg, size: NSSize(width: cg.width, height: cg.height))
        } }
        let filter: SCContentFilter
        if ProcessInfo.processInfo.environment["FINDER_CHILD_CAPTURE"] == "1", let displayID=FinderAccess.backingDisplayID {
            let content=try await SCShareableContent.excludingDesktopWindows(true,onScreenWindowsOnly:false)
            guard let display=content.displays.first(where:{$0.displayID==displayID}) else { throw NSError(domain:"Backing display missing",code:1) }
            // Window allowlist only. No full-desktop stream: pixels outside this
            // source window are excluded and the capture rectangle is its bounds.
            ownedWindowIDs=popupIDs()
            filter=SCContentFilter(display:display,including:[source]+content.windows.filter { ownedWindowIDs.contains($0.windowID) && $0.owningApplication?.processID==source.owningApplication?.processID })
            let origin=CGDisplayBounds(displayID).origin
            cfg.sourceRect=CGRect(x:source.frame.minX-origin.x,y:source.frame.minY-origin.y,width:logicalSize.width,height:logicalSize.height)
            cfg.includeChildWindows=true
        } else { filter=SCContentFilter(desktopIndependentWindow:source) }
        let stream = SCStream(filter: filter, configuration: cfg, delegate: sink)
        try stream.addStreamOutput(sink, type: .screen, sampleHandlerQueue: DispatchQueue(label: "finder.portal.frames"))
        self.stream = stream
        try await stream.startCapture()
        if showWindow { window.makeKeyAndOrderFront(nil) }
        snapshotTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                if let root = self.sourceAX, FinderAccess.value(root, kAXMinimizedAttribute) as? Bool == true {
                    do {
                        let cg = try await self.captureFresh()
                        guard !Task.isCancelled else { return }
                        self.snapshotFrames += 1
                        self.image.image = NSImage(cgImage: cg, size: NSSize(width: cg.width, height: cg.height))
                    } catch { self.lastError = String(describing: error) }
                }
                try? await Task.sleep(nanoseconds: 250_000_000)
            }
        }
    }
    func resizeSource(width: Double, height: Double, pixelScale: Double) async -> [String: Any] {
        guard width.isFinite, height.isFinite, pixelScale.isFinite,
              width.rounded() == width, height.rounded() == height,
              width >= 1, height >= 1, width <= 4096, height <= 4096,
              (1...3).contains(pixelScale), ceil(width * pixelScale) <= 4096,
              ceil(height * pixelScale) <= 4096,
              ceil(width * pixelScale) * ceil(height * pixelScale) <= 8_000_000,
              let id = FinderAccess.backingDisplayID, let root = sourceAX,
              FinderAccess.inputAllowed(root), let before = FinderAccess.frame(root),
              CGDisplayBounds(id).contains(CGRect(origin: before.origin, size: CGSize(width: width, height: height))) else {
            return ["error": "Resize does not fit the selected backing display or capture bounds"]
        }
        var settable: DarwinBoolean = false
        guard AXUIElementIsAttributeSettable(root, kAXSizeAttribute as CFString, &settable) == .success, settable.boolValue else {
            return ["error": "Source size is not settable"]
        }
        var desired = CGSize(width: width, height: height)
        let result = AXUIElementSetAttributeValue(root, kAXSizeAttribute as CFString, AXValueCreate(.cgSize, &desired)!)
        guard result == .success else {
            return ["error": "Source rejected resize", "fatal": FinderAccess.frame(root) != before]
        }
        // Read back the OS-applied bounds; Finder may clamp its minimum size.
        var previous: CGRect?, stable = 0, applied: CGRect?
        for _ in 0..<15 {
            try? await Task.sleep(nanoseconds: 100_000_000)
            guard FinderAccess.inputAllowed(root), let current = FinderAccess.frame(root), current.origin == before.origin else {
                return ["error": "Source left its backing position", "fatal": true]
            }
            stable = current == previous ? stable + 1 : 0; previous = current
            if stable >= 2 { applied = current; break }
        }
        guard let applied, applied.width > 0, applied.height > 0,
              ceil(applied.width * pixelScale) <= 4096, ceil(applied.height * pixelScale) <= 4096,
              ceil(applied.width * pixelScale) * ceil(applied.height * pixelScale) <= 8_000_000 else {
            return ["error": "Applied source bounds did not settle within capture limits", "fatal": true]
        }
        do {
            snapshotTask?.cancel(); snapshotTask = nil
            captureGeneration += 1; sink.receive = nil
            try await stream?.stopCapture(); stream = nil
            image.image = nil; lastError = nil
            let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false)
            guard let updated = content.windows.first(where: { $0.windowID == source.windowID }) else {
                return ["error": "Source disappeared during resize", "fatal": true]
            }
            source = updated; logicalSize = applied.size
            try await start(showWindow: false, pixelScale: pixelScale)
            for _ in 0..<30 {
                guard FinderAccess.inputAllowed(root), FinderAccess.frame(root) == applied, lastError == nil else {
                    return ["error": "Source changed during recapture", "fatal": true]
                }
                if image.image != nil { return ["AXError": 0, "appliedFrame": NSStringFromRect(applied), "pixelScale": pixelScale] }
                try await Task.sleep(nanoseconds: 100_000_000)
            }
            return ["error": "Resized capture produced no matching frame", "fatal": true]
        } catch { return ["error": "Source capture reconfiguration failed", "fatal": true] }
    }
    func typeSearch(_ event: NSEvent) {
        guard let root = sourceAX else { lastInput = ["error": "Source AX window unavailable"]; return }
        if event.modifierFlags.contains(.command) {
            if event.charactersIgnoringModifiers == "a" { replaceSearch = true }
            else { lastInput = ["error": "Only search text and Command-A are supported"] }
            return
        }
        if event.keyCode == 36 { lastInput = FinderAccess.confirmSearch(window: root); return }
        guard let field = FinderAccess.nodes(root).first(where: { FinderAccess.value($0, kAXRoleAttribute) as? String == kAXTextFieldRole && FinderAccess.value($0, kAXSubroleAttribute) as? String == "AXSearchField" }) else { lastInput = ["error": "Open Search in the proxy before typing"]; return }
        var text = replaceSearch ? "" : FinderAccess.value(field, kAXValueAttribute) as? String ?? ""
        replaceSearch = false
        if event.keyCode == 51 { if !text.isEmpty { text.removeLast() } }
        else if let chars = event.characters, !event.modifierFlags.contains(.control), chars.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }) { text += chars }
        else { lastInput = ["error": "Unsupported search key"]; return }
        lastInput = FinderAccess.setSearchText(text, window: root)
    }
    func captureFresh() async throws -> CGImage {
        while captureBusy { try await Task.sleep(nanoseconds: 10_000_000) }
        try Task.checkCancellation()
        captureBusy = true
        defer { captureBusy = false }
        return try await SCScreenshotManager.captureImage(contentFilter: SCContentFilter(desktopIndependentWindow: source), configuration: captureConfig!)
    }
    func click(_ point: CGPoint) {
        guard let root = sourceAX else { lastInput = ["error": "Accessibility access unavailable"]; return }
        let r = FinderAccess.frame(root) ?? source.frame
        let p = CGPoint(x: r.minX + point.x * r.width, y: r.minY + point.y * r.height)
        let nodes = FinderAccess.nodes(root)
        if FinderAccess.backingDisplayID != nil, let field = nodes.first(where: {
            FinderAccess.value($0, kAXSubroleAttribute) as? String == "AXSearchField" && FinderAccess.frame($0)?.contains(p) == true
        }) { lastInput = FinderAccess.focusSearch(field, window: root); return }
        let candidates = nodes.filter { e in
            guard FinderAccess.frame(e)?.contains(p) == true else { return false }
            var actions: CFArray?
            return AXUIElementCopyActionNames(e, &actions) == .success && (actions as? [String] ?? []).contains(kAXPressAction)
        }.sorted { (FinderAccess.frame($0)?.width ?? .infinity) * (FinderAccess.frame($0)?.height ?? .infinity) < (FinderAccess.frame($1)?.width ?? .infinity) * (FinderAccess.frame($1)?.height ?? .infinity) }
        guard let target = candidates.first else { lastInput = ["error": "No accessible press action at this point"]; return }
        lastInput = FinderAccess.press(target, window: root)
    }
    func stop() async { snapshotTask?.cancel(); snapshotTask = nil; try? await stream?.stopCapture(); window.orderOut(nil) }
    func windowWillClose(_ notification: Notification) { Task { await stop(); NSApp.terminate(nil) } }
}
