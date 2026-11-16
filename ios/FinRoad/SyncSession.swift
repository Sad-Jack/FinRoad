import Foundation

/// Coordinates a testable snapshot exchange. Call off the UI thread.
final class SyncSession {
    let records: SyncRecordStore
    init(records: SyncRecordStore) { self.records = records }
    enum ResultState: Equatable { case current, sent, received, conflict, missing }

    /// The caller must validate the imported document before calling this method.
    func link(_ url: URL, validated: Data, bookmark: Data) throws {
        let remote = try SharedDocument.read(url)
        guard remote == (try SharedDocument.canonical(validated)) else { throw SharedDocumentError.changed }
        if let previous = try records.load() {
            let local = try SharedDocument.canonical(previous.state)
            guard local == remote else { throw SyncRecordError.localChanges }
        }
        try records.save(SyncRecord(state: remote, base: SharedDocument.hash(remote), bookmark: bookmark))
    }

    /// Refresh access to the same selected document without replacing the local snapshot
    /// or the common base. A subsequent sync can then safely detect divergence.
    func reconnect(_ url: URL, validated: Data, bookmark: Data) throws {
        guard var record = try records.load(), let oldBookmark = record.bookmark else { throw SyncRecordError.unavailable }
        var stale = false
        let previousURL = try URL(resolvingBookmarkData: oldBookmark, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
        guard previousURL.standardizedFileURL.resolvingSymlinksInPath() == url.standardizedFileURL.resolvingSymlinksInPath() else { throw SyncRecordError.localChanges }
        let remote = try SharedDocument.read(url)
        guard remote == (try SharedDocument.canonical(validated)) else { throw SharedDocumentError.changed }
        record.bookmark = bookmark
        try records.save(record)
    }

    /// Switch only after an explicit choice. The current local plan is archived
    /// first; the newly selected document is read, never overwritten here.
    func switchDocument(_ url: URL, bookmark: Data, expectedLocal: String, expectedRemote: String, validate: (Data) throws -> Data) throws -> Data {
        guard let record = try records.load() else { throw SyncRecordError.unavailable }
        let local = try SharedDocument.canonical(record.state)
        guard SharedDocument.hash(local) == expectedLocal else { throw SharedDocumentError.changed }
        let remote = try SharedDocument.read(url)
        guard SharedDocument.hash(remote) == expectedRemote else { throw SharedDocumentError.changed }
        let checked = try SharedDocument.canonical(validate(remote))
        guard checked == remote else { throw SharedDocumentError.invalid }
        let folder = records.url.deletingLastPathComponent().appendingPathComponent("ConflictBackups", isDirectory:true).appendingPathComponent(UUID().uuidString, isDirectory:true)
        try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true)
        try local.write(to:folder.appendingPathComponent("iphone-before-switch.json"),options:.atomic)
        guard SharedDocument.hash(try SharedDocument.read(url)) == expectedRemote,
              let latest = try records.load(), try SharedDocument.hash(SharedDocument.canonical(latest.state)) == expectedLocal,
              latest.base == record.base, latest.bookmark == record.bookmark else { throw SharedDocumentError.changed }
        try records.save(SyncRecord(state:remote,base:expectedRemote,bookmark:bookmark))
        return remote
    }

    /// Caller validates the complete snapshot before saving an edit.
    func saveLocal(validated: Data) throws {
        guard var record = try records.load() else { throw SyncRecordError.unavailable }
        record.state = try SharedDocument.canonical(validated)
        try records.save(record)
    }

    /// Import is a local edit. The previous common base is retained, so a
    /// changed shared file is treated as a conflict instead of overwritten.
    func importSnapshot(validated: Data, fallback: Data? = nil) throws {
        let imported = try SharedDocument.canonical(validated)
        let current = try records.load()
        if let previous = current?.state ?? fallback {
            let folder = records.url.deletingLastPathComponent().appendingPathComponent("ConflictBackups", isDirectory:true).appendingPathComponent(UUID().uuidString, isDirectory:true)
            try FileManager.default.createDirectory(at:folder, withIntermediateDirectories:true)
            try SharedDocument.canonical(previous).write(to:folder.appendingPathComponent("iphone-before-import.json"), options:.atomic)
        }
        let latest = try records.load()
        guard latest?.state == current?.state, latest?.base == current?.base, latest?.bookmark == current?.bookmark else { throw SharedDocumentError.changed }
        try records.save(SyncRecord(state:imported, base:current?.base, bookmark:current?.bookmark))
    }

