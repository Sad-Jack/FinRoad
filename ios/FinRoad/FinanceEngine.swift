import Foundation
import JavaScriptCore

struct Plan: Decodable {
    let balance: Int64?
    let transactions: [Entry]
    let debts: [Entry]
    let incomeSources: [Entry]
}
struct Entry: Decodable, Identifiable {
    let id: String
    let name: String
    let amount: Int64?
    let kind: String?
    let repeatRule: String?
    let date: String?
    let debtId: String?
    let loanDebtId: String?
    let day: Int?
    let salaryDay: Int?
    let advanceDay: Int?
    let advanceDate: String?
    let incomeType: String?
    let taxRate: Int?
    let salaryShare: Int?
    let draft: Bool?
    let creditLimit: Int64?
    let cardBalance: Int64?
    let due: String?
    enum CodingKeys: String, CodingKey { case id, name, amount, kind, date, debtId, loanDebtId, day, salaryDay, advanceDay, advanceDate, incomeType, taxRate, salaryShare, draft, creditLimit, cardBalance, due; case repeatRule = "repeat" }
}
struct Forecast: Decodable {
    let balance: Int64
    let income: Int64
    let expense: Int64
    let firstShortfall: Point?
    let points: [Point]
    let rows: [PlanRow]
    let automaticHistory: [AutomaticHistory]
}
struct PlanRow: Decodable, Identifiable {
    let date: String
    let balance: Int64?
    let event: Event
    let completed: Bool
    var id: String { event.key }
}
struct AutomaticHistory: Decodable, Identifiable {
    let key: String
    let date: String
    let name: String
    let kind: String
    let delta: Int64
    var id: String { key }
}
struct Point: Decodable, Identifiable {
    let date: String
    let balance: Int64
    let event: Event?
    var id: String { event?.key ?? date }
}
struct Event: Decodable {
    let key: String
    let name: String
    let kind: String
    let amount: Int64
}

enum FinanceError: LocalizedError {
    case missingResource, invalid(String)
    var errorDescription: String? {
        switch self { case .missingResource: return "Не найдены файлы финансовой модели."; case .invalid(let reason): return reason }
    }
}

