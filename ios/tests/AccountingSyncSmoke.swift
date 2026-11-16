import Foundation
@main struct AccountingSyncSmoke {
 static func main() throws {
  let engine=try FinanceEngine(resources:URL(fileURLWithPath:CommandLine.arguments[1]))
  let raw=Data(#"{"schema":1,"demo":false,"balance":100000,"balanceDate":"2026-11-14","autoFromDate":"2026-11-14","transactions":[{"id":"x","name":"Расход","kind":"expense","amount":20000,"repeat":"once","date":"2026-11-15"}],"debts":[],"incomeSources":[],"completed":{}}"#.utf8)
  let original=try SharedDocument.canonical(engine.validate(raw).0)
  let parent=CommandLine.arguments.count>2 ? URL(fileURLWithPath:CommandLine.arguments[2],isDirectory:true) : FileManager.default.temporaryDirectory
  let folder=parent.appendingPathComponent("finroad-accounting-sync-"+UUID().uuidString)
  try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true)
  defer { try? FileManager.default.removeItem(at:folder) }
  func pair(_ name:String) throws -> (URL,SyncRecordStore,SyncSession) {
   let root=folder.appendingPathComponent(name);try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true)
   let file=root.appendingPathComponent("shared.json"), records=SyncRecordStore(url:root.appendingPathComponent("record.json")), session=SyncSession(records:records)
   try SharedDocument.write(original,to:file,expected:nil);try session.link(file,validated:original,bookmark:Data("test".utf8));return(file,records,session)
  }
  // Two devices account the same base independently: the shared snapshot is identical.
  let (file1,records1,phone1)=try pair("parallel")
  let macAuto=try SharedDocument.canonical(engine.closePastDays(original,now:"2026-11-16").data)
  let phoneAuto=try SharedDocument.canonical(engine.closePastDays(original,now:"2026-11-16").data)
  precondition(macAuto==phoneAuto)
  try phone1.saveLocal(validated:phoneAuto);try SharedDocument.write(macAuto,to:file1,expected:SharedDocument.hash(original))
  let same=try phone1.sync(file1,validate:{try engine.validate($0).0});precondition(same == .current)
  let joined=try records1.load()!;let joinedPlan=try engine.validate(joined.state).1;precondition(joinedPlan.balance==80000)
  // Offline accounting is retained and sent when the original version returns.
  let (file2,records2,phone2)=try pair("offline")
  try phone2.saveLocal(validated:phoneAuto)
  let sent=try phone2.sync(file2,validate:{try engine.validate($0).0});precondition(sent == .sent)
  let delivered=try SharedDocument.read(file2), stored=try records2.load()!;precondition(delivered==phoneAuto && stored.base==SharedDocument.hash(phoneAuto))
  // A later manual completion is downloaded before the phone accounts the day.
  let (file3,records3,phone3)=try pair("download-first")
  let manually=try SharedDocument.canonical(engine.toggleEvent(original,key:"x:2026-11-15",completed:false,now:"2026-11-14",end:"2026-11-30"))
  try SharedDocument.write(manually,to:file3,expected:SharedDocument.hash(original))
  let received=try phone3.sync(file3,validate:{try engine.validate($0).0});precondition(received == .received)
  let fetched=try records3.load()!,after=try engine.closePastDays(fetched.state,now:"2026-11-16"),afterPlan=try engine.validate(after.data).1
  precondition(after.count==0 && afterPlan.balance==80000)
  // Different edits remain a conflict; neither version may be discarded.
  let (file4,records4,phone4)=try pair("conflict")
  try phone4.saveLocal(validated:phoneAuto)
  let macEdit=try SharedDocument.canonical(engine.updateBalance(original,amount:150000,date:"2026-11-14"))
  try SharedDocument.write(macEdit,to:file4,expected:SharedDocument.hash(original))
  let conflict=try phone4.sync(file4,validate:{try engine.validate($0).0});precondition(conflict == .conflict)
  let local=try records4.load()!,remote=try SharedDocument.read(file4);precondition(local.state==phoneAuto && remote==macEdit)
  print("Accounting sync: duplicate, offline, download-first and conflict checks passed")
 }
}
