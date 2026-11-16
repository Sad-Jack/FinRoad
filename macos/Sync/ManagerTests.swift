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
  var reviewResult: Result<SyncManager.ConflictReview,Error>?
  manager.reviewConflict { reviewResult=$0 }
  let reviewDeadline=Date().addingTimeInterval(5);while reviewResult == nil && Date()<reviewDeadline { RunLoop.current.run(until:Date().addingTimeInterval(0.01)) }
  guard let reviewResult else {fatalError("review timeout")};let review=try reviewResult.get()
  var resolution:Result<Void,Error>?
  manager.resolveConflict(review,useLocal:false) { resolution=$0 }
  let resolveDeadline=Date().addingTimeInterval(5);while resolution == nil && Date()<resolveDeadline { RunLoop.current.run(until:Date().addingTimeInterval(0.01)) }
  guard let resolution else {fatalError("resolution timeout")};try resolution.get()
  let resolved=try JSONSerialization.jsonObject(with:Data(contentsOf:localURL)) as! [String:Any]
  check((resolved["state"] as! [String:Any])["balance"] as! Int == 5,"resolution chose wrong version")
  let archives=try fm.contentsOfDirectory(at:localDir.appendingPathComponent("ConflictBackups"),includingPropertiesForKeys:nil)
  check(archives.count==1,"missing conflict archives")
  try saveLocal(6)
  let latest=try SharedDocument.read(remoteURL)
  try SharedDocument.write(try JSONSerialization.data(withJSONObject:state(7)),to:remoteURL,expected:SharedDocument.hash(latest))
  run(); check(status.contains("разные версии"),"second conflict")
  var secondReview:Result<SyncManager.ConflictReview,Error>?
  manager.reviewConflict { secondReview=$0 }
  let d1=Date().addingTimeInterval(5);while secondReview == nil && Date()<d1 { RunLoop.current.run(until:Date().addingTimeInterval(0.01)) }
  let oldReview=try secondReview!.get()
  let prior=try SharedDocument.read(remoteURL)
  try SharedDocument.write(try JSONSerialization.data(withJSONObject:state(8)),to:remoteURL,expected:SharedDocument.hash(prior))
  var staleResult:Result<Void,Error>?
  manager.resolveConflict(oldReview,useLocal:true) { staleResult=$0 }
  let d2=Date().addingTimeInterval(5);while staleResult == nil && Date()<d2 { RunLoop.current.run(until:Date().addingTimeInterval(0.01)) }
  do { try staleResult!.get();fatalError("stale Mac conflict selection accepted") } catch SharedDocumentError.changed {}
  let still=try SharedDocument.read(remoteURL); let stillBalance=try balance(still);check(stillBalance==8,"stale choice overwrote shared version")
  func dated(_ value:Int,_ date:String) -> [String:Any] { var s=state(value);s["autoFromDate"]=date;return s }
  let baseline=try SharedDocument.canonical(JSONSerialization.data(withJSONObject:dated(10,"2026-11-14")))
  let checkpoint=dated(10,"2026-11-15"), incoming=dated(20,"2026-11-14")
  try JSONSerialization.data(withJSONObject:["revision":3,"state":checkpoint]).write(to:localURL,options:.atomic)
  try JSONEncoder().encode(SyncManager.Configuration(path:remoteURL.path,base:SharedDocument.hash(baseline))).write(to:manager.configURL,options:.atomic)
  try SharedDocument.write(try JSONSerialization.data(withJSONObject:incoming),to:remoteURL,expected:SharedDocument.hash(still))
  run();check(status.contains("получены изменения"),"checkpoint blocked remote update")
  let merged=try JSONSerialization.jsonObject(with:Data(contentsOf:localURL)) as! [String:Any]
  let mergedState=merged["state"] as! [String:Any]
  check(mergedState["balance"] as! Int == 20 && mergedState["autoFromDate"] as! String == "2026-11-15","checkpoint merge lost data")
  run();let uploaded=try SharedDocument.read(remoteURL)
  let uploadedState=try JSONSerialization.jsonObject(with:uploaded) as! [String:Any]
  check(uploadedState["balance"] as! Int == 20 && uploadedState["autoFromDate"] as! String == "2026-11-15","checkpoint not uploaded")
  try JSONSerialization.data(withJSONObject:["revision":4,"state":dated(30,"2026-11-16")]).write(to:localURL,options:.atomic)
  try SharedDocument.write(try JSONSerialization.data(withJSONObject:dated(25,"2026-11-15")),to:remoteURL,expected:SharedDocument.hash(uploaded))
  run();check(status.contains("разные версии"),"financial conflict was silently merged")
  print("Sync manager upload, download and conflict tests passed")
 }
}
