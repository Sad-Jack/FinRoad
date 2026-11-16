import SwiftUI
import UniformTypeIdentifiers
import UIKit

@main struct FinRoadApp: App {
    @StateObject private var store = PlanStore()
    var body: some Scene { WindowGroup { RootView().environmentObject(store).preferredColorScheme(.dark) } }
}

private let ink = Color(red: 0.05, green: 0.08, blue: 0.15)
private let panel = Color(red: 0.09, green: 0.14, blue: 0.23)
private let accent = Color(red: 0.79, green: 0.74, blue: 0.97)
private let mint = Color(red: 0.62, green: 0.87, blue: 0.77)
private func rubles(_ value: Int64?) -> String {
    guard let value else { return "—" }
    let formatter = NumberFormatter(); formatter.locale = Locale(identifier: "ru_RU"); formatter.numberStyle = .decimal; formatter.maximumFractionDigits = 2
    return "\(formatter.string(from: NSNumber(value: Double(value) / 100)) ?? "—") ₽"
}
struct BackupDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }
    var data: Data
    init(data: Data) { self.data = data }
    init(configuration: ReadConfiguration) throws { guard let data=configuration.file.regularFileContents else { throw CocoaError(.fileReadCorruptFile) }; self.data=data }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents:data) }
}

struct RootView: View {
    @EnvironmentObject private var store: PlanStore
    @State private var importing = false
    @State private var confirmingSwitch = false
    @Environment(\.scenePhase) private var scenePhase
    private let syncTimer = Timer.publish(every: 30, on: .main, in: .common).autoconnect()
    var body: some View {
        TabView {
            NavigationStack { PlanView() }.tabItem { Label("План", systemImage: "calendar") }
            NavigationStack { EntriesView(title: "Расход", collection: .expense) }.tabItem { Label("Расход", systemImage: "arrow.down.right") }
            NavigationStack { EntriesView(title: "Приход", collection: .income) }.tabItem { Label("Приход", systemImage: "arrow.up.right") }
            NavigationStack { MoreView(importing: $importing) }.tabItem { Label("Ещё", systemImage: "ellipsis.circle") }
        }
        #if DEBUG
        .task { await store.runFictionalSyncTestIfRequested() }
        .onAppear { UIDevice.current.isBatteryMonitoringEnabled = true; updateTestIdleTimer() }
        .onChange(of: scenePhase) { _ in updateTestIdleTimer() }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in updateTestIdleTimer() }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.willResignActiveNotification)) { _ in UIApplication.shared.isIdleTimerDisabled = false }
        .onReceive(NotificationCenter.default.publisher(for: UIDevice.batteryStateDidChangeNotification)) { _ in updateTestIdleTimer() }
        .onDisappear { UIApplication.shared.isIdleTimerDisabled = false; UIDevice.current.isBatteryMonitoringEnabled = false }
        #endif
        .onChange(of: scenePhase) { phase in if phase == .active { store.refresh(automatic: true) } }
        .onAppear { store.refresh(automatic: true) }
        .onReceive(syncTimer) { _ in if scenePhase == .active { store.refresh(automatic: true) } }
        .tint(accent)
        .sheet(isPresented: $importing, onDismiss: {
            if store.pendingSwitch != nil { confirmingSwitch = true }
            else { store.isEditing = false; store.refresh(automatic:true) }
        }) {
            DocumentPicker(onPick: { url in store.connect(url); importing = false }, onCancel: { importing = false })
        }
        .onChange(of: store.pendingSwitch != nil) { pending in if pending && !importing { confirmingSwitch = true } }
        .alert("Открыть другой план?", isPresented: $confirmingSwitch) {
            Button("Открыть выбранный файл") { store.confirmSwitch() }
            Button("Отмена", role: .cancel) { store.cancelSwitch() }
        } message: {
            if let pending = store.pendingSwitch {
                Text("Файл: \(pending.folderName)/\(pending.fileName). Текущий план iPhone сохранится в копиях. Выбранный файл не изменится.")
            }
        }
        .alert("Не удалось выполнить действие", isPresented: Binding(get: { store.error != nil }, set: { if !$0 { store.error = nil } })) { Button("Понятно", role: .cancel) { store.error = nil } } message: { Text(store.error ?? "") }
    }
    #if DEBUG
    private func updateTestIdleTimer() {
        let battery = UIDevice.current.batteryState
        UIApplication.shared.isIdleTimerDisabled = UIApplication.shared.applicationState == .active && (battery == .charging || battery == .full)
    }
    #endif
}

private func planDate(_ value: String) -> String {
    let parser = DateFormatter(); parser.locale = Locale(identifier: "en_US_POSIX"); parser.calendar = Calendar(identifier: .gregorian); parser.dateFormat = "yyyy-MM-dd"
    guard let date = parser.date(from: value) else { return value }
    let formatter = DateFormatter(); formatter.locale = Locale(identifier: "ru_RU"); formatter.dateFormat = Calendar.current.isDate(date, equalTo: Date(), toGranularity: .year) ? "d MMMM" : "d MMMM yyyy"
    return formatter.string(from: date)
}

