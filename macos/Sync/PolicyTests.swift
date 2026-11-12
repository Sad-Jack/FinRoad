import Foundation

@main struct PolicyTests {
 static func main() throws {
  func check(_ value: @autoclosure () -> Bool, _ name: String) { if !value() { fatalError(name) } }
  check(syncDecision(base: nil, local: "L", remote: nil) == .upload(expected: nil), "new file")
  check(syncDecision(base: nil, local: "L", remote: "R") == .conflict, "independent")
  check(syncDecision(base: "A", local: "A", remote: "B") == .download, "remote edit")
  check(syncDecision(base: "A", local: "B", remote: "A") == .upload(expected: "A"), "local edit")
  check(syncDecision(base: "A", local: "B", remote: "C") == .conflict, "concurrent edits")
  check(syncDecision(base: "A", local: "B", remote: nil) == .remoteMissing, "deleted")
  check(syncDecision(base: "A", local: "B", remote: "B") == .unchanged, "recovery")
  let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: dir) }
  let url = dir.appendingPathComponent("sync.json")
  let a = Data("{\"schema\":1,\"transactions\":[],\"debts\":[],\"incomeSources\":[],\"completed\":{},\"balance\":0}".utf8)
  let b = Data("{\"schema\":1,\"transactions\":[],\"debts\":[],\"incomeSources\":[],\"completed\":{},\"balance\":1}".utf8)
  try SharedDocument.write(a,to:url,expected:nil)
  let hash = SharedDocument.hash(try SharedDocument.read(url))
  do { try SharedDocument.write(b,to:url,expected:"stale"); fatalError("stale update accepted") } catch SharedDocumentError.changed {}
  let afterStale = SharedDocument.hash(try SharedDocument.read(url)); check(afterStale == hash, "stale write changed file")
  try SharedDocument.write(b,to:url,expected:hash)
  let afterUpdate = SharedDocument.hash(try SharedDocument.read(url)); check(afterUpdate != hash, "update failed")
  do { try SharedDocument.write(Data("{}".utf8),to:url,expected:nil); fatalError("invalid accepted") } catch SharedDocumentError.invalid {}
  print("Sync policy and coordinated file tests passed")
 }
}
