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
                let semaphore = DispatchSemaphore(value: 0)
                var outcome = "deferred"
                DispatchQueue.main.async {
                    self.onRemote(remote, local) { result in outcome = result; semaphore.signal() }
                }
                semaphore.wait()
                if outcome == "applied" { cfg.base = SharedDocument.hash(remote); try persist(cfg); status("Синхронизация: получены изменения") }
                else if outcome == "invalid" { status("Синхронизация остановлена: облачный план не прошёл проверку. Локальные данные сохранены") }
                else { status("Синхронизация: изменения ожидают применения — закрой редактирование") }
            case .conflict:
                status("Синхронизация остановлена: разные версии плана. Локальные данные сохранены")
            case .remoteMissing:
                status("Синхронизация остановлена: общий файл не найден. Локальные данные сохранены")
            }
        } catch { status("Синхронизация остановлена: \(error.localizedDescription)") }
    }
}