struct PlanView: View {
    @EnvironmentObject private var store: PlanStore
    @State private var editingBalance = false
    @State private var balanceText = ""
    @State private var selectedEvent: EventAction?
    private let summaryColumnSpacing: CGFloat = 20
    private var rows: [PlanRow] { store.forecast?.rows ?? [] }
    private var days: [String] { var seen = Set<String>(); return rows.map(\.date).filter { seen.insert($0).inserted } }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if let plan = store.plan {
                    VStack(spacing: 10) {
                        HStack(spacing: 10) {
                            Text("Сейчас в наличии")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .multilineTextAlignment(.center)
                            Button {
                                balanceText = plan.balance.map { String(Double($0) / 100) } ?? ""
                                store.isEditing = true
                                editingBalance = true
                            } label: {
                                HStack(spacing: 6) {
                                    Text(rubles(plan.balance))
                                        .font(.title2.weight(.semibold))
                                        .lineLimit(1)
                                        .minimumScaleFactor(0.7)
                                    Image(systemName: "pencil").font(.caption)
                                }
                                .frame(minHeight: 34)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .disabled(store.syncing)
                            .accessibilityLabel("Изменить текущий остаток: \(rubles(plan.balance))")
                        }
                        Divider()
                        HStack(spacing: summaryColumnSpacing) {
                            VStack(spacing: 3) {
                                Text("Дата расчёта").font(.caption).foregroundStyle(.secondary)
                                DatePicker("Дата расчёта", selection: $store.selectedDate, in: Date.now..., displayedComponents: .date)
                                    .datePickerStyle(.compact)
                                    .labelsHidden()
                                    .environment(\.locale, Locale(identifier: "ru_RU"))
                            }.frame(maxWidth: .infinity)
                            VStack(spacing: 3) {
                                Text("Свободно на дату").font(.caption).foregroundStyle(.secondary)
                                Text(plan.balance == nil ? "—" : rubles(store.forecast?.balance))
                                    .font(.title2.weight(.semibold))
                                    .foregroundStyle(accent)
                                    .lineLimit(1)
                                    .minimumScaleFactor(0.7)
                                    .frame(minHeight: 34)
                            }.frame(maxWidth: .infinity)
                        }
                        .multilineTextAlignment(.center)
                        .overlay {
                            Rectangle()
                                .fill(.white.opacity(0.1))
                                .frame(width: 1)
                                .allowsHitTesting(false)
                                .accessibilityHidden(true)
                        }
                        if let shortfall = store.forecast?.firstShortfall, plan.balance != nil {
                            HStack(spacing: 4) { Image(systemName:"exclamationmark.triangle.fill"); Text("Нехватка \(planDate(shortfall.date)) · \(rubles(shortfall.balance))") }
                                .font(.caption.bold()).foregroundStyle(.pink).multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                        }
                    }.padding(12).frame(maxWidth: .infinity).background(panel, in: RoundedRectangle(cornerRadius: 14))
                    if let error=store.accountingError { Label("Не удалось автоматически учесть события: \(error)", systemImage:"exclamationmark.triangle").font(.footnote).foregroundStyle(.pink) }
                    HStack(alignment: .firstTextBaseline) {
                        Text("План").font(.headline)
                        Spacer()
                        if let forecast = store.forecast {
                            HStack(spacing: 14) {
                                Text("+\(rubles(forecast.income))").foregroundStyle(mint)
                                Text("−\(rubles(forecast.expense))").foregroundStyle(.pink)
                            }.font(.caption2)
                        }
                    }
                    if !rows.isEmpty {
                        VStack(spacing: 0) {
                            ForEach(days, id: \.self) { day in
                                VStack(alignment: .leading, spacing: 0) {
                                    Text(planDate(day)).font(.caption.bold()).foregroundStyle(.secondary).padding(.horizontal, 12).padding(.top, 10).padding(.bottom, 2)
                                    ForEach(rows.filter { $0.date == day }) { row in
                                        Button {
                                            store.isEditing=true
                                            selectedEvent=EventAction(key:row.id,name:row.event.name,amount:row.event.amount,kind:row.event.kind,completed:row.completed,automatic:false)
                                        } label: {
                                            HStack(alignment: .center, spacing: 8) {
                                                Image(systemName:row.completed ? "checkmark.circle.fill" : "circle").foregroundStyle(row.completed ? mint : .secondary)
                                                VStack(alignment: .leading, spacing: 2) {
                                                    Text(row.event.name).font(.subheadline.weight(.medium)).lineLimit(2)
                                                    Text("Остаток: \(plan.balance == nil ? "—" : rubles(row.balance))").font(.caption2).foregroundStyle(.secondary)
                                                }.frame(maxWidth: .infinity, alignment: .leading)
                                                Text("\(row.event.kind == "income" ? "+" : "−")\(rubles(row.event.amount))").font(.subheadline.weight(.semibold)).foregroundStyle(row.event.kind == "income" ? mint : .pink).fixedSize(horizontal: true, vertical: false)
                                            }.padding(.horizontal, 12).padding(.vertical, 7).frame(minHeight:44).contentShape(Rectangle())
                                        }.buttonStyle(.plain).disabled(store.syncing || store.conflict != nil || store.cloudConflict != nil)
                                            .accessibilityLabel("\(row.event.name), \(row.completed ? "выполнено" : "запланировано"), \(rubles(row.event.amount))")
                                        Divider().overlay(Color.white.opacity(0.05)).padding(.leading, 12)
                                    }
                                }
                            }
                        }.background(panel, in: RoundedRectangle(cornerRadius: 14))
                    } else { Text("На выбранный период событий нет.").font(.subheadline).foregroundStyle(.secondary).card() }
                } else { Text("Открой общий файл FinRoad в разделе «Ещё».").foregroundStyle(.secondary).card() }
            }.padding(.horizontal, 14).padding(.top, 8).padding(.bottom, 16)
        }.background(ink).toolbar(.hidden, for: .navigationBar)
        .alert("Изменить остаток", isPresented: $editingBalance) { TextField("Сумма в рублях", text: $balanceText).keyboardType(.numbersAndPunctuation); Button("Отмена", role: .cancel) { store.isEditing = false; store.refresh(automatic: true) }; Button("Сохранить") { store.isEditing = false; store.editBalance(balanceText) } }
        .alert(item:$selectedEvent) { item in
            Alert(title:Text(item.completed ? "Отменить учёт?" : "Отметить выполненным?"), message:Text("\(item.name) · \(item.kind == "income" ? "+" : "−")\(rubles(item.amount))\n\(item.completed ? "Остаток и связанный долг будут пересчитаны." : "Остаток и связанный долг изменятся.")\(item.automatic ? " Повторно автоматически это событие учтено не будет." : "")"), primaryButton:.default(Text(item.completed ? "Отменить учёт" : "Отметить")) { store.toggleEvent(key:item.key,completed:item.completed) }, secondaryButton:.cancel { store.editorClosed() })
        }
    }
}
private struct EventAction: Identifiable {
    let key: String; let name: String; let amount: Int64; let kind: String; let completed: Bool; let automatic: Bool
    var id: String { key }
}
struct Metric: View { let label: String; let value: String
    var body: some View { VStack(alignment: .leading, spacing: 6) { Text(label).font(.subheadline).foregroundStyle(.secondary); Text(value).font(.title.bold()) }.frame(maxWidth: .infinity, alignment: .leading).card() }
}
extension View { func card() -> some View { self.padding(16).frame(maxWidth: .infinity, alignment: .leading).background(panel, in: RoundedRectangle(cornerRadius: 16)) } }

