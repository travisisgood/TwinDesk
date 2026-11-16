import Cocoa

// Diagnostic only: one harmless click on the disposable Finder Name header.
// Never advertised as a viewer capability. No HID/session/global event posting.
enum RawInputProbe {
    @MainActor static func sort(window: AXUIElement, wid: CGWindowID, pid: pid_t) async -> [String: Any] {
        guard FinderAccess.inputAllowed(window),
              let header = FinderAccess.nodes(window).first(where: { FinderAccess.value($0, kAXDescriptionAttribute) as? String == "Name" }),
              let frame = FinderAccess.frame(header) else { return ["error": "Minimized fixture Name header unavailable"] }
        let before = FinderAccess.describe(header)
        let cursor = CGEvent(source: nil)?.location ?? .zero
        let point = CGPoint(x: frame.midX, y: frame.midY)
        let source = CGEventSource(stateID: .privateState)
        for type in [CGEventType.leftMouseDown, .leftMouseUp] {
            guard let event = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: point, mouseButton: .left) else { return ["error": "Could not construct diagnostic event"] }
            event.setIntegerValueField(.mouseEventClickState, value: 1)
            event.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: Int64(wid))
            event.setIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent, value: Int64(wid))
            event.postToPid(pid)
        }
        try? await Task.sleep(nanoseconds: 500_000_000)
        let afterCursor = CGEvent(source: nil)?.location ?? .zero
        return ["method": "CGEvent.postToPid plus explicit window fields", "before": before, "after": FinderAccess.describe(header),
                "minimizedAfter": FinderAccess.value(window, kAXMinimizedAttribute) as? Bool ?? false,
                "cursorBefore": NSStringFromPoint(cursor), "cursorAfter": NSStringFromPoint(afterCursor)]
    }
}
