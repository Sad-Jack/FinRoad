import AppKit

let size = 1024
let image = NSImage(size: NSSize(width: size, height: size))
image.lockFocus()
let context = NSGraphicsContext.current!.cgContext
context.clear(CGRect(x: 0, y: 0, width: size, height: size))
let rect = NSRect(x: 64, y: 64, width: 896, height: 896)
let tile = NSBezierPath(roundedRect: rect, xRadius: 200, yRadius: 200)
NSGraphicsContext.saveGraphicsState()
tile.addClip()
let gradient = NSGradient(starting: NSColor(calibratedRed: 0.15, green: 0.20, blue: 0.35, alpha: 1), ending: NSColor(calibratedRed: 0.035, green: 0.055, blue: 0.12, alpha: 1))!
gradient.draw(in: rect, angle: 90)
NSGraphicsContext.restoreGraphicsState()
// Crescent inspired by the app's original moon mark.
let moon = NSBezierPath()
moon.windingRule = .evenOdd
moon.appendOval(in: NSRect(x: 246, y: 223, width: 515, height: 515))
moon.appendOval(in: NSRect(x: 418, y: 348, width: 460, height: 460))
NSColor(calibratedRed: 0.80, green: 0.78, blue: 1, alpha: 1).setFill()
NSGraphicsContext.saveGraphicsState()
NSBezierPath(ovalIn: NSRect(x: 246, y: 223, width: 515, height: 515)).addClip()
moon.fill()
NSGraphicsContext.restoreGraphicsState()
func star(_ x: CGFloat, _ y: CGFloat, _ r: CGFloat, _ color: NSColor) {
    let path = NSBezierPath()
    path.move(to: NSPoint(x: x, y: y+r))
    path.curve(to: NSPoint(x: x+r, y: y), controlPoint1: NSPoint(x: x+r*0.18, y: y+r*0.18), controlPoint2: NSPoint(x: x+r*0.18, y: y+r*0.18))
    path.curve(to: NSPoint(x: x, y: y-r), controlPoint1: NSPoint(x: x+r*0.18, y: y-r*0.18), controlPoint2: NSPoint(x: x+r*0.18, y: y-r*0.18))
    path.curve(to: NSPoint(x: x-r, y: y), controlPoint1: NSPoint(x: x-r*0.18, y: y-r*0.18), controlPoint2: NSPoint(x: x-r*0.18, y: y-r*0.18))
    path.curve(to: NSPoint(x: x, y: y+r), controlPoint1: NSPoint(x: x-r*0.18, y: y+r*0.18), controlPoint2: NSPoint(x: x-r*0.18, y: y+r*0.18))
    path.close(); color.setFill(); path.fill()
}
let mint = NSColor(calibratedRed: 0.60, green: 0.87, blue: 0.78, alpha: 1)
star(728, 696, 83, mint)
star(750, 482, 31, mint.withAlphaComponent(0.75))
image.unlockFocus()
let data = image.tiffRepresentation!
let bitmap = NSBitmapImageRep(data: data)!
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
