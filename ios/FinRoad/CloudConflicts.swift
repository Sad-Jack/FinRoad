import Foundation

struct CloudConflictSnapshot {
    struct Version { let id: String; let label: String; let data: Data }
    let versions: [Version]
    let fingerprint: [String]
}

/// No iCloud version is marked resolved until every version is archived locally.
final class CloudConflicts {
    let records: SyncRecordStore
    init(records: SyncRecordStore) { self.records = records }
    private func collect(_ url: URL) throws -> (CloudConflictSnapshot, [NSFileVersion]) {
        guard let record = try records.load() else { throw SyncRecordError.unavailable }
        let conflicts = NSFileVersion.unresolvedConflictVersionsOfItem(at:url) ?? []
        guard !conflicts.isEmpty else { throw SharedDocumentError.changed }
        let current = try SharedDocument.canonical(Data(contentsOf:url))
        let local = try SharedDocument.canonical(record.state)
        var versions = [CloudConflictSnapshot.Version(id:"local:"+SharedDocument.hash(local),label:"На iPhone",data:local), CloudConflictSnapshot.Version(id:"current:"+SharedDocument.hash(current),label:"Текущая версия iCloud",data:current)]
        for (index, version) in conflicts.enumerated() {
            let value = try SharedDocument.canonical(Data(contentsOf:version.url))
            versions.append(.init(id:"conflict:\(index):"+SharedDocument.hash(value),label:"Конфликтующая версия iCloud \(index+1)",data:value))
        }
        return (CloudConflictSnapshot(versions:versions,fingerprint:versions.map(\.id).sorted()),conflicts)
    }
    func snapshot(_ url: URL) throws -> CloudConflictSnapshot {
        var e:NSError?; var result:Result<CloudConflictSnapshot,Error>?
        NSFileCoordinator().coordinate(readingItemAt:url,options:[],error:&e) { u in result = Result { try self.collect(u).0 } }
        if let e {throw e};guard let result else {throw SharedDocumentError.missing};return try result.get()
    }
    func resolve(_ url:URL, choice:String, expected:[String], validate:(Data)throws->Data) throws {
        var e:NSError?;var result:Result<Void,Error>?
        NSFileCoordinator().coordinate(writingItemAt:url,options:.forReplacing,error:&e) { u in
            result = Result {
                let (snapshot, conflicts) = try self.collect(u)
                guard snapshot.fingerprint == expected, let selected=snapshot.versions.first(where:{$0.id==choice}) else { throw SharedDocumentError.changed }
                for v in snapshot.versions { guard try SharedDocument.canonical(validate(v.data)) == v.data else {throw SharedDocumentError.invalid} }
                let folder=self.records.url.deletingLastPathComponent().appendingPathComponent("ConflictBackups",isDirectory:true).appendingPathComponent(UUID().uuidString,isDirectory:true)
                try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true)
                for (i,version) in snapshot.versions.enumerated() { try version.data.write(to:folder.appendingPathComponent("version-\(i).json"),options:.atomic) }
                // A failed write leaves all iCloud versions unresolved and all archives intact.
                try selected.data.write(to:u,options:.atomic)
                for version in conflicts { version.isResolved = true }
                guard var record=try self.records.load() else {throw SyncRecordError.unavailable}
                record.state=selected.data;record.base=SharedDocument.hash(selected.data);try self.records.save(record)
            }
        }
        if let e {throw e};guard let result else {throw SharedDocumentError.missing};try result.get()
    }
}