    /// Validate a remote version before it becomes the local plan.
    func sync(_ url: URL, validate: (Data) throws -> Data) throws -> ResultState {
        guard var record = try records.load() else { throw SyncRecordError.unavailable }
        let local = try SharedDocument.canonical(record.state)
        let remote: Data
        do { remote = try SharedDocument.read(url) }
        catch let error as CocoaError where error.code == .fileReadNoSuchFile { return .missing }
        let remoteHash = SharedDocument.hash(remote)
        let localHash = SharedDocument.hash(local)
        switch syncDecision(base: record.base, local: localHash, remote: remoteHash) {
        case .unchanged:
            if record.base != localHash { record.base = localHash; try records.save(record) }
            return .current
        case .upload(let expected):
            try SharedDocument.write(local, to: url, expected: expected)
            record.base = localHash; try records.save(record)
            return .sent
        case .download:
            let validated = try SharedDocument.canonical(validate(remote))
            guard validated == remote else { throw SharedDocumentError.invalid }
            record.state = validated; record.base = remoteHash; try records.save(record)
            return .received
        case .conflict:
            if let merged = try mergeCheckpointOnly(base: record.base, checkpoint: remote, edited: local) {
                let validated = try SharedDocument.canonical(validate(merged))
                guard validated == merged else { throw SharedDocumentError.invalid }
                try SharedDocument.write(merged, to: url, expected: remoteHash)
                record.state = merged; record.base = SharedDocument.hash(merged); try records.save(record)
                return .sent
            }
            if let merged = try mergeCheckpointOnly(base: record.base, checkpoint: local, edited: remote) {
                let validated = try SharedDocument.canonical(validate(merged))
                guard validated == merged else { throw SharedDocumentError.invalid }
                record.state = merged; record.base = remoteHash; try records.save(record)
                return .received
            }
            return .conflict
        case .remoteMissing: return .missing
        }
    }
}

extension SyncSession {
    enum Choice { case local, shared }
    /// Resolve an ordinary snapshot conflict. OS-level iCloud conflicts are deliberately
    /// rejected by SharedDocument.read and are never cleared by this operation.
    func resolveSnapshot(_ url: URL, choosing choice: Choice, expectedLocal: String, expectedRemote: String, validate: (Data) throws -> Data) throws {
        guard var record = try records.load() else { throw SyncRecordError.unavailable }
        let local = try SharedDocument.canonical(record.state)
        let remote = try SharedDocument.read(url)
        guard SharedDocument.hash(local) == expectedLocal, SharedDocument.hash(remote) == expectedRemote else { throw SharedDocumentError.changed }
        guard syncDecision(base: record.base, local: expectedLocal, remote: expectedRemote) == .conflict else { throw SharedDocumentError.changed }
        let validatedLocal = try SharedDocument.canonical(validate(local))
        let validatedRemote = try SharedDocument.canonical(validate(remote))
        guard local == validatedLocal && remote == validatedRemote else { throw SharedDocumentError.invalid }
        let folder = records.url.deletingLastPathComponent().appendingPathComponent("ConflictBackups", isDirectory:true).appendingPathComponent(UUID().uuidString, isDirectory:true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories:true)
        try local.write(to:folder.appendingPathComponent("iphone.json"),options:.atomic)
        try remote.write(to:folder.appendingPathComponent("shared.json"),options:.atomic)
        switch choice {
        case .local:
            try SharedDocument.write(local, to:url, expected:expectedRemote)
            record.state = local; record.base = expectedLocal
        case .shared:
            // Recheck before changing local state; failure preserves both backups and current plan.
            guard SharedDocument.hash(try SharedDocument.read(url)) == expectedRemote else { throw SharedDocumentError.changed }
            record.state = remote; record.base = expectedRemote
        }
        try records.save(record)
    }
}