struct EditableItem: Identifiable { let entry: Entry; let section: String; var id: String { section + ":" + entry.id } }
struct EntriesView: View {
    enum Collection { case expense, income }
    let title: String
    let collection: Collection
    @EnvironmentObject private var store: PlanStore
    @State private var selection: EditableItem?
    @State private var adding = false
    private var entries: [EditableItem] {
        guard let plan = store.plan else { return [] }
        let debts = plan.debts.map { EditableItem(entry: $0, section: "debts") }
        let sources = plan.incomeSources.map { EditableItem(entry: $0, section: "incomeSources") }
        let transactions = plan.transactions.filter { $0.kind == (collection == .income ? "income" : "expense") }.map { EditableItem(entry: $0, section: "transactions") }
        return (collection == .income ? sources : debts) + transactions
    }
    private func description(for item: EditableItem) -> String {
        let label: String
        if item.section == "debts" {
            label = ["loan":"Кредит", "mortgage":"Ипотека", "personal":"Частный долг", "card":"Кредитная карта"][item.entry.kind ?? ""] ?? "Долг"
        } else if item.section == "incomeSources" {
            label = ["salary":"Зарплата", "side":"Подработка", "support":"Выплаты и поступления", "other":"Другое"][item.entry.incomeType ?? "salary"] ?? "Доход"
        } else if item.entry.debtId != nil { label = "Погашение долга" }
        else if item.entry.loanDebtId != nil { label = "Платёж по кредиту" }
        else { label = item.entry.kind == "income" ? "Доход" : "Расход" }
        if item.section == "debts" { return label + " · остаток долга" }
        if item.entry.repeatRule == "monthly" {
            let day = item.entry.salaryDay ?? item.entry.day ?? item.entry.date.flatMap { Int($0.suffix(2)) }
            if let day { return label + " · каждый месяц, \(day) числа" }
        }
        if let date = item.entry.date { return label + " · " + date }
        return label + (item.entry.draft == true ? " · черновик" : "")
    }
    var body: some View {
        ScrollView { VStack(alignment: .leading, spacing: 10) {
            Text("Нажми на запись, чтобы изменить её параметры").font(.footnote).foregroundStyle(.secondary)
            if entries.isEmpty { Text("Записей пока нет").foregroundStyle(.secondary).card() }
            ForEach(entries) { item in Button { store.isEditing = true; selection = item } label: {
                HStack(alignment: .top) { VStack(alignment: .leading, spacing: 5) { Text(item.entry.name).font(.headline); Text(description(for:item)).font(.caption).foregroundStyle(.secondary) }; Spacer(); Text(rubles(item.entry.amount)).font(.subheadline.bold()); Image(systemName:"chevron.right").font(.caption).foregroundStyle(.secondary) }.card()
            }.buttonStyle(.plain).disabled(store.syncing) }
        }.padding() }.background(ink).navigationTitle(title)
        .toolbar { ToolbarItem(placement: .primaryAction) { Button { store.isEditing = true; adding = true } label: { Label(collection == .income ? "Добавить доход" : "Добавить расход", systemImage: "plus") }.disabled(store.syncing || store.plan == nil) } }
        .sheet(item: $selection, onDismiss: { store.editorClosed() }) { item in EntryEditor(item: item) }
        .sheet(isPresented: $adding, onDismiss: { store.editorClosed() }) { NewEntryEditor(income: collection == .income) }
    }
}
struct NewPayment: Identifiable {
    let id = UUID()
    var repeatRule = "monthly"
    var amount = ""
    var day = ""
    var hasDate = false
    var date = Date()
}
struct NewEntryEditor: View {
    let income: Bool
    @EnvironmentObject private var store: PlanStore
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var amount = ""
    @State private var incomeType = "salary"
    @State private var expenseType = "regular"
    @State private var repeatRule = "monthly"
    @State private var day = ""
    @State private var advanceDay = ""
    @State private var tax = "13"
    @State private var share = "50"
    @State private var date = Date()
    @State private var creditLimit = ""
    @State private var cardBalance = ""
    @State private var payments = [NewPayment()]
    @State private var message: String?
    private func iso(_ value: Date) -> String { let f=DateFormatter();f.locale=Locale(identifier:"en_US_POSIX");f.calendar=Calendar(identifier:.gregorian);f.dateFormat="yyyy-MM-dd";return f.string(from:value) }
    var body: some View {
        NavigationStack {
            Form {
                Section("Тип") {
                    if income {
                        Picker("Доход", selection:$incomeType) { Text("Зарплата").tag("salary");Text("Подработка").tag("side");Text("Выплаты и поступления").tag("support");Text("Другое").tag("other") }
                    } else {
                        Picker("Расход", selection:$expenseType) { Text("Услуги и покупки").tag("regular");Text("Кредит").tag("loan");Text("Ипотека").tag("mortgage");Text("Частный долг").tag("personal");Text("Кредитная карта").tag("card") }
                    }
                    TextField("Название", text:$name)
                }
                if income {
                    Section("Сумма и периодичность") {
                        TextField(incomeType == "salary" ? "Сумма до налога, ₽" : "Сумма, ₽", text:$amount).keyboardType(.decimalPad)
                        Picker("Повтор", selection:$repeatRule) { Text("Разово").tag("once"); Text("Ежемесячно").tag("monthly") }.pickerStyle(.segmented)
                        if repeatRule == "monthly" { LabeledContent(incomeType == "salary" ? "Число зарплаты" : "Число месяца") { TextField("1–31", text:$day).keyboardType(.numberPad).multilineTextAlignment(.trailing) } }
                        else { DatePicker("Дата", selection:$date, displayedComponents:.date) }
                    }
                    if incomeType == "salary" {
                        Section("Зарплата") {
                            LabeledContent("Налог, %") { TextField("%", text:$tax).keyboardType(.decimalPad).multilineTextAlignment(.trailing) }
                            if repeatRule == "monthly" {
                                LabeledContent("Доля зарплаты, %") { TextField("%", text:$share).keyboardType(.decimalPad).multilineTextAlignment(.trailing) }
                                LabeledContent("Число аванса") { TextField("1–31", text:$advanceDay).keyboardType(.numberPad).multilineTextAlignment(.trailing) }
                                Text("Остальная доля — аванс. Если аванса нет, укажи 100%.").font(.footnote).foregroundStyle(.secondary)
                            }
                        }
                    }
                } else {
                    if expenseType == "card" {
                        Section("Кредитная карта, ₽") { TextField("Кредитный лимит", text:$creditLimit).keyboardType(.decimalPad);TextField("Баланс карты", text:$cardBalance).keyboardType(.numbersAndPunctuation) }
                    } else if expenseType != "regular" {
                        Section("Долг") { TextField("Остаток долга, ₽", text:$amount).keyboardType(.decimalPad) }
                    }
                    ForEach($payments) { $payment in
                        Section("Платёж") {
                            if expenseType == "regular" || expenseType == "loan" {
                                Picker("Периодичность", selection:$payment.repeatRule) { Text("Разово").tag("once");Text("Ежемесячно").tag("monthly").disabled(expenseType == "loan" && payments.count > 1) }.pickerStyle(.segmented)
                            }
                            TextField("Сумма, ₽", text:$payment.amount).keyboardType(.decimalPad)
                            if payment.repeatRule == "monthly" {
                                LabeledContent("Число месяца") { TextField("1–31", text:$payment.day).keyboardType(.numberPad).multilineTextAlignment(.trailing) }
                            } else {
                                Toggle("Указать дату", isOn:$payment.hasDate)
                                if payment.hasDate { DatePicker("Дата", selection:$payment.date, displayedComponents:.date) }
                            }
                            if expenseType != "regular" { Button("Убрать платёж", role:.destructive) { payments.removeAll { $0.id == payment.id } } }
                        }
                    }
                    if expenseType != "regular" {
                        Button("Добавить платёж", systemImage:"plus.circle") {
                            var item=NewPayment(); item.repeatRule = (expenseType == "mortgage" ? "monthly" : "once")
                            payments.append(item)
                        }.disabled((expenseType == "mortgage" && !payments.isEmpty) || (expenseType == "loan" && payments.contains { $0.repeatRule == "monthly" }))
                        if expenseType == "loan" && payments.contains(where: { $0.repeatRule == "monthly" }) { Text("Чтобы добавить несколько платежей, выбери разовый платёж.").font(.footnote).foregroundStyle(.secondary) }
                    }
                    Text("Без суммы или даты платёж сохранится как черновик.").font(.footnote).foregroundStyle(.secondary)
                }
                if let message { Section { Text(message).foregroundStyle(.red) } }
            }
            .navigationTitle(income ? "Добавить доход" : "Добавить расход").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement:.cancellationAction) { Button("Отмена") { dismiss() } }
                ToolbarItem(placement:.confirmationAction) { Button("Добавить") {
                    do {
                        var input:[String:Any] = ["section":income ? "incomeSources" : "expense", "name":name, "amount":amount]
                        if income { input.merge(["incomeType":incomeType,"repeat":repeatRule,"day":day,"advanceDay":advanceDay,"taxRate":tax,"salaryShare":repeatRule == "once" ? "100" : share,"date":iso(date)]) { _,new in new } }
                        else { input.merge(["type":expenseType,"creditLimit":creditLimit,"cardBalance":cardBalance,"payments":payments.map { ["repeat":$0.repeatRule,"amount":$0.amount,"day":$0.day,"date":$0.hasDate ? iso($0.date) : ""] }]) { _,new in new } }
                        try store.createEntry(input:input);dismiss()
                    } catch { message=error.localizedDescription }
                } }
            }
            .onChange(of:expenseType) { type in var payment=NewPayment();payment.repeatRule = (type == "personal" || type == "card") ? "once" : "monthly";payments=[payment] }
        }
    }
}
struct EntryEditor: View {
    let item: EditableItem
    @EnvironmentObject private var store: PlanStore
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var amount = ""
    @State private var day = ""
    @State private var advanceDay = ""
    @State private var tax = ""
    @State private var salaryShare = ""
    @State private var creditLimit = ""
    @State private var cardBalance = ""
    @State private var incomeType = "salary"
    @State private var debtType = "loan"
    @State private var hasDue = false
    @State private var due = Date()
    @State private var repeatChoice = "once"
    @State private var hasDate = false
    @State private var date = Date()
    @State private var message: String?
    private var isCard: Bool { item.section == "debts" && debtType == "card" }
    private var isSalary: Bool { item.section == "incomeSources" && incomeType == "salary" }
    private func asText(_ amount: Int64?) -> String { amount.map { String(format: "%.2f", locale: Locale(identifier:"en_US_POSIX"), Double($0)/100) } ?? "" }
    private func iso(_ value: Date) -> String { let f=DateFormatter(); f.locale=Locale(identifier:"en_US_POSIX"); f.calendar=Calendar(identifier:.gregorian); f.dateFormat="yyyy-MM-dd"; return f.string(from:value) }
    private func dayFrom(_ string: String?) -> Int? { guard let string else { return nil }; return Int(string.suffix(2)) }
    var body: some View {
        NavigationStack {
            Form {
                Section("Название") { TextField("Название", text:$name) }
                if item.section == "incomeSources" {
                    Section("Тип дохода") {
                        Picker("Тип", selection:$incomeType) {
                            Text("Зарплата").tag("salary")
                            Text("Подработка").tag("side")
                            Text("Выплаты и поступления").tag("support")
                            Text("Другое").tag("other")
                        }
                        if (item.entry.incomeType == nil || item.entry.incomeType == "salary") && incomeType != "salary" {
                            Text("Для нового типа налог и разделение на зарплату и аванс будут сброшены.").font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                }
                if item.section == "debts" {
                    Section("Тип долга") {
                        Picker("Тип", selection:$debtType) {
                            Text("Кредит").tag("loan")
                            Text("Ипотека").tag("mortgage")
                            Text("Частный долг").tag("personal")
                            Text("Кредитная карта").tag("card")
                        }
                        Text("Связанные платежи сохранятся. Если расписание не подходит новому типу, сначала измени его.").font(.footnote).foregroundStyle(.secondary)
                    }
                }
                if isCard {
                    Section("Параметры карты, ₽") {
                        LabeledContent("Кредитный лимит") { TextField("₽", text:$creditLimit).keyboardType(.decimalPad).multilineTextAlignment(.trailing) }
                        LabeledContent("Баланс карты") { TextField("₽", text:$cardBalance).keyboardType(.numbersAndPunctuation).multilineTextAlignment(.trailing) }
                        Text("Остаток долга рассчитывается из лимита и баланса.").font(.footnote)
                    }
                } else {
                    Section(item.section == "debts" ? "Остаток долга, ₽" : "Сумма, ₽") {
                        TextField("Сумма", text:$amount).keyboardType(.decimalPad)
                        if isSalary { Text("Сумма до налога").font(.footnote) }
                    }
                }
                if item.section != "debts" {
                    if item.entry.debtId == nil && item.entry.repeatRule != "yearly" {
                        Section("Периодичность") { Picker("Повтор", selection:$repeatChoice) { Text("Разово").tag("once"); Text("Ежемесячно").tag("monthly") }.pickerStyle(.segmented) }
                    }
                    if repeatChoice == "monthly" {
                        Section("Расписание") { LabeledContent(isSalary ? "Число зарплаты" : "Число месяца") { TextField("1–31", text:$day).keyboardType(.numberPad).multilineTextAlignment(.trailing) }; Text("От 1 до 31; 31 — последний день короткого месяца.").font(.footnote) }
                    } else {
                        Section("Дата") { Toggle("Указать дату", isOn:$hasDate).disabled(item.section == "incomeSources" || item.entry.kind == "income"); if hasDate { DatePicker("Дата", selection:$date, displayedComponents:.date) } }
                    }
                }
                if isSalary {
                    Section("Зарплата") {
                        LabeledContent("Налог, %") { TextField("%", text:$tax).keyboardType(.decimalPad).multilineTextAlignment(.trailing) }
                        if repeatChoice == "monthly" { LabeledContent("Доля зарплаты, %") { TextField("%", text:$salaryShare).keyboardType(.decimalPad).multilineTextAlignment(.trailing) }; LabeledContent("Число аванса") { TextField("1–31", text:$advanceDay).keyboardType(.numberPad).multilineTextAlignment(.trailing) }; Text("Остальная доля — аванс.").font(.footnote) }
                    }
                }
                if item.section == "debts" && (debtType == "loan" || debtType == "mortgage") {
                    Section("Срок погашения") {
                        Toggle("Указать срок", isOn:$hasDue)
                        if hasDue { DatePicker("Погасить до", selection:$due, displayedComponents:.date) }
                    }
                }
                if let message { Section { Text(message).foregroundStyle(.red) } }
                if item.section == "transactions" && item.entry.debtId != nil { Section { Text("Погашения частных долгов и карт остаются разовыми.").font(.footnote).foregroundStyle(.secondary) } }
            }.navigationTitle("Изменить запись").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } }; ToolbarItem(placement: .confirmationAction) { Button("Сохранить") {
                do {
                    var details: [String:String] = [:]
                    if item.section == "incomeSources" { details["incomeType"]=incomeType }
                    if item.section == "debts" {
                        details["debtType"]=debtType
                        if debtType == "loan" || debtType == "mortgage" { if hasDue { details["due"]=iso(due) } else { details["clearDue"]="true" } }
                    }
                    if isCard { details["creditLimit"]=creditLimit; details["cardBalance"]=cardBalance }
                    if item.section != "debts" { if item.entry.repeatRule != "yearly" { details["repeat"]=repeatChoice }; if repeatChoice == "monthly" { if !day.isEmpty { details["day"]=day } } else if hasDate { details["date"]=iso(date) } else { details["clearDate"]="true" } }
                    if isSalary { details["taxRate"]=tax; if repeatChoice == "monthly" { details["salaryShare"]=salaryShare; if !advanceDay.isEmpty { details["advanceDay"]=advanceDay } } }
                    try store.editEntry(section:item.section,id:item.entry.id,name:name,amount:amount,details:details); dismiss()
                } catch { message = error.localizedDescription }
            } } }
            .onAppear {
                repeatChoice=item.entry.repeatRule ?? "once"; name=item.entry.name; amount=asText(item.entry.amount); creditLimit=asText(item.entry.creditLimit); cardBalance=asText(item.entry.cardBalance); incomeType=item.entry.incomeType ?? "salary"; debtType=item.entry.kind ?? "loan"
                day=(item.entry.salaryDay ?? item.entry.day ?? (item.entry.draft == true ? nil : dayFrom(item.entry.date))).map(String.init) ?? ""
                advanceDay=(item.entry.advanceDay ?? dayFrom(item.entry.advanceDate)).map(String.init) ?? ""
                tax=asText(item.entry.taxRate.map(Int64.init)); salaryShare=asText(item.entry.salaryShare.map(Int64.init))
                if let value=item.entry.date { let f=DateFormatter();f.locale=Locale(identifier:"en_US_POSIX");f.dateFormat="yyyy-MM-dd";if let parsed=f.date(from:value){ date=parsed;hasDate=true } }
                if let value=item.entry.due { let f=DateFormatter();f.locale=Locale(identifier:"en_US_POSIX");f.dateFormat="yyyy-MM-dd";if let parsed=f.date(from:value){ due=parsed;hasDue=true } }
            }
            .onChange(of: incomeType) { _ in tax="0"; salaryShare="100"; advanceDay="" }
        }
    }
}
struct MoreView: View {
    @EnvironmentObject private var store: PlanStore
    @Binding var importing: Bool
    @State private var cloudChoice: CloudChoice?
    @State private var snapshotChoice: Bool?
    @State private var previewChoice: CloudChoice?
    @State private var importingBackup = false
    @State private var exportingBackup = false
    @State private var confirmingImport = false
    @State private var pendingImport: Data?
    @State private var exportDocument: BackupDocument?
    @State private var exportName = "finroad-backup"
    var body: some View { ScrollView { VStack(alignment: .leading, spacing: 14) {
        VStack(alignment: .leading, spacing: 8) { HStack { Label("iCloud Drive", systemImage: "icloud").font(.headline); Spacer(); Text(store.shortSyncStatus).font(.caption.bold()).foregroundStyle(mint) }
            Text("Изменения сохраняются на iPhone. Обмен проверяется, пока приложение открыто; доставка между устройствами зависит от iCloud.").font(.footnote).foregroundStyle(.secondary)
            DisclosureGroup("Подробнее о состоянии") { Text(store.status).font(.footnote).foregroundStyle(.secondary).padding(.top, 4) }.font(.subheadline)
            Button("Выбрать файл FinRoad") { store.isEditing = true; importing = true }.buttonStyle(.borderedProminent).tint(accent).foregroundStyle(ink).disabled(store.syncing)
            Button("Синхронизировать") { store.refresh() }.buttonStyle(.bordered).disabled(store.syncing)
        }.card()
        Text("Прошедшие события учитываются автоматически, когда приложение открыто. Отметки событий можно изменить в плане.").font(.footnote).foregroundStyle(.secondary)
        VStack(alignment:.leading, spacing:10) {
            Text("Импорт и экспорт").font(.headline)
            Text("Экспорт — отдельная копия. Импорт заменит план на iPhone и затем проверит общий файл.").font(.footnote).foregroundStyle(.secondary)
            HStack {
                Button("Импортировать") { importingBackup=true }.buttonStyle(.bordered).disabled(store.syncing || store.conflict != nil || store.cloudConflict != nil)
                Button("Экспортировать") {
                    do { let f=DateFormatter();f.locale=Locale(identifier:"en_US_POSIX");f.dateFormat="yyyy-MM-dd_HH-mm-ss";exportName="finroad-backup-\(f.string(from:Date()))";exportDocument=BackupDocument(data:try store.exportData());exportingBackup=true }
                    catch { store.error=error.localizedDescription }
                }.buttonStyle(.bordered).disabled(store.plan == nil)
            }
        }.card()
        if let conflict = store.conflict {
            VStack(alignment: .leading, spacing: 10) {
                Text("Есть две версии плана").font(.headline)
                Text("Перед выбором приложение сохранит обе копии на iPhone. Выбирается весь план целиком.").font(.footnote).foregroundStyle(.secondary)
                Text("На iPhone: остаток \(rubles(conflict.localBalance))")
                Button("Посмотреть версию iPhone") { previewChoice = CloudChoice(id:"snapshot-local",title:"Версия iPhone",balance:conflict.localBalance,count:0,plan:conflict.localPlan) }
                Button("Оставить версию iPhone") { snapshotChoice = true }.buttonStyle(.bordered).disabled(store.syncing)
                Text("В общем файле: остаток \(rubles(conflict.remoteBalance))")
                Button("Посмотреть общий файл") { previewChoice = CloudChoice(id:"snapshot-remote",title:"Общий файл",balance:conflict.remoteBalance,count:0,plan:conflict.remotePlan) }
                Button("Взять общий файл") { snapshotChoice = false }.buttonStyle(.bordered).disabled(store.syncing)
                Text("Сумма — только ориентир; версии могут отличаться другими записями.").font(.footnote).foregroundStyle(.secondary)
            }.card()
        }
        if !store.backupFiles.isEmpty {
            DisclosureGroup("Резервные копии · \(store.backupFiles.count)") {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Копии хранятся на iPhone для восстановления после конфликта или смены файла. В общий файл iCloud они не добавляются.").font(.footnote).foregroundStyle(.secondary)
                    ForEach(store.backupFiles, id: \.self) { url in
                        ShareLink(item: url) { Label("Сохранить копию \(url.deletingLastPathComponent().lastPathComponent.prefix(6)) · \(url.lastPathComponent)", systemImage: "square.and.arrow.up") }
                    }
                }.padding(.top, 8)
            }.card()
        }
        if let conflict = store.cloudConflict {
            VStack(alignment: .leading, spacing: 12) {
                Text("iCloud обнаружил разные версии").font(.headline)
                Text("Выбери весь план. Перед применением все версии будут сохранены в копиях на iPhone.").font(.footnote).foregroundStyle(.secondary)
                ForEach(conflict.choices) { choice in
                    VStack(alignment: .leading, spacing: 4) {
                        Text("\(choice.title) · остаток \(rubles(choice.balance)) · записей \(choice.count)").font(.subheadline)
                        HStack { Button("Посмотреть") { previewChoice = choice }; Button("Выбрать") { cloudChoice = choice }.buttonStyle(.bordered).disabled(store.syncing) }
                    }
                }
                Text("Остаток и количество записей — ориентир. Другие поля тоже могут отличаться.").font(.footnote).foregroundStyle(.secondary)
            }.card()
        }
    }.padding() }.background(ink).navigationTitle("Ещё")
        .fileImporter(isPresented:$importingBackup, allowedContentTypes:[.json]) { result in
            store.isEditing=true
            do { pendingImport=try store.readImport(result.get()); confirmingImport=true }
            catch { store.isEditing=false;store.error=error.localizedDescription }
        }
        .fileExporter(isPresented:$exportingBackup, document:exportDocument, contentType:.json, defaultFilename:exportName) { result in
            if case .failure(let error)=result { store.error=error.localizedDescription }
        }
        .alert("Импортировать план?", isPresented:$confirmingImport) {
            Button("Импортировать") { do { if let data=pendingImport { try store.importData(data) };pendingImport=nil;store.editorClosed() } catch { pendingImport=nil;store.isEditing=false;store.error=error.localizedDescription } }
            Button("Отмена", role:.cancel) { pendingImport=nil;store.editorClosed() }
        } message: { Text("Текущий план сохранится в резервных копиях на iPhone. Если общий файл изменился, приложение попросит выбрать версию.") }
        .sheet(item: $previewChoice) { choice in PlanVersionPreview(choice: choice) }
        .confirmationDialog("Применить выбранный план целиком?", isPresented: Binding(get: { snapshotChoice != nil }, set: { if !$0 { snapshotChoice = nil } }), titleVisibility: .visible) {
            if let local = snapshotChoice { Button(local ? "Оставить версию iPhone" : "Взять общий файл") { store.resolveSnapshot(useLocal: local); snapshotChoice = nil } }
            Button("Отмена", role: .cancel) { snapshotChoice = nil }
        } message: { Text("Перед применением обе версии сохранятся в копиях на iPhone. Убедись, что выбрана нужная версия целиком.") }
        .confirmationDialog("Применить выбранный план целиком?", isPresented: Binding(get: { cloudChoice != nil }, set: { if !$0 { cloudChoice = nil } }), titleVisibility: .visible) {
            if let choice = cloudChoice { Button("Применить: \(choice.title)") { store.resolveCloud(choice: choice.id); cloudChoice = nil } }
            Button("Отмена", role: .cancel) { cloudChoice = nil }
        } message: { Text("Все версии будут сохранены локально перед применением. Проверь, что выбрана нужная версия.") }
    }
}

struct PlanVersionPreview: View {
    let choice: CloudChoice
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            List {
                Section("Остаток") { Text(rubles(choice.plan.balance)) }
                Section("Доходы") { ForEach(choice.plan.incomeSources) { row in HStack { Text(row.name); Spacer(); Text(rubles(row.amount)) } } }
                Section("Платежи") { ForEach(choice.plan.transactions) { row in VStack(alignment:.leading) { HStack { Text(row.name); Spacer(); Text(rubles(row.amount)) }; if let date=row.date { Text(date).font(.caption).foregroundStyle(.secondary) } } } }
                Section("Долги") { ForEach(choice.plan.debts) { row in HStack { Text(row.name); Spacer(); Text(rubles(row.amount)) } } }
                Section { Text("Здесь показаны основные поля. Расписание, история выполнения и другие параметры также могут отличаться.").font(.footnote).foregroundStyle(.secondary) }
            }.navigationTitle(choice.title).navigationBarTitleDisplayMode(.inline).toolbar { ToolbarItem(placement:.confirmationAction) { Button("Готово") { dismiss() } } }
        }
    }
}
