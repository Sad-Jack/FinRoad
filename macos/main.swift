import Cocoa
import WebKit

final class App: NSObject, NSApplicationDelegate, WKUIDelegate, WKNavigationDelegate {
    lazy var sync = SyncManager(directory: dir)
    var syncTimer: Timer?
    var syncStatus = "Синхронизация не настроена"
    var window: NSWindow!
    var web: WKWebView!
    let fm = FileManager.default
    let dir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/FinRoad", isDirectory: true)
    var file: URL { dir.appendingPathComponent("data.json") }
    var cloud: URL? { UserDefaults.standard.string(forKey: "backupFolder").map { URL(fileURLWithPath: $0, isDirectory: true) } }
    func applicationDidFinishLaunching(_ notification: Notification) {
        if let iconURL = Bundle.main.url(forResource: "FinRoad", withExtension: "icns"), let icon = NSImage(contentsOf: iconURL) { NSApp.applicationIconImage = icon }
        let config = WKWebViewConfiguration()
        let source = """
        window.finroadNativeStorage = {
          getItem(key) { const r = JSON.parse(prompt('finroad-storage', JSON.stringify({op:'get',key})) || '{}'); if(r.error) throw Error(r.error); return r.value ?? null; },
          setItem(key,value) { const r = JSON.parse(prompt('finroad-storage', JSON.stringify({op:'set',key,value})) || '{}'); if(r.error) throw Error(r.error); }
        };
        """
        config.userContentController.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        web = WKWebView(frame: .zero, configuration: config); web.uiDelegate = self; web.navigationDelegate = self
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1200, height: 800), styleMask: [.titled,.closable,.miniaturizable,.resizable], backing: .buffered, defer: false)
        window.title = "FinRoad"; window.minSize = NSSize(width: 760, height: 550); window.contentView = web; window.center(); window.makeKeyAndOrderFront(nil)
        setupMenu()
        sync.onStatus = { [weak self] message in self?.syncStatus = message; self?.window.title = message.hasPrefix("Синхронизация остановлена") ? "FinRoad — требуется внимание" : "FinRoad" }
        sync.onRemote = { [weak self] remote, local, completion in
            guard let self else { completion("deferred"); return }
            let payload = [String(decoding: remote, as: UTF8.self), String(decoding: local, as: UTF8.self)]
            guard let data = try? JSONSerialization.data(withJSONObject: payload), let args = String(data: data, encoding: .utf8) else { completion("deferred"); return }
            self.web.evaluateJavaScript("window.finroadAcceptRemote && window.finroadAcceptRemote(...\(args))") { value, _ in completion((value as? String) ?? "deferred") }
        }
        syncTimer = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in self?.sync.run() }
        sync.run()
        guard let url = Bundle.main.url(forResource: "index", withExtension: "html") else { fatalError("Missing FinRoad.html") }
        web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        NSApp.activate(ignoringOtherApps: true)
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func setupMenu() {
        let bar = NSMenu(); let appItem = NSMenuItem(); bar.addItem(appItem); let appMenu = NSMenu(); appItem.submenu = appMenu
        appMenu.addItem(withTitle: "Завершить FinRoad", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let fileItem = NSMenuItem(); bar.addItem(fileItem); let menu = NSMenu(title: "Файл"); fileItem.submenu = menu
        menu.addItem(withTitle: "Настроить синхронизацию iCloud Drive…", action: #selector(chooseSync), keyEquivalent: "")
        menu.addItem(withTitle: "Состояние синхронизации", action: #selector(showSyncStatus), keyEquivalent: "")
        menu.addItem(withTitle: "Отключить синхронизацию", action: #selector(disconnectSync), keyEquivalent: "")
        menu.addItem(.separator())
        menu.addItem(withTitle: "Настроить копию в iCloud Drive…", action: #selector(chooseBackup), keyEquivalent: "")
        menu.addItem(withTitle: "Открыть папку данных", action: #selector(openData), keyEquivalent: "")
        menu.addItem(withTitle: "Отключить копию в iCloud Drive", action: #selector(disableBackup), keyEquivalent: "")
        let editItem = NSMenuItem(); bar.addItem(editItem); let edit = NSMenu(title: "Правка"); editItem.submenu = edit
        for (title, action, key) in [("Отменить", Selector(("undo:")), "z"), ("Вырезать", #selector(NSText.cut(_:)), "x"), ("Копировать", #selector(NSText.copy(_:)), "c"), ("Вставить", #selector(NSText.paste(_:)), "v"), ("Выделить всё", #selector(NSText.selectAll(_:)), "a")] { edit.addItem(withTitle: title, action: action, keyEquivalent: key) }
        NSApp.mainMenu = bar
    }
    func alert(_ message: String) { let a = NSAlert(); a.messageText = "FinRoad"; a.informativeText = message; a.runModal() }
    @objc func showSyncStatus() { alert(syncStatus) }
    @objc func disconnectSync() {
        do { try sync.disconnect(); syncStatus = "Синхронизация не настроена"; window.title = "FinRoad"; alert("Синхронизация отключена. Файл на Mac и документ в iCloud Drive сохранены.") }
        catch { alert("Не удалось отключить синхронизацию: \(error.localizedDescription)") }
    }
    @objc func chooseSync() {
        let root = fm.homeDirectoryForCurrentUser.appendingPathComponent("Library/Mobile Documents/com~apple~CloudDocs", isDirectory: true)
        let panel = NSOpenPanel(); panel.canChooseFiles = false; panel.canChooseDirectories = true; panel.canCreateDirectories = true; panel.directoryURL = root
        panel.message = "Выбери папку в iCloud Drive для общего плана FinRoad. Существующий файл не будет заменён при подключении."
        guard panel.runModal() == .OK, let folder = panel.url else { return }
        let resolved = folder.resolvingSymlinksInPath().standardizedFileURL.path
        let cloudRoot = root.resolvingSymlinksInPath().standardizedFileURL.path
        guard resolved == cloudRoot || resolved.hasPrefix(cloudRoot + "/") else { alert("Выбери папку внутри iCloud Drive."); return }
        let target = folder.appendingPathComponent("FinRoad-sync.json")
        do { try sync.configure(target); syncStatus = "Синхронизация: проверка документа"; sync.run(); alert("Папка подключена. Если общий файл уже содержит другой план, FinRoad остановит синхронизацию и сохранит обе версии. Состояние доступно в меню «Файл».") }
        catch { alert("Не удалось подключить папку: \(error.localizedDescription)") }
    }
    @objc func openData() { try? fm.createDirectory(at: dir, withIntermediateDirectories: true); NSWorkspace.shared.open(dir) }
    @objc func disableBackup() { UserDefaults.standard.removeObject(forKey: "backupFolder"); alert("Автоматическая копия отключена. Локальные данные сохранены.") }
    @objc func chooseBackup() {
        let panel = NSOpenPanel(); panel.canChooseFiles = false; panel.canChooseDirectories = true; panel.canCreateDirectories = true
        panel.message = "Выбери папку в iCloud Drive для резервной копии FinRoad. Существующий файл не будет заменён при настройке."
        if panel.runModal() != .OK { return }; guard let folder = panel.url else { return }
        let target = folder.appendingPathComponent("FinRoad-backup.json")
        if fm.fileExists(atPath: target.path) { alert("В этой папке уже есть FinRoad-backup.json. Выбери другую папку. Для восстановления используй импорт в приложении."); return }
        do {
            if fm.fileExists(atPath: file.path) { try writeCloud(folder: folder) }
            UserDefaults.standard.set(folder.path, forKey: "backupFolder")
            alert("Копия будет сохраняться в выбранную папку. Синхронизацией управляет macOS; проверь статус iCloud Drive в Finder.")
        } catch { alert("Не удалось настроить копию: \(error.localizedDescription)") }
    }
    func writeCloud(folder: URL) throws {
        let data = try Data(contentsOf: file)
        guard let record = try JSONSerialization.jsonObject(with: data) as? [String: Any], let state = record["state"] else { throw NSError(domain: "FinRoad", code: 1, userInfo: [NSLocalizedDescriptionKey: "Некорректные локальные данные"]) }
        let json = try JSONSerialization.data(withJSONObject: state, options: [.prettyPrinted, .sortedKeys])
        try json.write(to: folder.appendingPathComponent("FinRoad-backup.json"), options: .atomic)
    }
    func handle(_ input: String?) -> String {
        do {
            guard let input, let data = input.data(using: .utf8), let request = try JSONSerialization.jsonObject(with: data) as? [String: String], request["key"] == "finroad-state-v1", let op = request["op"] else { throw NSError(domain: "FinRoad", code: 2, userInfo: [NSLocalizedDescriptionKey: "Неизвестный запрос хранилища"]) }
            if op == "get" { if !fm.fileExists(atPath: file.path) { return "{}" }; let value = try String(contentsOf: file, encoding: .utf8); return encode(["value":value]) }
            if op == "export" {
                guard let value = request["value"], let bytes = value.data(using: .utf8) else { throw NSError(domain: "FinRoad", code: 4) }
                let panel = NSSavePanel(); panel.nameFieldStringValue = "finroad-backup.json"; panel.allowedContentTypes = [.json]
                if panel.runModal() == .OK, let url = panel.url { try bytes.write(to: url, options: .atomic); return encode(["value":"saved"]) }
                return encode(["value":"cancelled"])
            }
            guard op == "set", let value = request["value"], let bytes = value.data(using: .utf8) else { throw NSError(domain:"FinRoad",code:3) }
            _ = try JSONSerialization.jsonObject(with: bytes)
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
            if fm.fileExists(atPath: file.path) {
                let backups = dir.appendingPathComponent("Backups", isDirectory: true); try fm.createDirectory(at: backups, withIntermediateDirectories: true)
                let stamp = String(format: "%.0f", Date().timeIntervalSince1970 * 1000000)
                try fm.copyItem(at: file, to: backups.appendingPathComponent("\(stamp).json"))
                let files = try fm.contentsOfDirectory(at: backups, includingPropertiesForKeys: nil).filter { $0.pathExtension == "json" }.sorted { $0.lastPathComponent > $1.lastPathComponent }
                for old in files.dropFirst(20) { try? fm.removeItem(at: old) }
            }
            try bytes.write(to: file, options: .atomic)
            sync.run()
            if let folder = cloud { do { try writeCloud(folder: folder) } catch { DispatchQueue.main.async { self.alert("Данные сохранены на Mac, но копию в выбранную папку записать не удалось: \(error.localizedDescription). Проверь доступ и выбери папку заново.") } } }
            return "{}"
        } catch { return encode(["error":error.localizedDescription]) }
    }
    func encode(_ dict: [String:String]) -> String { String(data: try! JSONSerialization.data(withJSONObject: dict), encoding: .utf8)! }
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        guard prompt == "finroad-storage", frame.isMainFrame else { completionHandler(nil); return }; completionHandler(handle(defaultText))
    }
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel(); panel.allowedContentTypes = [.json]; panel.allowsMultipleSelection = false; completionHandler(panel.runModal() == .OK ? panel.urls : nil)
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.request.url?.isFileURL == true { decisionHandler(.allow) } else { decisionHandler(.cancel) }
    }
}
let app = NSApplication.shared
let delegate = App(); app.delegate = delegate; app.setActivationPolicy(.regular); app.run()
