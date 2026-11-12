import Foundation

@main struct ManagerTests {
 static func main() throws {
  let fm = FileManager.default
  let root = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  let localDir = root.appendingPathComponent("local"), remoteDir = root.appendingPathComponent("cloud")
  try fm.createDirectory(at: localDir, withIntermediateDirectories: true)
  try fm.createDirectory(at: remoteDir, withIntermediateDirectories: true)
  defer { try? fm.removeItem(at: root) }
  let localURL = localDir.appendingPathComponent("data.json"), remoteURL = remoteDir.appendingPathComponent("FinRoad-sync.json")
  func state(_ balance: Int) -> [String:Any] { ["schema":1,"transactions":[],"debts":[],"incomeSources":[],"completed":[:],"balance":balance] }
  func saveLocal(_ balance: Int) throws { try JSONSerialization.data(withJSONObject:["revision":1,"state":state(balance)],options:[.sortedKeys]).write(to:localURL,options:.atomic) }
  func balance(_ bytes: Data) throws -> Int { let obj = try JSONSerialization.jsonObject(with:bytes) as! [String:Any]; return obj["balance"] as! Int }
  try saveLocal(1)
  let manager = SyncManager(directory: localDir)
  var status = ""
  manager.onStatus = { status = $0 }
  manager.onRemote = { remote, expected, done in
   do {
    let record = try JSONSerialization.jsonObject(with:Data(contentsOf:localURL)) as! [String:Any]
    let current = try SharedDocument.canonical(JSONSerialization.data(withJSONObject:record["state"]!,options:.sortedKeys))
    guard current == expected else { done("deferred"); return }
    let incoming = try JSONSerialization.jsonObject(with:remote)
    try JSONSerialization.data(withJSONObject:["revision":2,"state":incoming],options:.sortedKeys).write(to:localURL,options:.atomic)
    done("applied")
   } catch { done("deferred") }
  }
  func run() { status = ""; manager.run(); let end = Date().addingTimeInterval(5); while status.isEmpty && Date() < end { RunLoop.current.run(until:Date().addingTimeInterval(0.01)) }; if status.isEmpty { fatalError("sync timeout") } }
  func check(_ v: @autoclosure () -> Bool, _ label: String) { if !v() { fatalError(label) } }
  try manager.configure(remoteURL); run()
  let first = try SharedDocument.read(remoteURL); let firstBalance = try balance(first); check(firstBalance == 1, "first upload")
  try saveLocal(2); run(); let second = try SharedDocument.read(remoteURL); let secondBalance = try balance(second); check(secondBalance == 2, "local update")
  let edited = try JSONSerialization.data(withJSONObject:state(3),options:.sortedKeys)
  try SharedDocument.write(edited,to:remoteURL,expected:SharedDocument.hash(second)); run()
  let updated = try JSONSerialization.jsonObject(with:Data(contentsOf:localURL)) as! [String:Any]
  check((updated["state"] as! [String:Any])["balance"] as! Int == 3, "download")
  try saveLocal(4); let third = try SharedDocument.read(remoteURL)
  try SharedDocument.write(try JSONSerialization.data(withJSONObject:state(5)),to:remoteURL,expected:SharedDocument.hash(third)); run()
  check(status.contains("разные версии"), "conflict status")
  let final = try SharedDocument.read(remoteURL); let finalBalance = try balance(final); check(finalBalance == 5, "remote changed during conflict")
  let finalLocal = try JSONSerialization.jsonObject(with:Data(contentsOf:localURL)) as! [String:Any]
  check((finalLocal["state"] as! [String:Any])["balance"] as! Int == 4, "local changed during conflict")
  print("Sync manager upload, download and conflict tests passed")
 }
}
