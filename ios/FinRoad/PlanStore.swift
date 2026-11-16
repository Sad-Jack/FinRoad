import Foundation
import SwiftUI
import UniformTypeIdentifiers
import UIKit

struct PlanConflict {
    let localHash: String
    let remoteHash: String
    let localBalance: Int64?
    let remoteBalance: Int64?
    let localPlan: Plan
    let remotePlan: Plan
}

struct CloudChoice: Identifiable { let id: String; let title: String; let balance: Int64?; let count: Int; let plan: Plan }
struct CloudConflictDisplay { let snapshot: CloudConflictSnapshot; let choices: [CloudChoice] }
struct PendingPlanSwitch {
    let bookmark: Data
    let localHash: String
    let remoteHash: String
    let fileName: String
    let folderName: String
}
private enum PlanAccessError: LocalizedError {
    case stale
    var errorDescription: String? { "Доступ устарел · выбери файл снова" }
}

@MainActor final class PlanStore: ObservableObject {
    @Published var plan: Plan?
    @Published var forecast: Forecast?
    @Published var error: String?
    @Published var status = "Файл не выбран"
    @Published var syncing = false
    @Published var conflict: PlanConflict?
    @Published var cloudConflict: CloudConflictDisplay?
    @Published var accountingError: String?
    @Published var backupFiles: [URL] = []
    @Published var pendingSwitch: PendingPlanSwitch?
    @Published var isEditing = false
    var shortSyncStatus: String {
        if syncing { return "Проверка" }
        if conflict != nil || cloudConflict != nil { return "Нужен выбор" }
        guard let record = try? recordStore.load(), record.bookmark != nil else { return "Не подключено" }
        if let local = try? SharedDocument.canonical(record.state), record.base != SharedDocument.hash(local) { return "Ожидает обмена" }
        if status.contains("Нет обмена") || status.contains("Нет доступа") || status.contains("не найден") || status.contains("Не удалось") { return "Нужна проверка" }
        if status.contains("совпадают") || status.contains("Записано в файл") { return "В файле" }
        if status.contains("Получены изменения") { return "Получено" }
        if status.contains("ожидает обмена") { return "Ожидает обмена" }
        return "Нужна проверка"
    }
    @Published var selectedDate = Calendar.current.date(byAdding: .day, value: 30, to: Date()) ?? Date() { didSet { calculate() } }
    private var data: Data?
    private var engine: FinanceEngine?
    private var bookmark: Data? { get { UserDefaults.standard.data(forKey: "planBookmark") } set { UserDefaults.standard.set(newValue, forKey: "planBookmark") } }
    private var cache: URL { FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("FinRoad/plan-cache.json") }
    private var recordStore: SyncRecordStore { SyncRecordStore(url: cache.deletingLastPathComponent().appendingPathComponent("sync-record.json")) }
    init() {
        do {
            guard let directory = Bundle.main.url(forResource: "Finance", withExtension: nil) else { throw FinanceError.missingResource }
            engine = try FinanceEngine(resources: directory)
            reloadBackupFiles()
            if let record = try recordStore.load() { try accept(record.state); status = "План на iPhone · проверь синхронизацию" }
            else if FileManager.default.fileExists(atPath: cache.path) { try accept(Data(contentsOf: cache)); status = "Локальная копия · только просмотр" }
        } catch { self.error = error.localizedDescription }
    }
    func connect(_ url: URL) {
        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }
        defer { if pendingSwitch == nil { isEditing = false } }
        do {
            let result = try coordinatedRead(url)
            let (validated, candidate) = try validatedPlan(result)
            let newBookmark = try url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
            let session = SyncSession(records: recordStore)
            do { try session.link(url, validated: validated, bookmark: newBookmark) }
            catch SyncRecordError.localChanges {
                // Reauthorizing the same file must preserve unsent local edits and
                // the old base so the next exchange can reveal a conflict.
                guard let record = try recordStore.load() else { throw SyncRecordError.unavailable }
                var stale = false
                let previousURL = record.bookmark.flatMap { try? URL(resolvingBookmarkData:$0,options:[],relativeTo:nil,bookmarkDataIsStale:&stale) }
                if previousURL?.standardizedFileURL.resolvingSymlinksInPath() == url.standardizedFileURL.resolvingSymlinksInPath() {
                    try session.reconnect(url, validated: validated, bookmark: newBookmark)
                    bookmark = newBookmark
                    conflict = nil; cloudConflict = nil
                    isEditing = false; status = "Доступ обновлён · проверяем изменения"; refresh()
                } else {
                    let local = try SharedDocument.canonical(record.state)
                    let parent = url.deletingLastPathComponent().lastPathComponent
                    pendingSwitch = PendingPlanSwitch(bookmark:newBookmark,localHash:SharedDocument.hash(local),remoteHash:SharedDocument.hash(try SharedDocument.canonical(validated)),fileName:url.lastPathComponent,folderName:parent == "com~apple~CloudDocs" ? "iCloud Drive" : parent)
                    isEditing = true; status = "Выбери, какой план открыть"
                }
                return
            }
            bookmark = newBookmark
            conflict = nil; cloudConflict = nil
            data = validated; plan = candidate; calculate(); status = "Файл подключён · сохранено на iPhone"
        } catch { self.error = error.localizedDescription; status = "Нет доступа · показана локальная копия" }
    }
    func cancelSwitch() { pendingSwitch = nil; isEditing = false; refresh(automatic:true) }
    func confirmSwitch() {
        guard !syncing, let pending = pendingSwitch, let resources = Bundle.main.url(forResource:"Finance",withExtension:nil) else { return }
        do {
            var stale = false
            let url = try URL(resolvingBookmarkData:pending.bookmark,options:[],relativeTo:nil,bookmarkDataIsStale:&stale)
            guard !stale else { throw PlanAccessError.stale }
            let records = recordStore
            pendingSwitch = nil; syncing = true; status = "Сохраняем копию и открываем план…"
            Task {
                let result = await Task.detached { () -> Result<Data,Error> in Result {
                    let allowed = url.startAccessingSecurityScopedResource(); defer { if allowed { url.stopAccessingSecurityScopedResource() } }
                    let engine = try FinanceEngine(resources:resources)
                    return try SyncSession(records:records).switchDocument(url,bookmark:pending.bookmark,expectedLocal:pending.localHash,expectedRemote:pending.remoteHash,validate:{try engine.validate($0).0})
                } }.value
                syncing = false; isEditing = false; reloadBackupFiles()
                switch result {
                case .success(let state):
                    do { try accept(state); bookmark=pending.bookmark; conflict=nil; cloudConflict=nil; status="План подключён · прежняя копия сохранена"; refresh(automatic:true) }
                    catch { self.error=error.localizedDescription }
                case .failure(let error): self.error=error.localizedDescription; status="Не удалось переключить план · прежний план сохранён"
                }
            }
        } catch { pendingSwitch=nil; isEditing=false; self.error=error.localizedDescription }
    }
    func refresh(automatic: Bool = false) {
        guard !syncing && !isEditing && (!automatic || (conflict == nil && cloudConflict == nil)) else { return }
        guard let record = try? recordStore.load(), let bookmark = record.bookmark else { status = "Выбери общий файл iCloud Drive"; _ = accountPastEvents(); return }
        do {
            var stale = false
            let url = try URL(resolvingBookmarkData: bookmark, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
            let records = recordStore
            let ownFolder = cache.deletingLastPathComponent().standardizedFileURL.resolvingSymlinksInPath().path
            guard let resources = Bundle.main.url(forResource: "Finance", withExtension: nil) else { throw FinanceError.missingResource }
            syncing = true; status = "Проверяем изменения…"
            Task {
                let result = await Task.detached { () -> Result<(SyncSession.ResultState, Data, PlanConflict?), Error> in
                    Result {
                        let allowed = url.startAccessingSecurityScopedResource()
                        defer { if allowed { url.stopAccessingSecurityScopedResource() } }
                        let engine = try FinanceEngine(resources: resources)
                        let session = SyncSession(records: records)
                        if stale {
                            // Refresh only previously granted access (or an app-owned test file).
                            // Keep the old base and local plan so divergence remains detectable.
                            let path = url.standardizedFileURL.resolvingSymlinksInPath().path
                            guard allowed || path.hasPrefix(ownFolder + "/") else { throw PlanAccessError.stale }
                            let observed = try SharedDocument.read(url)
                            let renewed = try url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
                            try session.reconnect(url, validated: observed, bookmark: renewed)
                        }
                        let action = try session.sync(url) { try engine.validate($0).0 }
                        guard let updated = try records.load() else { throw SyncRecordError.unavailable }
                        var detail: PlanConflict?
                        if action == .conflict {
                            let remote = try SharedDocument.read(url)
                            let local = try SharedDocument.canonical(updated.state)
                            let (_, localPlan) = try engine.validate(local)
                            let (_, remotePlan) = try engine.validate(remote)
                            detail = PlanConflict(localHash: SharedDocument.hash(local), remoteHash: SharedDocument.hash(remote), localBalance: localPlan.balance, remoteBalance: remotePlan.balance, localPlan: localPlan, remotePlan: remotePlan)
                        }
                        return (action, updated.state, detail)
                    }
                }.value
                syncing = false
                switch result {
                case .success(let (action, bytes, detail)):
                    do { try accept(bytes) } catch { self.error = error.localizedDescription; return }
                    switch action {
                    case .current: status = "Файл и iPhone совпадают · загрузка зависит от iCloud"
                    case .sent: status = "Записано в файл · загрузка зависит от iCloud"
                    case .received: status = "Получены изменения из файла"
                    case .conflict: conflict = detail; status = "Конфликт: обе версии сохранены; обмен остановлен"
                    case .missing: status = "Файл не найден · локальные изменения сохранены"
                    }
                    if action != .conflict {
                        let changed = accountPastEvents()
                        if changed && action != .missing { refresh(automatic:true) }
                    }
                case .failure(let error):
                    if case SharedDocumentError.unresolved = error { status = "iCloud обнаружил конфликт версий"; loadCloudConflict(url: url, records: records, resources: resources) }
                    else { if !automatic { self.error = error.localizedDescription }; status = "Нет обмена: \(error.localizedDescription)"; _ = accountPastEvents() }
                }
            }
        } catch { if !automatic { self.error = error.localizedDescription }; status = "Нет доступа · показана локальная копия"; _ = accountPastEvents() }
    }
    private func localDate(_ date: Date) -> String {
        let formatter=DateFormatter();formatter.locale=Locale(identifier:"en_US_POSIX");formatter.calendar=Calendar(identifier:.gregorian);formatter.timeZone = .current;formatter.dateFormat="yyyy-MM-dd"
        return formatter.string(from:date)
    }
    @discardableResult private func accountPastEvents() -> Bool {
        guard !syncing, !isEditing, conflict == nil, cloudConflict == nil, let data, let engine else { return false }
        do {
            guard let record=try recordStore.load(), try SharedDocument.canonical(engine.validate(record.state).0) == SharedDocument.canonical(data) else { throw SharedDocumentError.changed }
            let result=try engine.closePastDays(data,now:localDate(Date()))
            accountingError=nil
            guard result.changed else { return false }
            try SyncSession(records:recordStore).saveLocal(validated:result.data)
            try accept(result.data)
            if result.count > 0 { status="Автоматически учтено: \(result.count) · ожидает обмена" }
            return true
        } catch { accountingError=error.localizedDescription; return false }
    }
    func toggleEvent(key: String, completed: Bool) {
        do {
            guard !syncing, conflict == nil, cloudConflict == nil, let data, let engine, try recordStore.load() != nil else { throw SyncRecordError.unavailable }
            let updated=try engine.toggleEvent(data,key:key,completed:completed,now:localDate(Date()),end:localDate(selectedDate))
            try SyncSession(records:recordStore).saveLocal(validated:updated)
            try accept(updated);accountingError=nil;status="Сохранено на iPhone · ожидает обмена"
        } catch { self.error=error.localizedDescription }
        isEditing=false
        refresh(automatic:true)
    }
    private func loadCloudConflict(url: URL, records: SyncRecordStore, resources: URL) {
        syncing = true
        Task {
            let result = await Task.detached { () -> Result<CloudConflictDisplay, Error> in Result {
                let allowed = url.startAccessingSecurityScopedResource(); defer { if allowed { url.stopAccessingSecurityScopedResource() } }
                let engine = try FinanceEngine(resources: resources)
                let snapshot = try CloudConflicts(records:records).snapshot(url)
                let choices = try snapshot.versions.map { version in
                    let (_, plan) = try engine.validate(version.data)
                    return CloudChoice(id:version.id,title:version.label,balance:plan.balance,count:plan.transactions.count + plan.debts.count + plan.incomeSources.count,plan:plan)
                }
                return CloudConflictDisplay(snapshot:snapshot,choices:choices)
            } }.value
            syncing = false
            switch result { case .success(let details): cloudConflict = details; status = "Нужно выбрать версию плана"; case .failure(let error): status = "Конфликт iCloud: \(error.localizedDescription)" }
        }
    }
    func resolveCloud(choice: String) {
        guard !syncing, !isEditing, let details = cloudConflict, let record = try? recordStore.load(), let bookmark = record.bookmark else { return }
        do {
            var stale = false
            let url = try URL(resolvingBookmarkData: bookmark, options: [], relativeTo:nil, bookmarkDataIsStale:&stale)
            guard !stale, let resources = Bundle.main.url(forResource:"Finance",withExtension:nil) else { throw SyncRecordError.unavailable }
            let records = recordStore; syncing = true; status = "Сохраняем все версии…"
            Task {
                let result = await Task.detached { () -> Result<Data,Error> in Result {
                    let allowed=url.startAccessingSecurityScopedResource(); defer { if allowed { url.stopAccessingSecurityScopedResource() } }
                    let engine=try FinanceEngine(resources:resources)
                    try CloudConflicts(records:records).resolve(url,choice:choice,expected:details.snapshot.fingerprint,validate:{try engine.validate($0).0})
                    guard let record=try records.load() else {throw SyncRecordError.unavailable};return record.state
                } }.value
                syncing = false
                switch result { case .success(let state): do { try accept(state); cloudConflict=nil; reloadBackupFiles(); status="Версия выбрана · проверь загрузку iCloud" } catch { self.error=error.localizedDescription }; case .failure(let error): self.error=error.localizedDescription;status="Не удалось завершить выбор · проверь версии и сохранённые копии" }
            }
        } catch { self.error=error.localizedDescription }
    }
    func resolveSnapshot(useLocal: Bool) {
        guard !syncing, !isEditing, let detail = conflict, let record = try? recordStore.load(), let bookmark = record.bookmark else { return }
        do {
            var stale = false
            let url = try URL(resolvingBookmarkData: bookmark, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
            guard !stale, let resources = Bundle.main.url(forResource: "Finance", withExtension: nil) else { throw SyncRecordError.unavailable }
            let records = recordStore
            syncing = true; status = "Сохраняем копии и применяем выбор…"
            Task {
                let result = await Task.detached { () -> Result<Data, Error> in Result {
                    let allowed = url.startAccessingSecurityScopedResource(); defer { if allowed { url.stopAccessingSecurityScopedResource() } }
                    let engine = try FinanceEngine(resources: resources)
                    try SyncSession(records: records).resolveSnapshot(url, choosing: useLocal ? .local : .shared, expectedLocal: detail.localHash, expectedRemote: detail.remoteHash, validate: { try engine.validate($0).0 })
                    guard let updated = try records.load() else { throw SyncRecordError.unavailable }; return updated.state
                } }.value
                syncing = false
                switch result {
                case .success(let state): do { try accept(state); conflict = nil; reloadBackupFiles(); status = "Выбор сохранён · проверь загрузку iCloud" } catch { self.error = error.localizedDescription }
                case .failure(let error): conflict = nil; self.error = error.localizedDescription; status = "Не удалось завершить выбор · проверь версии и сохранённые копии"; refresh(automatic: true)
                }
            }
        } catch { self.error = error.localizedDescription }
    }
    func editBalance(_ expression: String) {
        do {
            guard conflict == nil, cloudConflict == nil else { throw SyncRecordError.conflict }
            guard !syncing, let data, let engine, try recordStore.load() != nil else { throw SyncRecordError.unavailable }
            let today=localDate(Date()), settled=try engine.closePastDays(data,now:today).data
            let updated = try engine.updateBalance(settled, amount: expression, date: today)
            try SyncSession(records: recordStore).saveLocal(validated: updated)
            try accept(updated); status = "Сохранено на iPhone · ожидает обмена"; refresh(automatic: true)
        } catch { self.error = error.localizedDescription }
    }
    func reloadBackupFiles() {
        let folder = cache.deletingLastPathComponent().appendingPathComponent("ConflictBackups",isDirectory:true)
        let directories = (try? FileManager.default.contentsOfDirectory(at:folder,includingPropertiesForKeys:nil)) ?? []
        backupFiles = directories.sorted { $0.lastPathComponent > $1.lastPathComponent }.flatMap { (try? FileManager.default.contentsOfDirectory(at:$0,includingPropertiesForKeys:nil)) ?? [] }.filter { $0.pathExtension == "json" }
    }
    func editEntry(section: String, id: String, name: String, amount: String, details: [String: String] = [:]) throws {
        guard conflict == nil, cloudConflict == nil else { throw SyncRecordError.conflict }
        guard !syncing, let data, let engine, try recordStore.load() != nil else { throw SyncRecordError.unavailable }
        let settled=try engine.closePastDays(data,now:localDate(Date())).data
        let updated = try engine.updateEntry(settled, section: section, id: id, name: name, amount: amount, details: details)
        try SyncSession(records: recordStore).saveLocal(validated: updated)
        try accept(updated); status = "Сохранено на iPhone · ожидает обмена"
    }
    func createEntry(input: [String: Any]) throws {
        guard conflict == nil, cloudConflict == nil else { throw SyncRecordError.conflict }
        guard !syncing, let data, let engine, try recordStore.load() != nil else { throw SyncRecordError.unavailable }
        let settled=try engine.closePastDays(data,now:localDate(Date())).data
        let updated = try engine.createEntry(settled, input: input)
        try SyncSession(records: recordStore).saveLocal(validated: updated)
        try accept(updated); status = "Сохранено на iPhone · ожидает обмена"
    }
    func exportData() throws -> Data {
        guard let data else { throw SyncRecordError.unavailable }
        return data
    }
    func readImport(_ url: URL) throws -> Data {
        let allowed = url.startAccessingSecurityScopedResource()
        defer { if allowed { url.stopAccessingSecurityScopedResource() } }
        return try validatedPlan(coordinatedRead(url)).0
    }
    func importData(_ imported: Data) throws {
        guard !syncing, conflict == nil, cloudConflict == nil else { throw SyncRecordError.conflict }
        let checked = try validatedPlan(imported).0
        try SyncSession(records: recordStore).importSnapshot(validated:checked, fallback:data)
        try accept(checked); reloadBackupFiles(); status = "Импортировано на iPhone · ожидает обмена"
    }
    func editorClosed() { isEditing = false; refresh(automatic: true) }
    #if DEBUG
    /// Explicitly invoked only for the fictional end-to-end test document.
    func runFictionalSyncTestIfRequested() async {
        guard let mode = ProcessInfo.processInfo.environment["FINROAD_AUTOTEST"], ["1", "edits", "parameters", "mobile-edit-check", "conflict-seed", "inspect", "resolve-cloud", "sim-auto", "sim-reconnect", "sim-switch"].contains(mode) else { return }
        var report = ""
        do {
            guard let record = try recordStore.load(), let bookmark = record.bookmark else { throw SyncRecordError.unavailable }
            let object = try JSONSerialization.jsonObject(with: record.state) as? [String: Any]
            let sources = object?["incomeSources"] as? [[String: Any]] ?? []
            guard sources.contains(where: { $0["id"] as? String == "fiction-salary" }) else { throw FinanceError.invalid("Не тестовые данные") }
            #if targetEnvironment(simulator)
            if mode == "sim-switch" {
                guard var fixture = object else { throw FinanceError.invalid("Не тестовые данные") }
                fixture["balance"] = 33300000
                let target = cache.deletingLastPathComponent().appendingPathComponent("fictional-switch-target.json")
                try JSONSerialization.data(withJSONObject:fixture).write(to:target,options:.atomic)
                connect(target)
                return
            }
            if mode == "sim-reconnect" {
                let target = cache.deletingLastPathComponent().appendingPathComponent("fictional-auto-sync.json")
                connect(target)
                return
            }
            if mode == "sim-auto" {
                let target = cache.deletingLastPathComponent().appendingPathComponent("fictional-auto-sync.json")
                try record.state.write(to: target, options:.atomic)
                let localBookmark = try target.bookmarkData(options: [], includingResourceValuesForKeys:nil, relativeTo:nil)
                try SyncSession(records:recordStore).link(target,validated:record.state,bookmark:localBookmark)
                status = "Тест автоматического обмена подготовлен"
                return
            }
            #endif
            var stale = false
            let url = try URL(resolvingBookmarkData: bookmark, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
            guard !stale, url.lastPathComponent == "FinRoad-sync.json", url.path.contains("FinRoad-тест-2026-11-14") else { throw FinanceError.invalid("Выбран не тестовый документ") }
            for _ in 0..<120 { if !syncing { break }; try await Task.sleep(nanoseconds: 500_000_000) }
            guard !syncing else { throw FinanceError.invalid("Начальная синхронизация не завершилась") }
            if mode == "resolve-cloud" {
                refresh()
                for _ in 0..<120 { if !syncing && cloudConflict != nil { break }; try await Task.sleep(nanoseconds: 500_000_000) }
                guard let details = cloudConflict, let current = details.choices.first(where: { $0.id.hasPrefix("current:") }) else { throw FinanceError.invalid("Тестовый конфликт не обнаружен") }
                resolveCloud(choice: current.id)
                for _ in 0..<120 { if !syncing { break }; try await Task.sleep(nanoseconds: 500_000_000) }
                guard cloudConflict == nil, error == nil else { throw FinanceError.invalid(error ?? "Конфликт не разрешён") }
                report = "Тестовый конфликт разрешён с архивированием всех версий"
                let target = cache.deletingLastPathComponent().appendingPathComponent("fictional-test-result.txt")
                try report.write(to:target,atomically:true,encoding:.utf8)
                return
            }
            if mode == "mobile-edit-check" {
                guard let plan, let salary=plan.incomeSources.first(where: { $0.id == "fiction-salary" }),
                    let debt=plan.debts.first(where: { $0.name == "Карта (пример)" && $0.kind == "personal" }),
                    let expense=plan.transactions.first(where: { $0.name == "Покупка (тест обмена)" }) else { throw FinanceError.invalid("Нет ожидаемых тестовых записей") }
                isEditing = true
                defer { isEditing = false }
                try editEntry(section:"incomeSources",id:salary.id,name:salary.name,amount:"160000",details:["incomeType":"side","repeat":"monthly","day":"31"])
                try editEntry(section:"transactions",id:expense.id,name:expense.name,amount:"5100",details:["repeat":"once","date":expense.date ?? ""])
                try editEntry(section:"debts",id:debt.id,name:debt.name,amount:"30000",details:["debtType":"card","creditLimit":"60000","cardBalance":"30000"])
                editorClosed()
            } else if mode == "parameters" {
                guard let plan, let salary=plan.incomeSources.first(where: { $0.id == "fiction-salary" }), let card=plan.debts.first(where: { $0.kind == "card" }), let expense=plan.transactions.first(where: { $0.repeatRule == "monthly" && $0.loanDebtId == nil && $0.debtId == nil }) else { throw FinanceError.invalid("Нет тестовых записей") }
                try editEntry(section:"incomeSources",id:salary.id,name:salary.name,amount:"160000",details:["taxRate":"15","salaryShare":"70","day":"31","advanceDay":"16"])
                try editEntry(section:"debts",id:card.id,name:card.name,amount:"",details:["creditLimit":"60000","cardBalance":"30000"])
                try editEntry(section:"transactions",id:expense.id,name:expense.name,amount:"1600",details:["day":"19"])
                editorClosed()
            } else if mode == "edits" {
                guard let plan else { throw SyncRecordError.unavailable }
                guard let expense = plan.transactions.first(where: { $0.name == "Покупка (пример)" }), let loan = plan.debts.first(where: { $0.kind == "loan" }) else { throw FinanceError.invalid("В тестовом плане нет ожидаемых записей") }
                try editEntry(section: "incomeSources", id: "fiction-salary", name: "Зарплата (тест обмена)", amount: "160000")
                try editEntry(section: "transactions", id: expense.id, name: "Покупка (тест обмена)", amount: "5000")
                try editEntry(section: "debts", id: loan.id, name: "Кредит (тест обмена)", amount: "75000")
                editorClosed()
            } else if mode == "conflict-seed" { editBalance("188000") }
            else if mode == "1" { editBalance("186000") }
            guard error == nil else { throw FinanceError.invalid(error!) }
            refresh()
            for _ in 0..<120 { if !syncing { break }; try await Task.sleep(nanoseconds: 500_000_000) }
            guard !syncing else { throw FinanceError.invalid("Тайм-аут обмена") }
            let info = try? url.resourceValues(forKeys: [.isUbiquitousItemKey, .ubiquitousItemIsUploadedKey, .ubiquitousItemIsUploadingKey, .ubiquitousItemUploadingErrorKey])
            let observed = try SharedDocument.read(url)
            let observedObject = try JSONSerialization.jsonObject(with: observed) as? [String: Any]
            if mode == "inspect" { try await Task.sleep(nanoseconds: 2_000_000_000) }
            report = "Test balance: " + String(describing: observedObject?["balance"]) + "\nhash: " + SharedDocument.hash(observed) + "\n" + status + "\nURL: " + url.path + "\niCloud: " + String(describing: info?.isUbiquitousItem) + " uploaded: " + String(describing: info?.ubiquitousItemIsUploaded) + " uploading: " + String(describing: info?.ubiquitousItemIsUploading) + " error: " + (info?.ubiquitousItemUploadingError?.localizedDescription ?? "none") + "\nIdle timer disabled: " + String(UIApplication.shared.isIdleTimerDisabled) + "; battery state: " + String(UIDevice.current.batteryState.rawValue) + "; app state: " + String(UIApplication.shared.applicationState.rawValue)
        } catch { report = "Ошибка: " + error.localizedDescription }
        let target = cache.deletingLastPathComponent().appendingPathComponent("fictional-test-result.txt")
        try? report.write(to: target, atomically: true, encoding: .utf8)
    }
    #endif
    private func coordinatedRead(_ url: URL) throws -> Data {
        if !(NSFileVersion.unresolvedConflictVersionsOfItem(at: url) ?? []).isEmpty { throw FinanceError.invalid("У файла есть конфликтующие версии iCloud. Сначала разреши конфликт и сохрани копии.") }
        var coordinationError: NSError?
        var result: Result<Data, Error>?
        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinationError) { coordinatedURL in result = Result { try Data(contentsOf: coordinatedURL) } }
        if let coordinationError { throw coordinationError }
        guard let result else { throw FinanceError.invalid("Не удалось открыть файл.") }
        return try result.get()
    }
    private func validatedPlan(_ raw: Data) throws -> (Data, Plan) {
        guard let engine else { throw FinanceError.missingResource }
        return try engine.validate(raw)
    }
    private func persist(_ bytes: Data) throws {
        try FileManager.default.createDirectory(at: cache.deletingLastPathComponent(), withIntermediateDirectories: true)
        try bytes.write(to: cache, options: .atomic)
    }
    private func accept(_ bytes: Data) throws {
        let (validated, candidate) = try validatedPlan(bytes)
        data = validated; plan = candidate; calculate()
    }
    private func calculate() {
        guard let data, let engine else { forecast = nil; return }
        let formatter = DateFormatter(); formatter.calendar = Calendar(identifier: .gregorian); formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = .current; formatter.dateFormat = "yyyy-MM-dd"
        do { forecast = try engine.forecast(data, start: formatter.string(from: Date()), end: formatter.string(from: selectedDate)) }
        catch { self.error = error.localizedDescription; forecast = nil }
    }
}
