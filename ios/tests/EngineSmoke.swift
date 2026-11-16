import Foundation
@main struct EngineSmoke {
 static func main() throws {
  let engine = try FinanceEngine(resources: URL(fileURLWithPath: CommandLine.arguments[1]))
  let raw = Data(#"{"schema":1,"demo":false,"balance":100000,"balanceDate":"2026-11-14","autoFromDate":"2026-11-14","transactions":[{"id":"x","name":"Расход","kind":"expense","amount":20000,"repeat":"once","date":"2026-11-15"}],"debts":[],"incomeSources":[],"completed":{}}"#.utf8)
  let (data, plan) = try engine.validate(raw)
  precondition(plan.balance == 100000)
  let forecast = try engine.forecast(data, start:"2026-11-14", end:"2026-11-30")
  precondition(forecast.balance == 80000 && forecast.expense == 20000 && forecast.points.count == 3)
  precondition(forecast.rows.count == 1 && !forecast.rows[0].completed && forecast.rows[0].id == "x:2026-11-15")
  let manual=try engine.toggleEvent(data,key:"x:2026-11-15",completed:false,now:"2026-11-14",end:"2026-11-30")
  let (_, manualPlan)=try engine.validate(manual);precondition(manualPlan.balance==80000)
  let manualForecast=try engine.forecast(manual,start:"2026-11-14",end:"2026-11-30")
  precondition(manualForecast.rows.count==1 && manualForecast.rows[0].completed && manualForecast.rows[0].balance==80000 && manualForecast.expense==0)
  var mixed=try JSONSerialization.jsonObject(with:data) as! [String:Any]
  var mixedTransactions=mixed["transactions"] as! [[String:Any]]
  mixedTransactions.append(["id":"y","name":"Доход","kind":"income","amount":30000,"repeat":"once","date":"2026-11-15"])
  mixed["transactions"]=mixedTransactions
  let mixedData=try JSONSerialization.data(withJSONObject:mixed)
  let firstDone=try engine.toggleEvent(mixedData,key:"x:2026-11-15",completed:false,now:"2026-11-14",end:"2026-11-30")
  let bothDone=try engine.toggleEvent(firstDone,key:"y:2026-11-15",completed:false,now:"2026-11-14",end:"2026-11-30")
  let mixedForecast=try engine.forecast(bothDone,start:"2026-11-14",end:"2026-11-30")
  precondition(mixedForecast.rows.map(\.id)==["y:2026-11-15","x:2026-11-15"] && mixedForecast.rows.map(\.balance)==[130000,110000] && mixedForecast.income==0 && mixedForecast.expense==0)
  let undone=try engine.toggleEvent(manual,key:"x:2026-11-15",completed:true,now:"2026-11-14",end:"2026-11-30")
  let undonePlan=try engine.validate(undone).1;precondition(undonePlan.balance==100000)
  let automatic=try engine.closePastDays(data,now:"2026-11-16")
  let automaticPlan=try engine.validate(automatic.data).1;precondition(automatic.changed && automatic.count==1 && automaticPlan.balance==80000)
  let automaticForecast=try engine.forecast(automatic.data,start:"2026-11-16",end:"2026-11-30")
  precondition(automaticForecast.automaticHistory.count==1 && automaticForecast.automaticHistory[0].key=="x:2026-11-15")
  let repeated=try engine.closePastDays(automatic.data,now:"2026-11-16");precondition(!repeated.changed && repeated.count==0)
  let undoAutomatic=try engine.toggleEvent(automatic.data,key:"x:2026-11-15",completed:true,now:"2026-11-16",end:"2026-11-30")
  let afterUndo=try engine.closePastDays(undoAutomatic,now:"2026-11-16")
  let afterUndoPlan=try engine.validate(afterUndo.data).1;precondition(afterUndo.count==0 && afterUndoPlan.balance==100000)
  let cardData=Data(#"{"schema":1,"demo":false,"balance":100000,"balanceDate":"2026-11-14","autoFromDate":"2026-11-14","transactions":[{"id":"pay","name":"Карта","kind":"expense","amount":30000,"repeat":"once","date":"2026-11-15","debtId":"card"}],"debts":[{"id":"card","name":"Карта","kind":"card","amount":50000,"creditLimit":100000,"cardBalance":50000}],"incomeSources":[],"completed":{}}"#.utf8)
  let cardAuto=try engine.closePastDays(cardData,now:"2026-11-16"), cardClosed=try engine.validate(cardAuto.data).1
  precondition(cardAuto.count==1 && cardClosed.balance==70000 && cardClosed.debts[0].amount==20000 && cardClosed.debts[0].cardBalance==80000)
  let cardUndo=try engine.toggleEvent(cardAuto.data,key:"pay:2026-11-15",completed:true,now:"2026-11-16",end:"2026-11-30"), cardRestored=try engine.validate(cardUndo).1
  precondition(cardRestored.balance==100000 && cardRestored.debts[0].amount==50000 && cardRestored.debts[0].cardBalance==50000)
  let cardRepeat=try engine.closePastDays(cardUndo,now:"2026-11-16");precondition(cardRepeat.count==0)
  let salaryShift=Data(#"{"schema":1,"demo":false,"balance":100000,"balanceDate":"2026-11-13","autoFromDate":"2026-11-13","transactions":[],"debts":[],"incomeSources":[{"id":"salary","name":"Зарплата","incomeType":"salary","amount":100000,"taxRate":0,"salaryShare":10000,"repeat":"monthly","date":"2026-11-01","advanceDate":null,"salaryDay":15}],"completed":{}}"#.utf8)
  let shifted=try engine.closePastDays(salaryShift,now:"2026-11-14"), shiftedPlan=try engine.validate(shifted.data).1
  let shiftedForecast=try engine.forecast(shifted.data,start:"2026-11-14",end:"2026-11-30")
  precondition(shifted.count==1 && shiftedPlan.balance==200000 && shiftedForecast.automaticHistory.first?.key=="salary:2026-11-15" && shiftedForecast.automaticHistory.first?.date=="2026-11-13")
  let edited = try engine.updateBalance(data, amount: 250000, date: "2026-11-14")
  let editedForecast = try engine.forecast(edited, start:"2026-11-14", end:"2026-11-30")
  precondition(editedForecast.balance == 230000)
  do { _ = try engine.validate(Data("{}".utf8)); fatalError("Invalid document accepted") } catch {}
  let incomeInput:[String:Any] = ["section":"incomeSources","name":"Новая зарплата","amount":"100000","incomeType":"salary","repeat":"monthly","date":"2026-11-15","day":"10","advanceDay":"25","taxRate":"13","salaryShare":"60"]
  let withIncome=try engine.createEntry(data,input:incomeInput)
  let (_, addedIncome)=try engine.validate(withIncome)
  precondition(addedIncome.incomeSources.count==1 && addedIncome.incomeSources[0].amount==10000000 && addedIncome.incomeSources[0].advanceDay==25)
  for type in ["side","support","other"] {
   var source=incomeInput;source["incomeType"]=type;source["repeat"]="once"
   let (_, result)=try engine.validate(engine.createEntry(data,input:source))
   precondition(result.incomeSources.first?.incomeType==type && result.incomeSources.first?.taxRate==0 && result.incomeSources.first?.salaryShare==10000)
  }
  let expenseInput:[String:Any] = ["section":"expense","type":"regular","name":"Связь","amount":"","creditLimit":"","cardBalance":"","payments":[["repeat":"monthly","amount":"500","day":"31","date":""]]]
  let withExpense=try engine.createEntry(withIncome,input:expenseInput)
  let (_, addedExpense)=try engine.validate(withExpense)
  precondition(addedExpense.transactions.contains(where:{$0.name=="Связь" && $0.amount==50000 && $0.day==31}))
  for type in ["loan","mortgage","personal","card"] {
   let monthly = type == "loan" || type == "mortgage"
   let input:[String:Any] = ["section":"expense","type":type,"name":"Тест долга","amount":"2000","creditLimit":"5000","cardBalance":"3000","payments":[["repeat":monthly ? "monthly" : "once","amount":"500","day":monthly ? "20" : "","date":monthly ? "" : "2026-12-20"]]]
   let result=try engine.createEntry(data,input:input); let (_, added)=try engine.validate(result)
   precondition(added.debts.count==1 && added.debts[0].kind==type && added.transactions.count==2)
   precondition(added.transactions.contains(where:{$0.debtId==added.debts[0].id || $0.loanDebtId==added.debts[0].id}))
  }
  do { _=try engine.createEntry(data,input:["section":"incomeSources","name":"","amount":"1","incomeType":"other","repeat":"once","date":"2026-12-01"]);fatalError("Empty name accepted") } catch {}
  var badIncome=incomeInput;badIncome["taxRate"]="120"
  do { _=try engine.createEntry(data,input:badIncome);fatalError("Invalid tax accepted") } catch {}
  var badExpense=expenseInput;badExpense["payments"]=[["repeat":"monthly","amount":"10","day":"32","date":""]]
  do { _=try engine.createEntry(data,input:badExpense);fatalError("Invalid payment day accepted") } catch {}
  let splitLoan:[String:Any] = ["section":"expense","type":"loan","name":"Тест кредита","amount":"5000","creditLimit":"","cardBalance":"","payments":[["repeat":"once","amount":"1000","day":"","date":"2026-12-01"],["repeat":"once","amount":"2000","day":"","date":"2026-12-20"]]]
  let (_, splitPlan)=try engine.validate(engine.createEntry(data,input:splitLoan))
  precondition(splitPlan.debts.count==1 && splitPlan.transactions.filter({$0.loanDebtId==splitPlan.debts[0].id}).count==2)
  if CommandLine.arguments.count > 2 {
   let fixture=try Data(contentsOf:URL(fileURLWithPath:CommandLine.arguments[2]))
   let (validated, decoded)=try engine.validate(fixture)
   precondition(decoded.debts.count==4 && decoded.incomeSources.count==2)
   let changedIncome=try engine.updateEntry(validated,section:"incomeSources",id:"fiction-salary",name:"Новая зарплата",amount:"160000")
   let (_, incomePlan)=try engine.validate(changedIncome)
   precondition(incomePlan.incomeSources.first(where:{$0.id=="fiction-salary"})?.amount==16000000)
   let debt=decoded.debts.first(where:{$0.kind=="loan"})!
   let changedDebt=try engine.updateEntry(validated,section:"debts",id:debt.id,name:"Новый кредит",amount:"75000")
   let (_, debtPlan)=try engine.validate(changedDebt)
   precondition(debtPlan.debts.first(where:{$0.id==debt.id})?.amount==7500000)
   precondition(debtPlan.transactions.filter({$0.loanDebtId==debt.id}).allSatisfy({$0.name=="Новый кредит"}))
   let revisedSalary=try engine.updateEntry(validated,section:"incomeSources",id:"fiction-salary",name:"Новая зарплата",amount:"160000",details:["taxRate":"15","salaryShare":"70","day":"31","advanceDay":"16"])
   let (_, revisedSalaryPlan)=try engine.validate(revisedSalary); let salary=revisedSalaryPlan.incomeSources.first(where:{$0.id=="fiction-salary"})!
   precondition(salary.taxRate==1500 && salary.salaryShare==7000 && salary.salaryDay==31 && salary.advanceDay==16)
   let sideIncome=try engine.updateEntry(validated,section:"incomeSources",id:"fiction-salary",name:"Подработка",amount:"160000",details:["incomeType":"side"])
   let (_, sidePlan)=try engine.validate(sideIncome); let side=sidePlan.incomeSources.first(where:{$0.id=="fiction-salary"})!
   precondition(side.incomeType=="side" && side.taxRate==0 && side.salaryShare==10000 && side.advanceDate==nil)
   let salaryAgain=try engine.updateEntry(sideIncome,section:"incomeSources",id:"fiction-salary",name:"Зарплата",amount:"160000",details:["incomeType":"salary","taxRate":"13","salaryShare":"100"])
   let (_, salaryAgainPlan)=try engine.validate(salaryAgain);precondition(salaryAgainPlan.incomeSources.first(where:{$0.id=="fiction-salary"})?.incomeType=="salary")
   let regular=decoded.transactions.first(where:{$0.name=="Покупка (пример)"})!
   let recurring=try engine.updateEntry(validated,section:"transactions",id:regular.id,name:regular.name,amount:"4750",details:["repeat":"monthly","day":"31"])
   let (_, recurringPlan)=try engine.validate(recurring);let revised=recurringPlan.transactions.first(where:{$0.id==regular.id})!
   precondition(revised.repeatRule=="monthly" && revised.day==31)
   let monthlyExpense=decoded.transactions.first(where:{$0.name=="Интернет (пример)"})!
   let once=try engine.updateEntry(validated,section:"transactions",id:monthlyExpense.id,name:monthlyExpense.name,amount:"1600",details:["repeat":"once","date":"2026-12-20"])
   let (_, oncePlan)=try engine.validate(once); let onceEntry=oncePlan.transactions.first(where:{$0.id==monthlyExpense.id})!
   precondition(onceEntry.repeatRule=="once" && onceEntry.date=="2026-12-20")
   let cleared=try engine.updateEntry(validated,section:"transactions",id:regular.id,name:regular.name,amount:"4750",details:["clearDate":"true"])
   let (_, clearedPlan)=try engine.validate(cleared); precondition(clearedPlan.transactions.first(where:{$0.id==regular.id})?.draft==true)
   let done=decoded.transactions.first(where:{$0.id=="fiction-settled"})!
   do { _=try engine.updateEntry(validated,section:"transactions",id:done.id,name:done.name,amount:"1000",details:["clearDate":"true"]);fatalError("Completed event cleared") } catch {}
   let mortgage=decoded.debts.first(where:{$0.kind=="mortgage"})!
   let mortgagePayment=decoded.transactions.first(where:{$0.loanDebtId==mortgage.id})!
   do { _=try engine.updateEntry(validated,section:"transactions",id:mortgagePayment.id,name:mortgagePayment.name,amount:"42000",details:["repeat":"once","date":"2026-12-12"]);fatalError("One-time mortgage accepted") } catch {}
   let personal=decoded.transactions.first(where:{$0.debtId != nil})!
   do { _=try engine.updateEntry(validated,section:"transactions",id:personal.id,name:personal.name,amount:"1000",details:["repeat":"monthly","day":"10"]);fatalError("Recurring repayment accepted") } catch {}
   let card=decoded.debts.first(where:{$0.kind=="card"})!
   let editedCard=try engine.updateEntry(validated,section:"debts",id:card.id,name:card.name,amount:"",details:["creditLimit":"60000","cardBalance":"30000"])
   let (_, cardPlan)=try engine.validate(editedCard);precondition(cardPlan.debts.first(where:{$0.id==card.id})?.amount==3000000)
   let cardAsPersonal=try engine.updateEntry(validated,section:"debts",id:card.id,name:card.name,amount:"20000",details:["debtType":"personal"])
   let (_, personalPlan)=try engine.validate(cardAsPersonal)
   precondition(personalPlan.debts.first(where:{$0.id==card.id})?.kind=="personal")
   precondition(personalPlan.transactions.filter({$0.debtId==card.id}).count==decoded.transactions.filter({$0.debtId==card.id}).count)
   let restoredCard=try engine.updateEntry(cardAsPersonal,section:"debts",id:card.id,name:card.name,amount:"20000",details:["debtType":"card","creditLimit":"50000","cardBalance":"30000"])
   let (_, restoredPlan)=try engine.validate(restoredCard);precondition(restoredPlan.debts.first(where:{$0.id==card.id})?.kind=="card")
   do { _=try engine.updateEntry(cardAsPersonal,section:"debts",id:card.id,name:card.name,amount:"20000",details:["debtType":"card","creditLimit":"","cardBalance":""]);fatalError("Card conversion lost principal") } catch {}
   let loanAsMortgage=try engine.updateEntry(validated,section:"debts",id:debt.id,name:debt.name,amount:"80000",details:["debtType":"mortgage"])
   let (_, mortgagePlan)=try engine.validate(loanAsMortgage)
   precondition(mortgagePlan.debts.first(where:{$0.id==debt.id})?.kind=="mortgage" && mortgagePlan.transactions.contains(where:{$0.loanDebtId==debt.id}))
   do { _=try engine.updateEntry(validated,section:"debts",id:debt.id,name:debt.name,amount:"80000",details:["debtType":"personal"]);fatalError("Recurring repayment converted") } catch {}
   var history=try JSONSerialization.jsonObject(with:validated) as! [String:Any]
   let payment=decoded.transactions.first(where:{$0.debtId==card.id})!
   var completed=history["completed"] as! [String:Any]
   completed["\(payment.id):\(payment.date!)"]=["delta":0,"paidOn":"2026-11-14"]
   history["completed"]=completed
   let withHistory=try JSONSerialization.data(withJSONObject:history)
   do { _=try engine.updateEntry(withHistory,section:"debts",id:card.id,name:card.name,amount:"20000",details:["debtType":"personal"]);fatalError("Completed debt history converted") } catch {}
   var legacy=try JSONSerialization.jsonObject(with:validated) as! [String:Any]
   var legacyDebts=legacy["debts"] as! [[String:Any]], legacyTransactions=legacy["transactions"] as! [[String:Any]]
   let legacyDebtIndex=legacyDebts.firstIndex(where:{$0["id"] as? String == debt.id})!
   let legacyPaymentIndex=legacyTransactions.firstIndex(where:{$0["loanDebtId"] as? String == debt.id})!
   let legacyPaymentID=legacyTransactions[legacyPaymentIndex]["id"] as! String
   legacyDebts[legacyDebtIndex].removeValue(forKey:"explicitSchedule")
   legacyTransactions[legacyPaymentIndex].removeValue(forKey:"loanDebtId")
   legacy["debts"]=legacyDebts;legacy["transactions"]=legacyTransactions
   let legacyBytes=try JSONSerialization.data(withJSONObject:legacy)
   let migrated=try engine.updateEntry(legacyBytes,section:"debts",id:debt.id,name:debt.name,amount:"80000",details:["debtType":"mortgage"])
   let (_, migratedPlan)=try engine.validate(migrated)
   precondition(migratedPlan.transactions.contains(where:{$0.id==legacyPaymentID && $0.loanDebtId==debt.id}))

   do { _=try engine.updateEntry(validated,section:"debts",id:card.id,name:card.name,amount:"1"); fatalError("Card invariant not enforced") } catch {}
   let expense=decoded.transactions.first(where:{$0.name=="Покупка (пример)"})!
   let changedExpense=try engine.updateEntry(validated,section:"transactions",id:expense.id,name:"Покупка 2",amount:"1234.50")
   let (_, expensePlan)=try engine.validate(changedExpense)
   precondition(expensePlan.transactions.first(where:{$0.id==expense.id})?.amount==123450)

   let formatter=DateFormatter(); formatter.locale=Locale(identifier:"en_US_POSIX"); formatter.dateFormat="yyyy-MM-dd"
   let start=formatter.string(from:Date()), end=formatter.string(from:Calendar.current.date(byAdding:.day,value:30,to:Date())!)
   let result=try engine.forecast(validated,start:start,end:end)
   precondition(result.points.filter { $0.event != nil }.count>=6)
  }
  print("FinanceEngine validation, edit and forecast passed")
 }
}
