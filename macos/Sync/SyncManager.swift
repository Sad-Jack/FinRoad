import Foundation

/// Owns one configured shared document. Work is serialized off the UI thread.
final class SyncManager {
    struct Configuration: Codable { var path: String; var base: String? }
    let configURL: URL
    let localURL: URL
    let queue = DispatchQueue(label: "ru.finroad.sync")
    var onStatus: (String) -> Void = { _ in }
    var onRemote: (Data, Data, @escaping (String) -> Void) -> Void = { _,_,done in done("deferred") }
    init(directory: URL) { configURL = directory.appendingPathComponent("sync-config.json"); localURL = directory.appendingPathComponent("data.json") }
    func configuration() throws -> Configuration? {
        guard FileManager.default.fileExists(atPath: configURL.path) else { return nil }
        return try JSONDecoder().decode(Configuration.self, from: Data(contentsOf: configURL))
    }
    func configure(_ url: URL) throws {
        let cfg = Configuration(path: url.path, base: nil)
        try FileManager.default.createDirectory(at: configURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(cfg).write(to: configURL, options: .atomic)
    }
    func disconnect() throws { if FileManager.default.fileExists(atPath: configURL.path) { try FileManager.default.removeItem(at: configURL) } }
    func run() {
        queue.async { [weak self] in self?.cycle() }
    }
    private func status(_ value: String) { DispatchQueue.main.async { self.onStatus(value) } }
    private func localSnapshot() throws -> Data {
        let record = try JSONSerialization.jsonObject(with: Data(contentsOf: localURL)) as? [String: Any]
        guard let state = record?["state"] else { throw SharedDocumentError.invalid }
        return try SharedDocument.canonical(JSONSerialization.data(withJSONObject: state, options: [.sortedKeys]))
    }
    private func persist(_ cfg: Configuration) throws {
        // A user can disconnect or switch documents while I/O is in progress.
        guard let current = try configuration(), current.path == cfg.path else { throw SharedDocumentError.changed }
        try JSONEncoder().encode(cfg).write(to: configURL, options: .atomic)
    }
    private func applyRemote(_ data: Data, expectedLocal: Data) -> String {
        let semaphore = DispatchSemaphore(value: 0)
        var outcome = "deferred"
        DispatchQueue.main.async { self.onRemote(data, expectedLocal) { result in outcome = result; semaphore.signal() } }
        semaphore.wait()
        return outcome
    }
    private func cycle() {
        do {
            guard var cfg = try configuration() else { return }
            let url = URL(fileURLWithPath: cfg.path)
            let local = try localSnapshot(); let localHash = SharedDocument.hash(local)
            let exists = FileManager.default.fileExists(atPath: url.path)
            let remote = exists ? try SharedDocument.read(url) : nil
            let remoteHash = remote.map(SharedDocument.hash)
            switch syncDecision(base: cfg.base, local: localHash, remote: remoteHash) {
            case .unchanged:
                if cfg.base != localHash { cfg.base = localHash; try persist(cfg) }
                status("Синхронизация: сохранено в iCloud Drive (статус загрузки — в Finder)")
            case .upload(let expected):
                // Prevent a disconnected target from receiving an in-flight write.
                guard let current = try configuration(), current.path == cfg.path else { return }
                try SharedDocument.write(local, to: url, expected: expected)
                cfg.base = localHash; try persist(cfg)
                status("Синхронизация: сохранено в iCloud Drive (статус загрузки — в Finder)")
            case .download:
                guard let remote else { throw SharedDocumentError.missing }
                let outcome = applyRemote(remote, expectedLocal: local)
                if outcome == "applied" { cfg.base = SharedDocument.hash(remote); try persist(cfg); status("Синхронизация: получены изменения") }
                else if outcome == "invalid" { status("Синхронизация остановлена: облачный план не прошёл проверку. Локальные данные сохранены") }
                else { status("Синхронизация: изменения ожидают применения — закрой редактирование") }
            case .conflict:
                if let remote, let merged = try mergeCheckpointOnly(base: cfg.base, checkpoint: local, edited: remote) {
                    let outcome = applyRemote(merged, expectedLocal: local)
                    if outcome == "applied" {
                        // Base is the actual shared file; the retained checkpoint
                        // is uploaded on the next conditional sync cycle.
                        cfg.base = SharedDocument.hash(remote); try persist(cfg)
                        status("Синхронизация: получены изменения")
                    } else if outcome == "invalid" { status("Синхронизация остановлена: облачный план не прошёл проверку. Локальные данные сохранены") }
                    else { status("Синхронизация: изменения ожидают применения — закрой редактирование") }
                } else { status("Синхронизация остановлена: разные версии плана. Локальные данные сохранены") }
            case .remoteMissing:
                status("Синхронизация остановлена: общий файл не найден. Локальные данные сохранены")
            }
        } catch { status("Синхронизация остановлена: \(error.localizedDescription)") }
    }
}

extension SyncManager {
    struct ConflictReview {
        let local: Data
        let remote: Data
        let localHash: String
        let remoteHash: String
    }
    func reviewConflict(completion: @escaping (Result<ConflictReview, Error>) -> Void) {
        queue.async {
            let result: Result<ConflictReview, Error> = Result {
                guard let cfg = try self.configuration() else { throw SharedDocumentError.missing }
                let local = try self.localSnapshot()
                let remote = try SharedDocument.read(URL(fileURLWithPath: cfg.path))
                let localHash = SharedDocument.hash(local), remoteHash = SharedDocument.hash(remote)
                guard syncDecision(base: cfg.base, local: localHash, remote: remoteHash) == .conflict else { throw SharedDocumentError.changed }
                return ConflictReview(local:local,remote:remote,localHash:localHash,remoteHash:remoteHash)
            }
            DispatchQueue.main.async { completion(result) }
        }
    }
    func resolveConflict(_ review: ConflictReview, useLocal: Bool, completion: @escaping (Result<Void, Error>) -> Void) {
        queue.async {
            let result: Result<Void, Error> = Result {
                guard var cfg = try self.configuration() else { throw SharedDocumentError.missing }
                let url = URL(fileURLWithPath:cfg.path)
                let local = try self.localSnapshot(), remote = try SharedDocument.read(url)
                guard SharedDocument.hash(local) == review.localHash, SharedDocument.hash(remote) == review.remoteHash,
                      syncDecision(base:cfg.base,local:review.localHash,remote:review.remoteHash) == .conflict else {throw SharedDocumentError.changed}
                let folder=self.configURL.deletingLastPathComponent().appendingPathComponent("ConflictBackups",isDirectory:true).appendingPathComponent(UUID().uuidString,isDirectory:true)
                try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true)
                try local.write(to:folder.appendingPathComponent("mac.json"),options:.atomic)
                try remote.write(to:folder.appendingPathComponent("shared.json"),options:.atomic)
                if useLocal {
                    try SharedDocument.write(local,to:url,expected:review.remoteHash)
                    cfg.base=review.localHash
                } else {
                    let semaphore=DispatchSemaphore(value:0);var outcome="deferred"
                    DispatchQueue.main.async { self.onRemote(remote,local) { value in outcome=value;semaphore.signal() } }
                    semaphore.wait()
                    guard outcome == "applied" else {throw SharedDocumentError.changed}
                    cfg.base=review.remoteHash
                }
                try self.persist(cfg)
            }
            DispatchQueue.main.async { completion(result) }
        }
    }
}
