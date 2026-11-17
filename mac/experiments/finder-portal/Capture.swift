import Cocoa
import ScreenCaptureKit
import CryptoKit

// A separate-process Finder window is selected once and retained even when hidden.
// stdin: one output PNG path per line; stdout: one JSON result per request.
@main struct Probe {
    static func emit(_ object: [String: Any]) {
        let data = try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        print(String(decoding: data, as: UTF8.self))
        fflush(stdout)
    }
    @MainActor static func main() {
        let app = NSApplication.shared
        Task { await run(); app.terminate(nil) }
        app.run() // Dispatch real AppKit mouse/window events as well as async capture callbacks.
    }
    @MainActor static func run() async {
        do {
            if Bundle.main.bundleIdentifier == "com.travismackinnon.windowportalreceiver" || CommandLine.arguments == [CommandLine.arguments[0], "--receiver"] { await RemoteReceiver.run(); return }
            if CommandLine.arguments.count == 1 {
                // Opening the standalone bundle explicitly requests its normal OS grant.
                emit(["screenRecording": CGRequestScreenCaptureAccess()])
                return
            }
            if CommandLine.arguments.count == 3, CommandLine.arguments[1] == "--release-pointer" {
                guard let data = CommandLine.arguments[2].data(using: .utf8), let args = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { emit(["released": false]); return }
                emit(["released": NativePointer.emergencyRelease(args)]); return
            }
            if CommandLine.arguments.count == 4, CommandLine.arguments[1] == "--observe-edge", let seconds = Int(CommandLine.arguments[3]) {
                await EdgeObserver.run(side: CommandLine.arguments[2], seconds: seconds); return
            }
            let sourceMode = CommandLine.arguments.contains("--source")
            let viewerMode = CommandLine.arguments.contains("--viewer") || sourceMode
            let backingIndex = CommandLine.arguments.firstIndex(of: "--backing")
            if let index = backingIndex, index + 1 < CommandLine.arguments.count {
                guard let id = UInt32(CommandLine.arguments[index + 1]), CGDisplayIsOnline(id) != 0,
                      CGDisplayVendorNumber(id) == 0x4d53, CGDisplayModelNumber(id) == 0x4d54, CGDisplaySerialNumber(id) == 0x4650 else {
                    throw NSError(domain: "Invalid experiment backing display", code: 3)
                }
                FinderAccess.backingDisplayID = id
            }
            guard CommandLine.arguments.count == (viewerMode ? 3 : 2) + (backingIndex == nil ? 0 : 2) else { throw NSError(domain: "Usage: Capture unique-window-title", code: 1) }
            let title = CommandLine.arguments.last!
            if title == "--accessibility" || title == "--request-accessibility" {
                let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: title == "--request-accessibility"] as CFDictionary
                emit(["accessibility": AXIsProcessTrustedWithOptions(options)])
                return
            }
            if title == "--permission" {
                emit(["screenRecording": CGPreflightScreenCaptureAccess()])
                return
            }
            if title == "--request-permission" {
                emit(["screenRecording": CGRequestScreenCaptureAccess()])
                return
            }
            let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false)
            let selectedID = title.hasPrefix("window:") ? UInt32(title.dropFirst(7)) : nil
            let matches = content.windows.filter { $0.owningApplication?.bundleIdentifier == "com.apple.finder" && (selectedID != nil ? $0.windowID == selectedID : $0.title == title) }
            guard matches.count == 1, let window = matches.first else {
                throw NSError(domain: "Expected one dedicated Finder window; found \(matches.count)", code: 2)
            }
            let filter = SCContentFilter(desktopIndependentWindow: window)
            let config = SCStreamConfiguration()
            config.width = Int(window.frame.width * 2)
            config.height = Int(window.frame.height * 2)
            config.showsCursor = false
            config.ignoreShadowsSingleWindow = true
            config.scalesToFit = true
            config.capturesAudio = false
            let rootAX = FinderAccess.window(pid: window.owningApplication!.processID, title: window.title ?? title, matching: window.frame)
            let viewer = viewerMode ? PortalViewer(source: window, presentsWindow: !sourceMode) : nil
            try await viewer?.start(showWindow: !sourceMode, pixelScale: ProcessInfo.processInfo.environment["FINDER_CAPTURE_SCALE"].flatMap(Double.init) ?? 2)
            emit(["ready": true, "wid": window.windowID, "pid": window.owningApplication!.processID])
            let nativePointer = rootAX.flatMap { NativePointer(window: $0, wid: window.windowID, pid: window.owningApplication!.processID) }
            defer { nativePointer?.releaseAll() }
            var publishedDragRegions: [[String: Double]] = []
            while let path = await Task.detached(operation: { readLine() }).value {
                if path.hasPrefix("@wheel-json:") {
                    guard let nativePointer, let data=String(path.dropFirst(12)).data(using:.utf8), let args=try? JSONSerialization.jsonObject(with:data) as? [String:Any] else { emit(["error":"Wheel unavailable"]); continue }
                    emit(await nativePointer.wheel(args)); continue
                }
                if path == "@pointer-state" { emit(nativePointer?.snapshot ?? ["error":"Unavailable"]); continue }
                if path == "@release-all" { nativePointer?.releaseAll(); emit(["AXError": 0]); continue }
                if path.hasPrefix("@pointer-json:") {
                    guard let nativePointer, let data = String(path.dropFirst(14)).data(using: .utf8),
                          let args = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { emit(["error": "Native pointer unavailable"]); continue }
                    emit(await nativePointer.handle(args)); continue
                }
                if path == "@wire-metadata" {
                    publishedDragRegions = rootAX.map { FinderAccess.dragRegions($0) } ?? []
                    let icon = NSWorkspace.shared.icon(forFile: "/System/Library/CoreServices/Finder.app")
                    let small = NSImage(size: NSSize(width: 128, height: 128))
                    small.lockFocus(); icon.draw(in: NSRect(x: 0, y: 0, width: 128, height: 128)); small.unlockFocus()
                    let rep = NSBitmapImageRep(data: small.tiffRepresentation!)!
                    emit(["appId": "com.apple.finder", "title": window.title ?? title,
                          "logicalSize": ["width": Int(viewer?.logicalSize.width ?? window.frame.width), "height": Int(viewer?.logicalSize.height ?? window.frame.height)],
                          "pixelSize": ["width": viewer?.captureConfig?.width ?? config.width, "height": viewer?.captureConfig?.height ?? config.height],
                          "iconPng": rep.representation(using: .png, properties: [:])!.base64EncodedString(),
                          "dragRegions": publishedDragRegions,
                          "windowControls": rootAX.map { FinderAccess.windowControls($0) } ?? [],
                          "capabilities": ["pressAt", "setSearchText", "confirmSearch"] + (FinderAccess.backingDisplayID != nil ? ["resize", "sourceDragRegions", "receiverWindowControls"] : []) + (nativePointer != nil ? ["pointer", "releaseAll", "wheel"] : [])]); continue
                }
                if path.hasPrefix("@resize-json:"), let viewer {
                    guard let data = String(path.dropFirst(13)).data(using: .utf8),
                          let args = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                          let size = args["logicalSize"] as? [String: Double],
                          let width = size["width"], let height = size["height"], let scale = args["pixelScale"] as? Double else {
                        emit(["error": "Invalid resize arguments"]); continue
                    }
                    nativePointer?.releaseAll()
                    emit(await viewer.resizeSource(width: width, height: height, pixelScale: scale)); continue
                }
                if path == "@wire-frame", let viewer {
                    guard let rootAX, FinderAccess.inputAllowed(rootAX),
                          let actual = FinderAccess.frame(rootAX), actual.size == viewer.logicalSize,
                          viewer.lastError == nil else { emit(["error": "Source geometry/capture unavailable"]); continue }
                    nativePointer?.heartbeat()
                    if FinderAccess.dragRegions(rootAX) != publishedDragRegions {
                        nativePointer?.releaseAll()
                        emit(["geometryChanged": true]); continue
                    }
                    guard let image = viewer.image.image, let tiff = image.tiffRepresentation,
                          let rep = NSBitmapImageRep(data: tiff), let data = rep.representation(using: .png, properties: [:]) else {
                        emit(["pending": true]); continue
                    }
                    emit(["png": data.base64EncodedString(), "captureMode": "stream",
                          "pixelSize": ["width": rep.pixelsWide, "height": rep.pixelsHigh],
                          "contentRect": ["x": 0, "y": 0, "width": rep.pixelsWide, "height": rep.pixelsHigh],
                          "nativeFrames": viewer.frames]); continue
                }
                if path == "@viewer-close", let viewer {
                    emit(["viewerClosing": true]); viewer.window.close(); continue
                }
                if ["@raw-select-alpha", "@raw-select-beta", "@raw-open-child"].contains(path) {
                    guard let rootAX else { emit(["error": "Finder AX window unavailable"]); continue }
                    let target = path == "@raw-select-alpha" ? "Alpha.txt" : path == "@raw-select-beta" ? "Beta.txt" : "PortalChild"
                    emit(await RawInputProbe.sort(window: rootAX, wid: window.windowID, pid: window.owningApplication!.processID,
                        focus: true, appKit: true, tagged: true, windowLocation: true, activate: true,
                        target: target, clicks: path == "@raw-open-child" ? 2 : 1)); continue
                }
                if ["@raw-sort", "@raw-focus-sort", "@raw-appkit-sort", "@raw-tagged-sort", "@raw-location-sort", "@raw-sky-sort", "@raw-bottom-sort", "@raw-active-sort", "@raw-command-sort", "@raw-active-top-sort"].contains(path) {
                    guard let rootAX else { emit(["error": "Finder AX window unavailable"]); continue }
                    let location = ["@raw-location-sort", "@raw-sky-sort", "@raw-bottom-sort", "@raw-active-sort", "@raw-command-sort", "@raw-active-top-sort"].contains(path)
                    let tagged = path == "@raw-tagged-sort" || location
                    emit(await RawInputProbe.sort(window: rootAX, wid: window.windowID, pid: window.owningApplication!.processID,
                        focus: path == "@raw-focus-sort" || path == "@raw-active-sort" || path == "@raw-active-top-sort", appKit: path == "@raw-appkit-sort" || tagged,
                        tagged: tagged, windowLocation: location, skyRoute: path == "@raw-sky-sort", bottomLocal: path == "@raw-bottom-sort" || path == "@raw-active-sort", activate: path == "@raw-active-sort" || path == "@raw-active-top-sort", backgroundCommand: path == "@raw-command-sort")); continue
                }
                if path.hasPrefix("@viewer-resize:"), let viewer {
                    let sizes = path.dropFirst(15).split(separator: ",").compactMap { Double($0) }
                    guard sizes.count == 2, sizes.allSatisfy({ $0.isFinite && (300...1600).contains($0) }) else { emit(["error": "Invalid viewer size"]); continue }
                    viewer.window.setContentSize(NSSize(width: sizes[0], height: sizes[1]))
                    emit(["viewerSize": sizes]); continue
                }
                if path == "@viewer-minimize" || path == "@viewer-restore" {
                    guard let viewer else { emit(["error": "Viewer is not enabled"]); continue }
                    if path == "@viewer-minimize" { viewer.window.miniaturize(nil) }
                    else { viewer.window.deminiaturize(nil) }
                    emit(["viewerMinimized": viewer.window.isMiniaturized]); continue
                }
                if path.hasPrefix("@open:") {
                    guard let rootAX else { emit(["error": "Finder AX window unavailable"]); continue }
                    emit(FinderAccess.openItem(String(path.dropFirst(6)), window: rootAX)); continue
                }
                if path == "@confirm" {
                    guard let rootAX else { emit(["error": "Finder AX window unavailable"]); continue }
                    emit(FinderAccess.confirmSearch(window: rootAX)); continue
                }
                if path.hasPrefix("@text-json:") {
                    guard let rootAX, let data = String(path.dropFirst(11)).data(using: .utf8),
                          let values = try? JSONSerialization.jsonObject(with: data) as? [String: String],
                          let text = values["text"], text.utf8.count <= 4096 else { emit(["error": "Invalid search text"]); continue }
                    emit(FinderAccess.setSearchText(text, window: rootAX)); continue
                }
                if path.hasPrefix("@text:") {
                    guard let rootAX else { emit(["error": "Finder AX window unavailable"]); continue }
                    emit(FinderAccess.setSearchText(String(path.dropFirst(6)), window: rootAX)); continue
                }
                if path.hasPrefix("@click:"), let viewer {
                    let parts = path.dropFirst(7).split(separator: ",").compactMap { Double($0) }
                    guard parts.count == 2, parts.allSatisfy({ $0.isFinite && (0...1).contains($0) }) else { emit(["error": "Invalid normalized point"]); continue }
                    viewer.click(CGPoint(x: parts[0], y: parts[1])); emit(viewer.lastInput ?? [:]); continue
                }
                if path == "@axdump" || path.hasPrefix("@press:") {
                    guard let root = rootAX else { emit(["error": "Finder AX window unavailable", "accessibility": AXIsProcessTrusted()]); continue }
                    let nodes = FinderAccess.nodes(root)
                    if path == "@axdump" { emit(["elements": nodes.map { FinderAccess.describe($0) }]); continue }
                    let label = String(path.dropFirst(7))
                    guard let target = nodes.first(where: { FinderAccess.value($0, kAXDescriptionAttribute) as? String == label }) else { emit(["error": "No exact accessible control: " + label]); continue }
                    emit(FinderAccess.press(target, window: root)); continue
                }
                do {
                    let image: CGImage
                    if let viewer { image = try await viewer.captureFresh() }
                    else { image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config) }
                    let rep = NSBitmapImageRep(cgImage: image)
                    let png = rep.representation(using: .png, properties: [:])!
                    try png.write(to: URL(fileURLWithPath: path))
                    if let streamImage = viewer?.image.image, let tiff = streamImage.tiffRepresentation,
                       let rep = NSBitmapImageRep(data: tiff), let data = rep.representation(using: .png, properties: [:]) {
                        try data.write(to: URL(fileURLWithPath: path + ".stream.png"))
                    }
                    let current = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false)
                    let now = current.windows.first { $0.windowID == window.windowID }
                    let frame = now?.frame ?? .null
                    let intersects = current.displays.contains { $0.frame.intersects(frame) }
                    emit(["png": path, "sha256": SHA256.hash(data: png).map { String(format: "%02x", $0) }.joined(),
                          "verification": "Inspect saved PNG for the newly created filename", "listed": now != nil, "onScreen": now?.isOnScreen ?? false,
                          "intersectsDisplay": intersects, "frame": NSStringFromRect(frame), "viewerMinimized": viewer?.window.isMiniaturized ?? false, "streamFrames": viewer?.frames ?? 0, "snapshotFrames": viewer?.snapshotFrames ?? 0, "streamError": viewer?.lastError ?? "", "lastInput": viewer?.lastInput ?? [:]])
                } catch { emit(["error": String(describing: error)]) }
            }
            await viewer?.stop()
        } catch { emit(["error": String(describing: error)]); exit(1) }
    }
}
