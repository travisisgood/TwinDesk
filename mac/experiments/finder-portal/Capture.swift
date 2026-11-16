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
            if CommandLine.arguments.count == 1 {
                // Opening the standalone bundle explicitly requests its normal OS grant.
                emit(["screenRecording": CGRequestScreenCaptureAccess()])
                return
            }
            let viewerMode = CommandLine.arguments.contains("--viewer")
            guard CommandLine.arguments.count == (viewerMode ? 3 : 2) else { throw NSError(domain: "Usage: Capture unique-window-title", code: 1) }
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
            let matches = content.windows.filter { $0.owningApplication?.bundleIdentifier == "com.apple.finder" && $0.title == title }
            guard matches.count == 1, let window = matches.first else {
                throw NSError(domain: "Expected one dedicated Finder window; found \(matches.count)", code: 2)
            }
            let filter = SCContentFilter(desktopIndependentWindow: window)
            let config = SCStreamConfiguration()
            config.width = Int(window.frame.width * 2)
            config.height = Int(window.frame.height * 2)
            config.showsCursor = false
            config.ignoreShadowsSingleWindow = true
            config.capturesAudio = false
            let viewer = viewerMode ? PortalViewer(source: window) : nil
            try await viewer?.start()
            emit(["ready": true, "wid": window.windowID, "pid": window.owningApplication!.processID])
            while let path = await Task.detached(operation: { readLine() }).value {
                if path.hasPrefix("@click:"), let viewer {
                    let parts = path.dropFirst(7).split(separator: ",").compactMap { Double($0) }
                    guard parts.count == 2, parts.allSatisfy({ $0.isFinite && (0...1).contains($0) }) else { emit(["error": "Invalid normalized point"]); continue }
                    viewer.click(CGPoint(x: parts[0], y: parts[1])); emit(viewer.lastInput ?? [:]); continue
                }
                if path == "@axdump" || path.hasPrefix("@press:") {
                    guard let root = FinderAccess.window(pid: window.owningApplication!.processID, title: title) else { emit(["error": "Finder AX window unavailable", "accessibility": AXIsProcessTrusted()]); continue }
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
                          "intersectsDisplay": intersects, "frame": NSStringFromRect(frame), "streamFrames": viewer?.frames ?? 0, "snapshotFrames": viewer?.snapshotFrames ?? 0, "streamError": viewer?.lastError ?? "", "lastInput": viewer?.lastInput ?? [:]])
                } catch { emit(["error": String(describing: error)]) }
            }
            await viewer?.stop()
        } catch { emit(["error": String(describing: error)]); exit(1) }
    }
}
