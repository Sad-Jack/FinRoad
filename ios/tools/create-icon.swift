import AppKit
import ImageIO
import UniformTypeIdentifiers

// The iOS icon uses the same moon and stars as macos/assets/create-icon.swift.
// Its background fills the canvas: iOS applies the icon mask itself.
let size = 1024
let context = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8,
    bytesPerRow: size * 4, space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGBitmapInfo.byteOrder32Big.rawValue | CGImageAlphaInfo.noneSkipLast.rawValue)!
let graphics = NSGraphicsContext(cgContext: context, flipped: false)
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = graphics
let canvas = NSRect(x: 0, y: 0, width: size, height: size)
let gradient = NSGradient(starting: NSColor(calibratedRed: 0.15, green: 0.20, blue: 0.35, alpha: 1), ending: NSColor(calibratedRed: 0.035, green: 0.055, blue: 0.12, alpha: 1))!
gradient.draw(in: canvas, angle: 90)

// Remove the Mac icon's outer padding while keeping the mark in proportion.
context.scaleBy(x: 1024.0 / 896.0, y: 1024.0 / 896.0)
context.translateBy(x: -64, y: -64)
context.saveGState()
context.beginTransparencyLayer(auxiliaryInfo: nil)
NSColor(calibratedRed: 0.80, green: 0.78, blue: 1, alpha: 1).setFill()
NSBezierPath(ovalIn: NSRect(x: 246, y: 223, width: 515, height: 515)).fill()
context.setBlendMode(.destinationOut)
NSColor.black.setFill()
NSBezierPath(ovalIn: NSRect(x: 418, y: 348, width: 460, height: 460)).fill()
context.endTransparencyLayer()
context.restoreGState()
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
NSGraphicsContext.restoreGraphicsState()
let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: CommandLine.arguments[1]) as CFURL,
    UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(destination, context.makeImage()!, nil)
guard CGImageDestinationFinalize(destination) else { fatalError("Could not write icon") }
