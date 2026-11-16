import Foundation
@main struct SyncRecordSmoke {
 static func main() throws {
  let dir=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at:dir) }
  let store=SyncRecordStore(url:dir.appendingPathComponent("record.json"))
  let record=SyncRecord(state:Data("sample".utf8),base:"version-a",bookmark:Data("link".utf8))
  try store.save(record)
  let read=try store.load()!
  precondition(read.state==record.state && read.base==record.base && read.bookmark==record.bookmark)
  print("Atomic sync record round trip passed")
 }
}
