import Foundation
@main struct SyncSessionSmoke {
 static func main() throws {
  let fm=FileManager.default, root=fm.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  try fm.createDirectory(at:root,withIntermediateDirectories:true); defer { try? fm.removeItem(at:root) }
  func plan(_ value:Int) -> Data { Data("{\"schema\":1,\"transactions\":[],\"debts\":[],\"incomeSources\":[],\"completed\":{},\"balance\":\(value)}".utf8) }
  let file=root.appendingPathComponent("shared.json"), store=SyncRecordStore(url:root.appendingPathComponent("local.json")), session=SyncSession(records:store)
  try SharedDocument.write(plan(1),to:file,expected:nil)
  let originalBookmark=try file.bookmarkData(options:[],includingResourceValuesForKeys:nil,relativeTo:nil)
  try session.link(file,validated:plan(1),bookmark:originalBookmark)
  try session.saveLocal(validated:plan(2))
  let sent=try session.sync(file,validate:{$0}); precondition(sent == .sent)
  let remote=try SharedDocument.read(file)
  try SharedDocument.write(plan(3),to:file,expected:SharedDocument.hash(remote))
  let received=try session.sync(file,validate:{$0}); precondition(received == .received)
  try session.saveLocal(validated:plan(4))
  let before=try SharedDocument.read(file);try SharedDocument.write(plan(5),to:file,expected:SharedDocument.hash(before))
  let conflict=try session.sync(file,validate:{$0}); precondition(conflict == .conflict)
  let local=try store.load()!, after=try SharedDocument.read(file)
  let expectedLocal=try SharedDocument.canonical(plan(4)), expectedRemote=try SharedDocument.canonical(plan(5))
  precondition(local.state == expectedLocal && after == expectedRemote)
  // Reselecting the same file preserves local edits and the old sync base.
  let renewedBookmark=try file.bookmarkData(options:[],includingResourceValuesForKeys:nil,relativeTo:nil)
  try session.reconnect(file,validated:after,bookmark:renewedBookmark)
  let reconnected=try store.load()!
  precondition(reconnected.state == local.state && reconnected.base == local.base && reconnected.bookmark == renewedBookmark)
  let stillConflict=try session.sync(file,validate:{$0}); precondition(stillConflict == .conflict)
  // A failed validation must not modify the last durable local record.
  let newFile=root.appendingPathComponent("second.json"), newStore=SyncRecordStore(url:root.appendingPathComponent("second-local.json")), newSession=SyncSession(records:newStore)
  try SharedDocument.write(plan(1),to:newFile,expected:nil)
  do { try session.reconnect(newFile,validated:plan(1),bookmark:renewedBookmark); fatalError("different file accepted") } catch SyncRecordError.localChanges {}
  try newSession.link(newFile,validated:plan(1),bookmark:Data("bookmark".utf8))
  let initial=try SharedDocument.read(newFile)
  try SharedDocument.write(plan(2),to:newFile,expected:SharedDocument.hash(initial))
  do { _ = try newSession.sync(newFile,validate:{ _ in throw SharedDocumentError.invalid }); fatalError("invalid accepted") } catch SharedDocumentError.invalid {}
  let afterFailure=try newStore.load()!, expectedInitial=try SharedDocument.canonical(plan(1))
  precondition(afterFailure.state == expectedInitial)
  try FileManager.default.removeItem(at:newFile)
  let removed=try newSession.sync(newFile,validate:{$0}); precondition(removed == .missing)
  let conflictLocalHash=SharedDocument.hash(local.state), conflictRemoteHash=SharedDocument.hash(after)
  do { try session.resolveSnapshot(file,choosing:.local,expectedLocal:conflictLocalHash,expectedRemote:"stale",validate:{$0}); fatalError("stale resolution accepted") } catch SharedDocumentError.changed {}
  let stillRemote=try SharedDocument.read(file); precondition(stillRemote==expectedRemote)
  try session.resolveSnapshot(file,choosing:.shared,expectedLocal:conflictLocalHash,expectedRemote:conflictRemoteHash,validate:{$0})
  let resolved=try store.load()!; precondition(resolved.state == expectedRemote && resolved.base == conflictRemoteHash)
  let backups=try fm.contentsOfDirectory(at:root.appendingPathComponent("ConflictBackups"),includingPropertiesForKeys:nil)
  precondition(backups.count==1)
  let archivedLocal=try Data(contentsOf:backups[0].appendingPathComponent("iphone.json")); precondition(archivedLocal == expectedLocal)
  let archivedRemote=try Data(contentsOf:backups[0].appendingPathComponent("shared.json")); precondition(archivedRemote == expectedRemote)
  func dated(_ value:Int,_ date:String) -> Data { Data("{\"schema\":1,\"transactions\":[],\"debts\":[],\"incomeSources\":[],\"completed\":{},\"balance\":\(value),\"autoFromDate\":\"\(date)\"}".utf8) }
  let dateFile=root.appendingPathComponent("checkpoint-shared.json"), dateStore=SyncRecordStore(url:root.appendingPathComponent("checkpoint-local.json")), dateSession=SyncSession(records:dateStore)
  try SharedDocument.write(dated(10,"2026-11-14"),to:dateFile,expected:nil)
  try dateSession.link(dateFile,validated:dated(10,"2026-11-14"),bookmark:Data("bookmark".utf8))
  try dateSession.saveLocal(validated:dated(20,"2026-11-14"))
  let dateOriginal=try SharedDocument.read(dateFile)
  try SharedDocument.write(dated(10,"2026-11-15"),to:dateFile,expected:SharedDocument.hash(dateOriginal))
  let mergedResult=try dateSession.sync(dateFile,validate:{$0});precondition(mergedResult == .sent)
  let dateMerged=try SharedDocument.read(dateFile), expectedMerged=try SharedDocument.canonical(dated(20,"2026-11-15"));precondition(dateMerged==expectedMerged)
  try dateSession.saveLocal(validated:dated(30,"2026-11-15"))
  try SharedDocument.write(dated(21,"2026-11-16"),to:dateFile,expected:SharedDocument.hash(dateMerged))
  let realConflict=try dateSession.sync(dateFile,validate:{$0});precondition(realConflict == .conflict)
  let switchFile=root.appendingPathComponent("switch-target.json"), switchStore=SyncRecordStore(url:root.appendingPathComponent("switch-local/record.json")), switchSession=SyncSession(records:switchStore)
  try SharedDocument.write(plan(40),to:switchFile,expected:nil)
  let oldState=try SharedDocument.canonical(plan(30)), newState=try SharedDocument.canonical(plan(40))
  try switchStore.save(SyncRecord(state:oldState,base:SharedDocument.hash(oldState),bookmark:Data("old".utf8)))
  do { _=try switchSession.switchDocument(switchFile,bookmark:Data("new".utf8),expectedLocal:"stale",expectedRemote:SharedDocument.hash(newState),validate:{$0});fatalError("changed local plan accepted") } catch SharedDocumentError.changed {}
  do { _=try switchSession.switchDocument(switchFile,bookmark:Data("new".utf8),expectedLocal:SharedDocument.hash(oldState),expectedRemote:"stale",validate:{$0});fatalError("stale switch accepted") } catch SharedDocumentError.changed {}
  let kept=try switchStore.load()!;precondition(kept.state==oldState && kept.bookmark==Data("old".utf8))
  do { _=try switchSession.switchDocument(switchFile,bookmark:Data("new".utf8),expectedLocal:SharedDocument.hash(oldState),expectedRemote:SharedDocument.hash(newState),validate:{_ in throw SharedDocumentError.invalid});fatalError("invalid switch accepted") } catch SharedDocumentError.invalid {}
  let switched=try switchSession.switchDocument(switchFile,bookmark:Data("new".utf8),expectedLocal:SharedDocument.hash(oldState),expectedRemote:SharedDocument.hash(newState),validate:{$0})
  precondition(switched==newState)
  let savedSwitch=try switchStore.load()!, unchangedTarget=try SharedDocument.read(switchFile)
  precondition(savedSwitch.state==newState && savedSwitch.base==SharedDocument.hash(newState) && savedSwitch.bookmark==Data("new".utf8) && unchangedTarget==newState)
  let switchBackups=try fm.contentsOfDirectory(at:switchStore.url.deletingLastPathComponent().appendingPathComponent("ConflictBackups"),includingPropertiesForKeys:nil)
  precondition(switchBackups.count==1)
  let archivedBeforeSwitch=try Data(contentsOf:switchBackups[0].appendingPathComponent("iphone-before-switch.json"));precondition(archivedBeforeSwitch==oldState)
  try switchSession.importSnapshot(validated:oldState)
  let imported=try switchStore.load()!;precondition(imported.state==oldState && imported.base==SharedDocument.hash(newState) && imported.bookmark==Data("new".utf8))
  let importFolders=try fm.contentsOfDirectory(at:switchStore.url.deletingLastPathComponent().appendingPathComponent("ConflictBackups"),includingPropertiesForKeys:nil)
  let archivedBeforeImport=importFolders.compactMap { try? Data(contentsOf:$0.appendingPathComponent("iphone-before-import.json")) }
  precondition(archivedBeforeImport.contains(newState))
  try SharedDocument.write(plan(50),to:switchFile,expected:SharedDocument.hash(newState))
  let importConflict=try switchSession.sync(switchFile,validate:{$0});precondition(importConflict == .conflict)
  let untouchedAfterImport=try SharedDocument.read(switchFile), expectedAfterImport=try SharedDocument.canonical(plan(50));precondition(untouchedAfterImport == expectedAfterImport)
  print("iOS sync session: upload, download and conflict preserved both versions")
 }
}