/// Shared JS financial rules: no separate iOS implementation of calculations.
final class FinanceEngine {
    private let context = JSContext()!
    private var jsError: String?
    init(resources: URL) throws {
        context.exceptionHandler = { [weak self] _, error in self?.jsError = error?.toString() }
        context.evaluateScript("globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));")
        for name in ["calendar", "finance", "state"] {
            let source = resources.appendingPathComponent(name + ".js")
            guard FileManager.default.fileExists(atPath: source.path) else { throw FinanceError.missingResource }
            context.evaluateScript(try String(contentsOf: source, encoding: .utf8))
            if let jsError { throw FinanceError.invalid(jsError) }
        }
        context.evaluateScript("""
        globalThis.finroadValidate = text => JSON.stringify(module_3.validateState(JSON.parse(text)));
        globalThis.finroadForecast = (text,start,end) => {
            const state=module_3.validateState(JSON.parse(text)), forecast=module_1.forecast(state,start,end);
            const pending=forecast.points.filter(p=>p.event).map(p=>({date:p.event.date,balance:p.balance,event:p.event,completed:false}));
            const done=Object.entries(state.completed).filter(([,e])=>e.planEvent && e.date>=start && e.date<=end)
                .map(([key,e])=>({date:e.date,balance:null,event:{...e.planEvent,key},completed:true,delta:e.balanceDelta??e.delta}));
            const rows=[...pending,...done].sort((a,b)=>a.date.localeCompare(b.date)||Number(b.completed)-Number(a.completed)||((a.event.kind==='income'?-1:1)-(b.event.kind==='income'?-1:1))||a.event.name.localeCompare(b.event.name));
            let balance=BigInt(state.balance??0)-done.reduce((sum,row)=>sum+BigInt(row.delta),0n);
            for(const row of rows) if(row.completed) { balance+=BigInt(row.delta);row.balance=balance>=BigInt(Number.MIN_SAFE_INTEGER)&&balance<=BigInt(Number.MAX_SAFE_INTEGER)?Number(balance):null; }
            const automaticHistory=Object.entries(state.completed).filter(([,e])=>e.automatic && e.planEvent && e.date<start)
                .sort((a,b)=>b[1].date.localeCompare(a[1].date))
                .map(([key,e])=>({key,date:e.date,name:e.name??e.planEvent.name,kind:e.kind,delta:e.balanceDelta??e.delta}));
            return JSON.stringify({...forecast,rows,automaticHistory});
        };
        globalThis.finroadClosePastDays = (text,now) => {
            const state=module_3.validateState(JSON.parse(text)), result=module_1.closePastDays(state,now);
            return JSON.stringify({state:module_3.validateState(state),changed:result.changed,count:result.count});
        };
        globalThis.finroadToggleEvent = (text,key,completed,now,end) => {
            const state=module_3.validateState(JSON.parse(text));
            module_1.closePastDays(state,now);
            if(completed) module_1.undoSettlement(state,key);
            else {
                const event=module_1.eventsBetween(state,now,end).find(item=>item.key===key);
                if(!event)throw Error('Событие больше не найдено в плане');
                module_1.settle(state,event,now);
            }
            return JSON.stringify(module_3.validateState(state));
        };
        globalThis.finroadSetBalance = (text,value,date) => { const state=module_3.validateState(JSON.parse(text)); state.balance=typeof value === "string" ? module_1.parseBalanceExpression(value) : value; state.balanceDate=date; return JSON.stringify(module_3.validateState(state)); };
        globalThis.finroadCreateEntry = (text, inputJSON, idsJSON) => {
            const state=module_3.validateState(JSON.parse(text)), input=JSON.parse(inputJSON), ids=JSON.parse(idsJSON);
            const name=String(input.name || '').trim(); if (!name) throw Error('Укажи название');
            const money=value => String(value ?? '').trim() ? module_1.parseMoney(value) : null;
            if (input.section === 'incomeSources') {
                const amount=money(input.amount), salary=input.incomeType === 'salary';
                if (amount === null || amount <= 0) throw Error('Укажи сумму дохода');
                const share=salary ? money(input.salaryShare) : 10000, tax=salary ? money(input.taxRate) : 0;
                if (share === null || tax === null) throw Error('Укажи налог и долю зарплаты');
                const monthly=input.repeat === 'monthly', day=Number(input.day), advance=Number(input.advanceDay);
                if (monthly && share > 0 && (!Number.isInteger(day) || day < 1 || day > 31)) throw Error('Укажи число выплаты от 1 до 31');
                if (monthly && salary && share < 10000 && (!Number.isInteger(advance) || advance < 1 || advance > 31)) throw Error('Укажи число аванса от 1 до 31');
                const anchor=monthly ? input.date.slice(0,7)+'-01' : input.date;
                module_1.saveIncomeSource(state,{id:ids[0],name,incomeType:input.incomeType,amount,taxRate:tax,salaryShare:share,repeat:input.repeat,date:anchor,advanceDate:monthly && salary && share<10000 ? anchor : null,salaryDay:monthly && share>0 ? day : null,advanceDay:monthly && salary && share<10000 ? advance : null});
            } else if (input.section === 'expense') {
                const payments=input.payments.map(p=>({repeat:p.repeat,amount:money(p.amount),day:p.day ? Number(p.day) : null,date:p.date || null}));
                let index=0; const previous=globalThis.crypto;
                globalThis.crypto={randomUUID:()=> { if (index>=ids.length) throw Error('Не удалось создать запись'); return ids[index++]; }};
                try { module_1.savePaymentEntry(state,{type:input.type,name,amount:money(input.amount),creditLimit:money(input.creditLimit),cardBalance:money(input.cardBalance),payments}); }
                finally { if (previous === undefined) delete globalThis.crypto; else globalThis.crypto=previous; }
            } else throw Error('Неизвестный тип записи');
            return JSON.stringify(module_3.validateState(state));
        };
        globalThis.finroadEditEntry = (text, section, id, name, amountText, detailsJSON) => {
            const state = module_3.validateState(JSON.parse(text));
            if (!['transactions','debts','incomeSources'].includes(section)) throw Error('Неизвестный тип записи');
            const item = state[section].find(entry => entry.id === id);
            if (!item) throw Error('Запись больше не найдена');
            const previousTiming = { repeat:item.repeat, date:item.date };
            const previousKind = item.kind;
            const trimmed=String(name).trim(); if (!trimmed) throw Error('Укажи название');
            let amount = String(amountText).trim() ? module_1.parseMoney(amountText) : null;
            const details = JSON.parse(detailsJSON || '{}');
            if (section === 'debts') {
                if (details.clearDue === 'true') item.due=null;
                else if (details.due) item.due=details.due;
            }
            if (section === 'incomeSources' && 'incomeType' in details) {
                const type=details.incomeType;
                if (!['salary','side','support','other'].includes(type)) throw Error('Выбери тип дохода');
                if (type !== (item.incomeType || 'salary')) {
                    item.incomeType=type;
                    // Non-salary incomes have no tax or advance split in the shared model.
                    item.taxRate=0; item.salaryShare=10000; item.advanceDate=null;
                    delete item.advanceDay;
                }
            }
            if (section === 'debts' && 'debtType' in details && details.debtType !== item.kind) {
                const type=details.debtType;
                if (!['loan','mortgage','personal','card'].includes(type)) throw Error('Выбери тип долга');
                const payments=['loan','mortgage'].includes(item.kind)
                    ? module_1.loanPayments(state,item)
                    : state.transactions.filter(row=>row.debtId===id);
                const ids=new Set(payments.map(row=>row.id));
                if (Object.entries(state.completed).some(([key,row])=>row.debtId===id || row.planEvent?.debtId===id || row.planEvent?.loanDebtId===id || [...ids].some(paymentId=>key.startsWith(paymentId+':'))))
                    throw Error('У долга есть учтённые платежи. Изменение типа пока недоступно, чтобы сохранить историю.');
                if (['personal','card'].includes(type) && payments.some(row=>row.repeat!=='once'))
                    throw Error('Для частного долга и карты платежи должны быть разовыми. Сначала измени расписание.');
                if (type==='mortgage' && payments.some(row=>row.repeat!=='monthly'))
                    throw Error('Для ипотеки нужен ежемесячный платёж. Сначала измени расписание.');
                if (['loan','mortgage'].includes(type) && payments.length>1 && payments.some(row=>row.repeat==='monthly'))
                    throw Error('Ежемесячный платёж должен быть один.');
                if (['personal','card'].includes(type) && item.due) throw Error('У долга указан срок погашения. Сначала убери его в параметрах долга.');
                item.kind=type; item.explicitSchedule=true;
                for (const row of payments) {
                    delete row.debtId; delete row.loanDebtId;
                    if (['personal','card'].includes(type)) row.debtId=id; else row.loanDebtId=id;
                }
            }
            if (section === 'debts' && item.kind === 'card') {
                const limit = String(details.creditLimit ?? '').trim() ? module_1.parseMoney(details.creditLimit) : null;
                const balance = String(details.cardBalance ?? '').trim() ? module_1.parseMoney(details.cardBalance) : null;
                if (!('creditLimit' in details) || !('cardBalance' in details)) throw Error('Укажи параметры карты');
                if (previousKind !== 'card' && (limit === null || balance === null)) throw Error('Для смены типа укажи лимит и баланс карты');
                item.creditLimit=limit; item.cardBalance=balance; amount=module_1.cardDebtAmount(limit,balance);
            }
            item.name = trimmed; item.amount = amount;
            if ('repeat' in details && details.repeat !== item.repeat) {
                if (!['once','monthly'].includes(details.repeat)) throw Error('Выбери периодичность');
                if (section === 'debts' || (section === 'transactions' && item.debtId && details.repeat !== 'once')) throw Error('Для погашения укажи конкретную дату');
                if (section === 'transactions' && item.repeat === 'once' && state.completed[`${item.id}:${item.date}`]) throw Error('Нельзя изменить периодичность выполненного события');
                if (section === 'transactions' && item.loanDebtId && details.repeat === 'once' && state.debts.find(debt=>debt.id===item.loanDebtId)?.kind === 'mortgage') throw Error('Ипотека оплачивается ежемесячно');
                item.repeat=details.repeat;
                if (section === 'transactions' && item.repeat !== 'monthly') delete item.day;
            }
            if (details.clearDate === 'true') {
                if (section !== 'transactions' || item.kind !== 'expense') throw Error('Укажи дату');
                if (item.repeat === 'once' && state.completed[`${item.id}:${item.date}`]) throw Error('Нельзя убрать дату выполненного события');
                item.date=null; item.draft=true;
            }
            if ('date' in details && details.date) {
                if (section === 'transactions') { if (item.repeat === 'once' && state.completed[`${item.id}:${item.date}`] && details.date !== item.date) throw Error('Нельзя изменить дату выполненного события'); item.date=details.date; if (item.repeat==='monthly') { item.day=Number(details.date.slice(8,10)); item.date=details.date.slice(0,7)+'-01'; } if (item.draft && item.amount !== null && item.date) delete item.draft; }
                if (section === 'incomeSources') { item.date=details.date; if(item.repeat==='monthly') item.salaryDay=Number(details.date.slice(8,10)); }
            }
            if ('day' in details && item.repeat === 'monthly') {
                const day=Number(details.day); if (!Number.isInteger(day) || day<1 || day>31) throw Error('Выбери число от 1 до 31');
                if (section === 'transactions') { Object.assign(item,module_1.paymentTiming('monthly',day,null,previousTiming)); if (item.draft && item.amount !== null) delete item.draft; }
                if (section === 'incomeSources') item.salaryDay=day;
            }
            if (section === 'incomeSources' && (item.incomeType == null || item.incomeType === 'salary')) {
                if ('taxRate' in details) item.taxRate=module_1.parseMoney(details.taxRate);
                if ('salaryShare' in details) item.salaryShare=module_1.parseMoney(details.salaryShare);
                if ('advanceDay' in details && item.repeat==='monthly') { const day=Number(details.advanceDay); if(!Number.isInteger(day)||day<1||day>31) throw Error('Выбери число аванса от 1 до 31'); item.advanceDay=day; if(!item.advanceDate) item.advanceDate=item.date; }
                if ('advanceDate' in details && details.advanceDate) { item.advanceDate=details.advanceDate; if(item.repeat==='monthly') item.advanceDay=Number(details.advanceDate.slice(8,10)); }
            }
            if (section === 'incomeSources') { if (amount === null || amount <= 0) throw Error('Укажи сумму дохода'); module_1.saveIncomeSource(state,item); }
            if (section === 'transactions' && !item.draft && (amount === null || amount <= 0)) throw Error('Укажи сумму платежа больше нуля');
            if (section === 'debts') for (const row of state.transactions) if (row.debtId === id || row.loanDebtId === id) row.name = trimmed;
            return JSON.stringify(module_3.validateState(state));
        };

        """)
        if let jsError { throw FinanceError.invalid(jsError) }
    }
    func validate(_ data: Data) throws -> (Data, Plan) {
        guard let text = String(data: data, encoding: .utf8), let fn = context.objectForKeyedSubscript("finroadValidate") else { throw FinanceError.invalid("Не удалось прочитать файл.") }
        jsError = nil; context.exception = nil
        guard let output = fn.call(withArguments: [text])?.toString(), jsError == nil, let bytes = output.data(using: .utf8) else { throw FinanceError.invalid(jsError ?? "Некорректный финансовый план.") }
        return (bytes, try JSONDecoder().decode(Plan.self, from: bytes))
    }
    func updateBalance(_ bytes: Data, amount: Any, date: String) throws -> Data {
        jsError = nil; context.exception = nil
        guard let text = String(data: bytes, encoding: .utf8), let fn = context.objectForKeyedSubscript("finroadSetBalance"), let result = fn.call(withArguments: [text, amount, date])?.toString(), jsError == nil, let output = result.data(using: .utf8) else { throw FinanceError.invalid(jsError ?? "Не удалось изменить остаток.") }
        return output
    }
    func updateEntry(_ bytes: Data, section: String, id: String, name: String, amount: String, details: [String: String] = [:]) throws -> Data {
        jsError = nil; context.exception = nil
        let detailsText = String(data: try JSONSerialization.data(withJSONObject: details), encoding: .utf8)!
        guard let text = String(data: bytes, encoding: .utf8), let fn = context.objectForKeyedSubscript("finroadEditEntry"), let result = fn.call(withArguments: [text, section, id, name, amount, detailsText])?.toString(), jsError == nil, let output = result.data(using: .utf8) else { throw FinanceError.invalid(jsError ?? "Не удалось изменить запись.") }
        return output
    }
    func createEntry(_ bytes: Data, input: [String: Any]) throws -> Data {
        jsError = nil; context.exception = nil
        let inputText = String(data: try JSONSerialization.data(withJSONObject: input), encoding: .utf8)!
        let ids = (0..<128).map { _ in UUID().uuidString.lowercased() }
        let idsText = String(data: try JSONSerialization.data(withJSONObject: ids), encoding: .utf8)!
        guard let text = String(data: bytes, encoding: .utf8), let fn = context.objectForKeyedSubscript("finroadCreateEntry"), let result = fn.call(withArguments: [text,inputText,idsText])?.toString(), jsError == nil, let output = result.data(using: .utf8) else { throw FinanceError.invalid(jsError ?? "Не удалось добавить запись.") }
        return output
    }
    func forecast(_ bytes: Data, start: String, end: String) throws -> Forecast {
        jsError = nil; context.exception = nil
        guard let text = String(data: bytes, encoding: .utf8), let fn = context.objectForKeyedSubscript("finroadForecast"), let result = fn.call(withArguments: [text,start,end])?.toString(), jsError == nil, let data = result.data(using: .utf8) else { throw FinanceError.invalid(jsError ?? "Не удалось рассчитать план.") }
        return try JSONDecoder().decode(Forecast.self, from: data)
    }
    func closePastDays(_ bytes: Data, now: String) throws -> (data: Data, changed: Bool, count: Int) {
        jsError = nil; context.exception = nil
        guard let text=String(data:bytes,encoding:.utf8), let fn=context.objectForKeyedSubscript("finroadClosePastDays"), let result=fn.call(withArguments:[text,now])?.toString(), jsError == nil, let raw=result.data(using:.utf8), let object=try JSONSerialization.jsonObject(with:raw) as? [String:Any], let state=object["state"], let changed=object["changed"] as? Bool, let count=object["count"] as? Int else { throw FinanceError.invalid(jsError ?? "Не удалось выполнить автоматический учёт.") }
        let validated=try validate(JSONSerialization.data(withJSONObject:state)).0
        return (validated,changed,count)
    }
    func toggleEvent(_ bytes: Data, key: String, completed: Bool, now: String, end: String) throws -> Data {
        jsError = nil; context.exception = nil
        guard let text=String(data:bytes,encoding:.utf8), let fn=context.objectForKeyedSubscript("finroadToggleEvent"), let result=fn.call(withArguments:[text,key,completed,now,end])?.toString(), jsError == nil, let output=result.data(using:.utf8) else { throw FinanceError.invalid(jsError ?? "Не удалось изменить отметку события.") }
        return output
    }
}
