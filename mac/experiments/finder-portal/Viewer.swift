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
    var captureConfig: SCStreamConfiguration?
    var frames = 0
    var snapshotFrames = 0
    var snapshotTask: Task<Void, Never>?
    var lastError: String?
    var lastInput: [String: Any]?
    var replaceSearch = false
    let source: SCWindow
    lazy var sourceAX: AXUIElement? = FinderAccess.window(pid: source.owningApplication!.processID, title: source.title ?? "")
    init(source: SCWindow, presentsWindow: Bool = true) {
        self.source = source
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
            self.frames += 1
            self.image.image = NSImage(cgImage: cg, size: NSSize(width: cg.width, height: cg.height))
        } }
        sink.failure = { [weak self] error in Task { @MainActor in self?.lastError = error } }
    }
    func start(showWindow: Bool = true) async throws {
        let cfg = SCStreamConfiguration()
        cfg.width = Int(source.frame.width * 2); cfg.height = Int(source.frame.height * 2)
        cfg.minimumFrameInterval = CMTime(value: 1, timescale: 15)
        cfg.queueDepth = 3; cfg.showsCursor = false; cfg.capturesAudio = false
        cfg.ignoreShadowsSingleWindow = true
        cfg.scalesToFit = true
        captureConfig = cfg
        let stream = SCStream(filter: SCContentFilter(desktopIndependentWindow: source), configuration: cfg, delegate: sink)
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
