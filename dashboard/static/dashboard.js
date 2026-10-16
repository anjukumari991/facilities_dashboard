const COLORS={Lunch:"#00a94f","Kitchen Supplies":"#2f80ed","Office supplies":"#8a63d2","Car Rental, Taxi & Other":"#d97706",Rent:"#0f766e",Pantry:"#2f80ed",Miscellaneous:"#8a63d2",Fruits:"#f2a93b",Workspace:"#0f766e",Travel:"#d97706",Courier:"#64748b",Unclassified:"#9aa9a5",Other:"#9aa9a5"};
const MISC_COLORS={Stationery:"#f2a93b",Flowers:"#d9488c",Medicine:"#8a63d2",Medicines:"#8a63d2",Office:"#2f80ed","Meeting Room & Reception":"#00a94f","Sent to Emp":"#d97706","New Joiners":"#0f766e",Other:"#9aa9a5"};
const PIE_COLORS=["#00a94f","#2f80ed","#8a63d2","#f2a93b","#0f766e","#d97706","#d9485f","#64748b"];
const PLAN_YEAR_COLORS=["#087f52","#2f80ed","#8a63d2","#d97706","#d9485f","#0f766e","#b45309","#64748b"];
const COMPARISON_MONTHS=["Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar","Apr","May","Jun"];
const LUNCH_BUDGET=200;
const DEFAULT_USD_TO_INR_RATE=96;
const CURRENCY_STORAGE_KEY="facilities-dashboard-currency-preferences";
let payload={records:[],meta:{}};
let latestKnownMonth=null;
let libraryState={configured:false,files:[],selected_id:null};
let desktopReady=false;
let bootstrapped=false;
let currencyPreferencesLoaded=false;
let displayCurrency="INR";
let usdToInrRate=DEFAULT_USD_TO_INR_RATE;
const hiddenMonthlyPlanYears=new Set();
let localAiPollTimer=null;

const currencyLocale=()=>displayCurrency==="USD"?"en-US":"en-IN";
const convertedAmount=value=>displayCurrency==="USD"?Number(value)/usdToInrRate:Number(value);
const formatMoney=(value,precise=false)=>new Intl.NumberFormat(currencyLocale(),{
  style:"currency",
  currency:displayCurrency,
  currencyDisplay:"narrowSymbol",
  maximumFractionDigits:precise?(displayCurrency==="USD"?2:1):0,
}).format(convertedAmount(value));
const money={format:value=>formatMoney(value)};
const moneyOne={format:value=>formatMoney(value,true)};
const number=new Intl.NumberFormat("en-IN",{maximumFractionDigits:0});
const numberOne=new Intl.NumberFormat("en-IN",{maximumFractionDigits:1});
const pct=new Intl.NumberFormat("en-IN",{style:"percent",maximumFractionDigits:1});
const monthLabel=iso=>new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN",{month:"short",year:"numeric"});
const shortMonth=iso=>new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN",{month:"short"});
const compactMonth=iso=>new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN",{month:"short",year:"2-digit"});
const planYearStartForMonth=iso=>{
  const value=new Date(`${iso}T00:00:00Z`);
  return value.getUTCMonth()>=6?value.getUTCFullYear():value.getUTCFullYear()-1;
};
const planYearLabel=startYear=>`PY${String(startYear).slice(-2)}`;
const planYearRangeLabel=startYear=>`${planYearLabel(startYear)} (Jul ${startYear} – Jun ${startYear+1})`;
const sum=(rows,field)=>rows.reduce((total,row)=>total+(Number(row[field])||0),0);
const compact=value=>new Intl.NumberFormat(currencyLocale(),{style:"currency",currency:displayCurrency,currencyDisplay:"narrowSymbol",notation:"compact",maximumFractionDigits:1}).format(convertedAmount(value));
const esc=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const shorten=(text,length)=>text.length>length?`${text.slice(0,length-1)}…`:text;
const shiftMonth=(iso,delta)=>{
  const value=new Date(`${iso}T00:00:00Z`);
  value.setUTCMonth(value.getUTCMonth()+delta);
  return value.toISOString().slice(0,10);
};
const monthDistance=(start,end)=>{
  const first=new Date(`${start}T00:00:00Z`),last=new Date(`${end}T00:00:00Z`);
  return Math.max(0,(last.getUTCFullYear()-first.getUTCFullYear())*12+last.getUTCMonth()-first.getUTCMonth()+1);
};
const calendarMonths=(end,count)=>Array.from({length:Math.max(0,count)},(_,index)=>shiftMonth(end,index-count+1));
const selectedRows=(month,group)=>payload.records.filter(row=>row.month===month&&(group==="All"||row.report_category===group));
const reportCategories=()=>[...(payload.meta.report_categories||[])].sort((left,right)=>left===right?0:left==="Lunch"?-1:right==="Lunch"?1:left.localeCompare(right));
const categoryColor=category=>{
  if(COLORS[category])return COLORS[category];
  const hash=[...String(category||"")].reduce((value,char)=>((value*31)+char.charCodeAt(0))>>>0,0);
  return PIE_COLORS[hash%PIE_COLORS.length];
};
const planYearColor=index=>PLAN_YEAR_COLORS[index]||`hsl(${Math.round((index*137.508+155)%360)} 62% 42%)`;

function browserCurrencyPreferences(){
  try{
    const saved=JSON.parse(localStorage.getItem(CURRENCY_STORAGE_KEY)||"null");
    return saved&&typeof saved==="object"?saved:null;
  }catch(_error){return null;}
}

function applyCurrencyPreferences(preferences){
  if(preferences?.currency==="INR"||preferences?.currency==="USD")displayCurrency=preferences.currency;
  const rate=Number(preferences?.exchange_rate);
  if(Number.isFinite(rate)&&rate>0)usdToInrRate=rate;
}

function syncCurrencyControls(){
  document.querySelector("#currencyFilter").value=displayCurrency;
  document.querySelector("#exchangeRateInput").value=String(usdToInrRate);
  const workplaceCurrency=document.querySelector("#workplaceCurrencyFilter");
  const workplaceRate=document.querySelector("#workplaceExchangeRateInput");
  if(workplaceCurrency)workplaceCurrency.value=displayCurrency;
  if(workplaceRate)workplaceRate.value=String(usdToInrRate);
}

async function restoreCurrencyPreferences(api){
  if(currencyPreferencesLoaded)return;
  applyCurrencyPreferences(browserCurrencyPreferences());
  if(api&&typeof api.get_currency_preferences==="function"){
    try{applyCurrencyPreferences(await api.get_currency_preferences());}
    catch(error){setStatus(`Could not load currency preference: ${error.message||error}`);}
  }
  syncCurrencyControls();
  currencyPreferencesLoaded=true;
}

async function saveCurrencyPreferences(){
  const preferences={currency:displayCurrency,exchange_rate:usdToInrRate};
  try{localStorage.setItem(CURRENCY_STORAGE_KEY,JSON.stringify(preferences));}
  catch(_error){/* Desktop settings remain the source of truth. */}
  const api=window.pywebview?.api;
  if(api&&typeof api.set_currency_preferences==="function"){
    try{await api.set_currency_preferences(displayCurrency,usdToInrRate);}
    catch(error){setStatus(`Could not save currency preference: ${error.message||error}`);}
  }
}

async function loadData(message="Refreshing local workbook…"){
  setStatus(message);
  let response,result;
  try{
    response=await fetch("/api/data",{cache:"no-store"});
    result=await response.json();
  }catch(error){
    const detail=error.message||String(error);
    setStatus(`Workbook refresh failed: ${detail}`);
    throw error;
  }
  if(result.error){
    if(result.meta?.months?.length){
      payload=result;
      initialiseFilters();
      window.AuditReports?.render?.();
      render();
      setStatus(`Showing the last successfully loaded expense data. ${result.error}`);
      return payload;
    }
    clearDashboardData();
    setStatus(result.error);
    throw new Error(result.error);
  }
  payload=result;
  if(!payload.meta?.months?.length){clearDashboardData();throw new Error("This workbook has no valid expense rows to display.");}
  initialiseFilters();
  window.AuditReports?.render?.();
  render();
  const latest=payload.meta.months.at(-1);
  const source=payload.meta.source_relative_path||payload.meta.source_name;
  setStatus(`Loaded ${payload.meta.record_count} rows from ${source}${latest?` through ${monthLabel(latest)}`:""}`);
  return payload;
}

function setStatus(text){document.querySelector("#status").textContent=text;}

async function waitForDesktopApi(requiredMethod=null,timeoutMs=5000){
  const started=Date.now();
  while(Date.now()-started<timeoutMs){
    const api=window.pywebview?.api;
    if(api&&(!requiredMethod||typeof api[requiredMethod]==="function")){
      desktopReady=true;
      return api;
    }
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  return null;
}

function clearDashboardData(){
  payload={records:[],meta:{}};
  latestKnownMonth=null;
  ["kpis","bucketCards","monthlyTrendChart","monthlyTrendLegend","trendChart","trendLegend","varianceChart","vendorChart","miscChart","miscLegend","lunchChart","detailRows"].forEach(id=>{
    document.querySelector(`#${id}`).replaceChildren();
  });
  document.querySelector("#rowCount").textContent="";
  document.querySelector("#groupFilter").replaceChildren();
  document.querySelector("#monthFilter").replaceChildren();
}

function showSetup(title,message,buttonLabel="Choose base directory"){
  document.querySelector("#setupTitle").textContent=title;
  document.querySelector("#setupMessage").textContent=message;
  document.querySelector("#chooseFolderButton").textContent=buttonLabel;
  document.querySelector("#setupPanel").hidden=false;
  document.querySelector("#reportTabs").hidden=true;
  document.querySelector("#dashboardContent").hidden=true;
}

function showDashboard(){
  document.querySelector("#setupPanel").hidden=true;
  document.querySelector("#reportTabs").hidden=false;
  document.querySelector("#dashboardContent").hidden=false;
}

function populateWorkbookSelector(){
  const select=document.querySelector("#workbookFilter");
  select.replaceChildren();
  const groups=new Map();
  libraryState.files.forEach(file=>{
    if(!groups.has(file.group))groups.set(file.group,[]);
    groups.get(file.group).push(file);
  });
  groups.forEach((files,group)=>{
    const parent=document.createElement("optgroup");
    parent.label=group;
    files.forEach(file=>{
      const option=document.createElement("option");
      option.value=file.id;
      option.textContent=file.relative_path;
      option.selected=file.id===libraryState.selected_id;
      parent.append(option);
    });
    select.append(parent);
  });
}

async function refreshLibrary(){
  const response=await fetch("/api/library",{cache:"no-store"});
  libraryState=await response.json();
  if(!libraryState.configured){
    showSetup("Choose where your expense files are kept","Select a base directory once. The app will create an expenses folder inside it and remember your choice.");
    return false;
  }
  if(!libraryState.files.length){
    const checkedAt=new Date().toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    showDashboard();
    setStatus(`No expense workbooks found in ${libraryState.expenses_dir} as of ${checkedAt}. Other report tabs remain available.`);
    return true;
  }
  populateWorkbookSelector();
  showDashboard();
  return true;
}

async function loadAllDashboardData(expenseMessage){
  const surveyTask=window.SurveyDashboard?.isBusy?.()?null:window.SurveyDashboard?.load?.();
  const tasks=[surveyTask,window.WorkplaceDashboard?.load?.(),window.CollaborationDashboard?.load?.(),window.AuditReports?.load?.()];
  if(libraryState.selected_id)tasks.unshift(loadData(expenseMessage));
  return Promise.allSettled(tasks.filter(Boolean));
}

async function chooseBaseDirectory(triggerButton=document.querySelector("#chooseFolderButton")){
  const button=triggerButton;
  const originalLabel=button.textContent;
  button.disabled=true;
  button.textContent="Opening folder picker…";
  try{
    const api=await waitForDesktopApi("choose_base_directory");
    if(!api){
      showSetup("Desktop connection unavailable","The native pywebview bridge did not load. Close the application completely and start it again.");
      return false;
    }
    let result;
    try{result=await api.choose_base_directory();}
    catch(error){
      showSetup("Could not open the folder picker",error.message||String(error));
      return false;
    }
    if(result.error){
      showSetup("Could not use that directory",result.error);
      return false;
    }
    libraryState=result;
    const ready=await refreshLibrary();
    await loadSettingsState();
    if(ready){
      try{
        await loadAllDashboardData("Loading selected workbook…");
      }
      catch(error){setStatus(error.message);}
    }
    return ready;
  }finally{
    button.disabled=false;
    button.textContent=originalLabel;
  }
}

async function bootstrap(){
  if(bootstrapped)return;
  bootstrapped=true;
  try{
    const api=await waitForDesktopApi("choose_base_directory",5000);
    await restoreCurrencyPreferences(api);
    const ready=await refreshLibrary();
    if(!libraryState.configured&&api){
      await chooseBaseDirectory();
      return;
    }
    if(ready){
      try{
        await loadAllDashboardData("Loading selected workbook…");
      }
      catch(error){setStatus(error.message);}
    }
  }catch(error){
    showSetup("Dashboard could not start",error.message);
  }
}

function initialiseFilters(){
  const group=document.querySelector("#groupFilter");
  const month=document.querySelector("#monthFilter");
  const lookback=document.querySelector("#lookbackFilter");
  const oldGroup=group.value;
  const oldMonth=month.value;
  const oldLookback=lookback.value||"3";
  const wasShowingLatest=!oldMonth||oldMonth===latestKnownMonth;
  const categories=reportCategories();
  group.innerHTML=["All",...categories].map(value=>`<option value="${esc(value)}">${value==="All"?"All categories":esc(value)}</option>`).join("");
  month.innerHTML=[...payload.meta.months].reverse().map(value=>`<option value="${value}">${monthLabel(value)}</option>`).join("");
  const planYears=[...new Set(payload.meta.months.map(planYearStartForMonth))].sort((a,b)=>b-a);
  lookback.innerHTML=`<optgroup label="Rolling period"><option value="3">3 months</option><option value="6">6 months</option><option value="12">12 months</option><option value="999">All available</option></optgroup>${planYears.length?`<optgroup label="Plan year">${planYears.map(startYear=>`<option value="py:${startYear}">${planYearRangeLabel(startYear)}</option>`).join("")}</optgroup>`:""}`;
  if([...group.options].some(option=>option.value===oldGroup))group.value=oldGroup;
  if(!wasShowingLatest&&[...month.options].some(option=>option.value===oldMonth))month.value=oldMonth;
  else if(payload.meta.months.length)month.value=payload.meta.months.at(-1);
  if([...lookback.options].some(option=>option.value===oldLookback))lookback.value=oldLookback;
  else lookback.value="3";
  latestKnownMonth=payload.meta.months.at(-1)||null;
  updatePeriodControls();
}

function updatePeriodControls(){
  const usesPlanYear=document.querySelector("#lookbackFilter").value.startsWith("py:");
  const month=document.querySelector("#monthFilter");
  month.disabled=usesPlanYear;
  month.title=usesPlanYear?"The selected plan year defines the date range.":"";
}

function filtered(){
  const group=document.querySelector("#groupFilter").value;
  const period=document.querySelector("#lookbackFilter").value;
  let end=document.querySelector("#monthFilter").value;
  let months=[];
  let selectedPlanYear=null;
  if(period.startsWith("py:")){
    const startYear=Number(period.slice(3));
    const planStart=`${startYear}-07-01`;
    const planEnd=`${startYear+1}-06-01`;
    const effectiveStart=planStart>payload.meta.months[0]?planStart:payload.meta.months[0];
    end=planEnd<payload.meta.months.at(-1)?planEnd:payload.meta.months.at(-1);
    if(effectiveStart<=end)months=calendarMonths(end,monthDistance(effectiveStart,end));
    selectedPlanYear=planYearLabel(startYear);
  }else{
    const lookback=Number(period);
    const availableSpan=monthDistance(payload.meta.months[0],end);
    const monthCount=lookback===999?availableSpan:Math.min(lookback,availableSpan);
    months=calendarMonths(end,monthCount);
  }
  const rows=payload.records.filter(row=>months.includes(row.month)&&(group==="All"||row.report_category===group));
  const previousMonth=shiftMonth(end,-1);
  return {group,end,months,rows,selectedPlanYear,previousMonth:previousMonth>=payload.meta.months[0]?previousMonth:null};
}

function render(){
  const view=filtered();
  document.querySelector("#trendCurrencyDescription").textContent=`Stacked monthly spend in ${displayCurrency}; totals appear above each month.`;
  document.querySelector("#lunchBudgetPill").textContent=`Budget ${money.format(LUNCH_BUDGET)}`;
  renderKpis(view);
  renderBuckets(view);
  renderMonthlyTrend(view);
  renderTrend(view);
  renderVariance(view);
  renderVendors(view);
  renderMisc(view);
  renderLunch(view);
  renderTable(view);
}

function renderKpis(view){
  const latest=selectedRows(view.end,view.group);
  const previous=view.previousMonth?selectedRows(view.previousMonth,view.group):[];
  const currentTotal=sum(latest,"amount_inr");
  const previousTotal=sum(previous,"amount_inr");
  const windowTotal=sum(view.rows,"amount_inr");
  const average=view.months.length?windowTotal/view.months.length:0;
  const change=previous.length&&previousTotal?(currentTotal-previousTotal)/previousTotal:null;
  const showLunch=view.group==="All"||view.group==="Lunch";
  const lunch=showLunch?payload.records.filter(row=>row.month===view.end&&row.report_category==="Lunch"):[];
  const meals=sum(lunch,"actual_count");
  const mealCost=meals?sum(lunch,"amount_inr")/meals:null;
  const vendorTotals={};
  latest.forEach(row=>vendorTotals[row.vendor]=(vendorTotals[row.vendor]||0)+row.amount_inr);
  const topVendor=Object.entries(vendorTotals).sort((a,b)=>b[1]-a[1])[0];
  const concentration=topVendor&&currentTotal?topVendor[1]/currentTotal:null;
  const scope=view.group==="All"?"All categories":view.group;
  const periodSpendLabel=view.selectedPlanYear?`${view.selectedPlanYear} spend`:`${view.months.length}-month spend`;
  const averageNote=view.selectedPlanYear?`Across ${view.months.length} loaded months in ${view.selectedPlanYear}`:`Across ${view.months.length} selected months`;
  const lunchBudgetNote=!showLunch?"Available for Lunch or All categories":mealCost===null?"No lunch activity":mealCost===LUNCH_BUDGET?`On the ${money.format(LUNCH_BUDGET)} budget · ${number.format(meals)} actual count`:`${moneyOne.format(Math.abs(mealCost-LUNCH_BUDGET))} ${mealCost>LUNCH_BUDGET?'above':'below'} ${money.format(LUNCH_BUDGET)} budget · ${number.format(meals)} actual count`;
  const cards=[
    ["Latest-month spend",money.format(currentTotal),`${monthLabel(view.end)} · ${scope}`,"#00a94f"],
    [periodSpendLabel,money.format(windowTotal),`${monthLabel(view.months[0])} to ${monthLabel(view.months.at(-1))}`,"#0b5a4d"],
    ["Average per month",money.format(average),averageNote,"#2f80ed"],
    ["Month-on-month",change===null?"—":`${change>=0?"+":""}${pct.format(change)}`,change===null?"No prior-month data":`${money.format(currentTotal-previousTotal)} vs ${monthLabel(view.previousMonth)}`,change>0?"#d9485f":"#00a94f",change===null?"":change>0?"unfavourable":"favourable"],
    ["Lunch cost / person",mealCost===null?"—":moneyOne.format(mealCost),lunchBudgetNote,mealCost!==null&&mealCost>LUNCH_BUDGET?"#d9485f":"#00a94f",mealCost===null?"":mealCost>LUNCH_BUDGET?"unfavourable":"favourable"],
    ["Top-vendor share",concentration===null?"—":pct.format(concentration),topVendor?`${topVendor[0]} · ${money.format(topVendor[1])}`:"No vendor activity","#f2a93b"],
  ];
  document.querySelector("#kpis").innerHTML=cards.map(([label,value,note,color,state])=>`<article class="kpi" style="--accent:${color}"><div class="kpi-label">${label}</div><div class="kpi-value ${state||""}">${value}</div><div class="kpi-note">${esc(note)}</div></article>`).join("");
}

function renderBuckets(view){
  const months=calendarMonths(view.end,Math.min(3,monthDistance(payload.meta.months[0],view.end)));
  const previousMonth=months.length>1?months.at(-2):null;
  document.querySelector("#bucketCards").innerHTML=reportCategories().map(category=>{
    const values=months.map(month=>sum(payload.records.filter(row=>row.month===month&&row.report_category===category),"amount_inr"));
    const latest=values.at(-1)||0;
    const previous=values.at(-2)||0;
    const threeMonthTotal=values.reduce((a,b)=>a+b,0);
    const movement=previous?(latest-previous)/previous:null;
    const color=categoryColor(category);
    const movementClass=movement===null?"neutral":movement>0?"up":"down";
    const movementText=movement===null?"No comparison":`${movement>=0?"▲":"▼"} ${pct.format(Math.abs(movement))} vs ${shortMonth(previousMonth)}`;
    return `<article class="bucket-card"><div class="bucket-head"><div class="bucket-name">${category}</div><i class="bucket-dot" style="background:${color}"></i></div><div class="bucket-total">${money.format(latest)}</div><div class="bucket-sub"><span>Latest month</span><b class="movement ${movementClass}">${movementText}</b></div><div class="bucket-months">${months.map((month,index)=>`<div><span>${shortMonth(month)}</span><b>${compact(values[index])}</b><i style="height:${Math.max(4,values[index]/Math.max(1,...values)*34)}px;background:${color}"></i></div>`).join("")}</div><div class="bucket-total-line"><span>Three-month total</span><b>${money.format(threeMonthTotal)}</b></div></article>`;
  }).join("");
}

function renderMonthlyTrend(view){
  const chart=document.querySelector("#monthlyTrendChart");
  const legend=document.querySelector("#monthlyTrendLegend");
  const categoryRows=payload.records.filter(row=>view.group==="All"||row.report_category===view.group);
  const rowsByMonth=new Map();
  categoryRows.forEach(row=>{
    if(!rowsByMonth.has(row.month))rowsByMonth.set(row.month,[]);
    rowsByMonth.get(row.month).push(row);
  });
  const startYears=[...new Set(categoryRows.map(row=>planYearStartForMonth(row.month)))].sort((left,right)=>left-right);
  if(!startYears.length){
    chart.innerHTML='<div class="empty">No monthly data is available</div>';
    legend.innerHTML="";
    return;
  }
  const availableLabels=new Set(startYears.map(planYearLabel));
  [...hiddenMonthlyPlanYears].forEach(label=>{
    if(!availableLabels.has(label))hiddenMonthlyPlanYears.delete(label);
  });
  const series=startYears.map((startYear,seriesIndex)=>{
    const months=Array.from({length:12},(_,monthIndex)=>{
      const calendarMonth=(monthIndex+6)%12;
      const calendarYear=startYear+(monthIndex>=6?1:0);
      const iso=`${calendarYear}-${String(calendarMonth+1).padStart(2,"0")}-01`;
      const rows=rowsByMonth.get(iso);
      if(!rows?.length)return null;
      const counts=rows
        .filter(row=>row.actual_count!=null&&Number.isFinite(Number(row.actual_count)))
        .map(row=>Number(row.actual_count));
      return {
        iso,
        value:sum(rows,"amount_inr"),
        totalCount:counts.length?counts.reduce((total,value)=>total+value,0):null,
      };
    });
    const plotted=months.filter(Boolean);
    return {
      startYear,
      label:planYearLabel(startYear),
      color:planYearColor(seriesIndex),
      months,
      average:plotted.length?plotted.reduce((total,month)=>total+month.value,0)/plotted.length:null,
    };
  });
  const visibleSeries=series.filter(item=>!hiddenMonthlyPlanYears.has(item.label));
  const visibleValues=visibleSeries.flatMap(item=>[
    ...item.months.filter(Boolean).map(month=>month.value),
    ...(item.average==null?[]:[item.average]),
  ]);
  const max=Math.max(1,...visibleValues)*1.12;
  const W=920,H=270,p={l:82,r:24,t:18,b:54},plotW=W-p.l-p.r,plotH=H-p.t-p.b;
  const x=index=>p.l+index*plotW/(COMPARISON_MONTHS.length-1);
  const y=value=>p.t+plotH-value/max*plotH;
  let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly spend comparison by plan year for ${esc(view.group==="All"?"all categories":view.group)}">`;
  for(let index=0;index<=4;index++){
    const value=max*index/4,axisY=p.t+plotH-index*plotH/4;
    svg+=`<line class="gridline" x1="${p.l}" x2="${W-p.r}" y1="${axisY}" y2="${axisY}"/><text class="axis-label" x="${p.l-10}" y="${axisY+4}" text-anchor="end">${compact(value)}</text>`;
  }
  svg+=`<text class="axis-title" x="16" y="${p.t+plotH/2}" text-anchor="middle" transform="rotate(-90 16 ${p.t+plotH/2})">Amount (${displayCurrency})</text>`;
  COMPARISON_MONTHS.forEach((month,index)=>{
    svg+=`<text class="axis-label" x="${x(index)}" y="${H-27}" text-anchor="middle">${month}</text>`;
  });
  svg+=`<text class="axis-title" x="${p.l+plotW/2}" y="${H-5}" text-anchor="middle">Month</text>`;
  visibleSeries.forEach(item=>{
    if(item.average!=null){
      const averageY=y(item.average);
      svg+=`<line class="monthly-average-line" style="stroke:${item.color}" x1="${p.l}" x2="${W-p.r}" y1="${averageY}" y2="${averageY}"><title>${esc(item.label)} monthly average: ${esc(money.format(item.average))}</title></line>`;
    }
    let path="",continues=false;
    item.months.forEach((month,index)=>{
      if(!month){continues=false;return;}
      path+=`${continues?" L":" M"}${x(index)} ${y(month.value)}`;
      continues=true;
    });
    if(path)svg+=`<path class="monthly-trend-line" style="stroke:${item.color}" d="${path.trim()}"/>`;
    item.months.forEach((month,index)=>{
      if(!month)return;
      const totalCount=month.totalCount;
      const costPerPerson=totalCount?month.value/totalCount:null;
      const countText=totalCount==null?"Not recorded":numberOne.format(totalCount);
      const costText=costPerPerson==null?"Not available":moneyOne.format(costPerPerson);
      const accessibleLabel=`${monthLabel(month.iso)}, ${item.label}. Spend ${money.format(month.value)}. Total count ${countText}. Spend per person ${costText}.`;
      svg+=`<circle class="monthly-trend-point chart-tooltip-target" style="--point-color:${item.color}" cx="${x(index)}" cy="${y(month.value)}" r="5" tabindex="0" role="img" aria-label="${esc(accessibleLabel)}" data-chart-tooltip data-tooltip-title="${esc(`${monthLabel(month.iso)} · ${item.label}`)}" data-tooltip-line-one="Spend: ${esc(money.format(month.value))}" data-tooltip-line-two="Total count: ${esc(countText)}" data-tooltip-line-three="Spend / person: ${esc(costText)}"><title>${esc(accessibleLabel)}</title></circle>`;
    });
  });
  if(!visibleSeries.length)svg+=`<text class="monthly-empty-selection" x="${p.l+plotW/2}" y="${p.t+plotH/2}" text-anchor="middle">Select a plan year from the legend</text>`;
  svg+="</svg>";
  chart.innerHTML=svg;
  legend.innerHTML=series.map(item=>{
    const hidden=hiddenMonthlyPlanYears.has(item.label);
    const averageText=item.average==null?"No data":`Avg ${money.format(item.average)}`;
    return `<button type="button" class="monthly-series-toggle${hidden?" is-hidden":""}" data-plan-year="${esc(item.label)}" aria-pressed="${hidden?"false":"true"}" title="${hidden?"Show":"Hide"} ${esc(item.label)}"><span class="monthly-series-swatch" style="--series-color:${item.color}"><i></i><i></i></span><span>${esc(item.label)}</span><small>${esc(averageText)}</small></button>`;
  }).join("");
}

function cloneExpandedMonthlyTrend(){
  const sourcePanel=document.querySelector("#monthlyTrendChart")?.closest(".chart-panel");
  if(!sourcePanel)return null;
  const clone=sourcePanel.cloneNode(true);
  clone.querySelectorAll(".expand-chart-button").forEach(button=>button.remove());
  clone.querySelectorAll("[id]").forEach(element=>element.removeAttribute("id"));
  return clone;
}

function chartDataTooltip(){
  let tooltip=document.querySelector("#chartDataTooltip");
  if(tooltip)return tooltip;
  tooltip=document.createElement("div");
  tooltip.id="chartDataTooltip";
  tooltip.className="chart-data-tooltip";
  tooltip.hidden=true;
  tooltip.setAttribute("role","tooltip");
  document.body.append(tooltip);
  return tooltip;
}

function positionChartTooltip(tooltip,target,event){
  const box=target.getBoundingClientRect();
  const anchorX=event?.clientX||box.left+box.width/2;
  const anchorY=event?.clientY||box.top;
  const margin=10;
  const width=tooltip.offsetWidth;
  const height=tooltip.offsetHeight;
  tooltip.style.left=`${Math.max(margin,Math.min(window.innerWidth-width-margin,anchorX-width/2))}px`;
  tooltip.style.top=`${anchorY-height-14<margin?anchorY+14:anchorY-height-14}px`;
}

function showChartTooltip(target,event){
  const tooltip=chartDataTooltip();
  const tooltipHost=target.closest("dialog")||document.body;
  if(tooltip.parentElement!==tooltipHost)tooltipHost.append(tooltip);
  const title=document.createElement("strong");
  title.textContent=target.dataset.tooltipTitle||"Details";
  let details=[];
  if(target.dataset.tooltipLines){
    try{
      const parsed=JSON.parse(target.dataset.tooltipLines);
      if(Array.isArray(parsed))details=parsed.filter(value=>typeof value==="string"&&value);
    }catch(_error){/* Fall back to the individual tooltip lines below. */}
  }
  if(!details.length)details=[target.dataset.tooltipLineOne,target.dataset.tooltipLineTwo,target.dataset.tooltipLineThree].filter(Boolean);
  const lines=details.map(text=>{
    const line=document.createElement("span");
    line.textContent=text;
    return line;
  });
  tooltip.replaceChildren(title,...lines);
  tooltip.hidden=false;
  positionChartTooltip(tooltip,target,event);
}

function hideChartTooltip(){
  const tooltip=document.querySelector("#chartDataTooltip");
  if(tooltip)tooltip.hidden=true;
}

function initialiseChartTooltips(){
  document.addEventListener("pointerover",event=>{
    const target=event.target.closest?.("[data-chart-tooltip]");
    if(target)showChartTooltip(target,event);
  });
  document.addEventListener("pointermove",event=>{
    const target=event.target.closest?.("[data-chart-tooltip]");
    const tooltip=document.querySelector("#chartDataTooltip");
    if(target&&tooltip&&!tooltip.hidden)positionChartTooltip(tooltip,target,event);
  });
  document.addEventListener("pointerout",event=>{
    const target=event.target.closest?.("[data-chart-tooltip]");
    const tooltip=document.querySelector("#chartDataTooltip");
    if(target&&!target.contains(event.relatedTarget)&&!tooltip?.contains(event.relatedTarget))hideChartTooltip();
    if(event.target.closest?.("#chartDataTooltip")&&!tooltip?.contains(event.relatedTarget))hideChartTooltip();
  });
  document.addEventListener("focusin",event=>{
    const target=event.target.closest?.("[data-chart-tooltip]");
    if(target)showChartTooltip(target);
  });
  document.addEventListener("focusout",event=>{
    if(event.target.closest?.("[data-chart-tooltip]"))hideChartTooltip();
  });
  document.addEventListener("click",event=>{
    const target=event.target.closest?.("[data-chart-tooltip]");
    if(target){
      event.stopPropagation();
      showChartTooltip(target,event);
    }else hideChartTooltip();
  });
  window.addEventListener("resize",hideChartTooltip);
  window.addEventListener("scroll",hideChartTooltip,true);
}

function pieChartMarkup(categories,ariaLabel){
  const total=categories.reduce((sumValue,[,value])=>sumValue+value,0);
  if(!total)return "";

  const W=220,H=220,cx=110,cy=110,r=94;
  let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(ariaLabel)}">`;
  let startAngle=-Math.PI/2;
  categories.forEach(([category,value],index)=>{
    const share=value/total;
    const endAngle=startAngle+share*Math.PI*2;
    const color=MISC_COLORS[category]||PIE_COLORS[index%PIE_COLORS.length];
    if(categories.length===1){
      svg+=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"><title>${esc(category)}: ${money.format(value)} (${pct.format(share)})</title></circle>`;
    }else{
      const x1=cx+r*Math.cos(startAngle),y1=cy+r*Math.sin(startAngle);
      const x2=cx+r*Math.cos(endAngle),y2=cy+r*Math.sin(endAngle);
      const largeArc=share>.5?1:0;
      svg+=`<path d="M${cx} ${cy} L${x1} ${y1} A${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z" fill="${color}"><title>${esc(category)}: ${money.format(value)} (${pct.format(share)})</title></path>`;
    }
    if(share>=.08){
      const labelAngle=startAngle+share*Math.PI;
      const labelRadius=r*.62;
      svg+=`<text class="pie-label" x="${cx+labelRadius*Math.cos(labelAngle)}" y="${cy+labelRadius*Math.sin(labelAngle)+3}">${pct.format(share)}</text>`;
    }
    startAngle=endAngle;
  });
  svg+="</svg>";
  const legend=`<div class="pie-legend">${categories.map(([category,value],index)=>{
    const color=MISC_COLORS[category]||PIE_COLORS[index%PIE_COLORS.length];
    return `<div class="pie-legend-row"><i style="background:${color}"></i><span title="${esc(category)}">${esc(category)}</span><b>${money.format(value)}<small>${pct.format(value/total)}</small></b></div>`;
  }).join("")}</div>`;
  return `<div class="pie-layout">${svg}${legend}</div>`;
}

function renderTrend(view){
  const groups=reportCategories().filter(group=>view.rows.some(row=>row.report_category===group));
  const series=view.months.map(month=>({
    month,
    values:Object.fromEntries(groups.map(group=>[group,sum(view.rows.filter(row=>row.month===month&&row.report_category===group),"amount_inr")])),
    expenseTypes:Object.fromEntries(groups.map(group=>[
      group,
      [...new Set(view.rows
        .filter(row=>row.month===month&&row.report_category===group)
        .map(row=>String(row.category||"").trim())
        .filter(Boolean))].sort((left,right)=>left.localeCompare(right)),
    ])),
  }));
  const totals=series.map(item=>Object.values(item.values).reduce((a,b)=>a+b,0));
  const max=Math.max(1,...totals)*1.14;
  const W=850,H=325,p={l:65,r:18,t:30,b:52};
  const plotW=W-p.l-p.r,plotH=H-p.t-p.b;
  const barW=Math.min(78,plotW/Math.max(series.length,1)*0.56);
  let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Stacked monthly expenditure by category">`;
  for(let i=0;i<=4;i++){
    const value=max*i/4,y=p.t+plotH-i*plotH/4;
    svg+=`<line class="gridline" x1="${p.l}" x2="${W-p.r}" y1="${y}" y2="${y}"/><text class="axis-label" x="${p.l-9}" y="${y+4}" text-anchor="end">${compact(value)}</text>`;
  }
  series.forEach((item,index)=>{
    const x=p.l+(index+0.5)*plotW/series.length-barW/2;
    let base=p.t+plotH;
    groups.forEach(group=>{
      const value=item.values[group]||0;
      const height=value/max*plotH;
      base-=height;
      const expenseTypes=item.expenseTypes[group]||[];
      const expenseTypeText=expenseTypes.length?expenseTypes.join(", "):"Not specified";
      const tooltipLines=[`Amount: ${money.format(value)}`,`Expense types: ${expenseTypeText}`,`Month: ${monthLabel(item.month)}`];
      const accessibleLabel=`${group}. ${tooltipLines.join(". ")}`;
      svg+=`<rect class="chart-tooltip-target" x="${x}" y="${base}" width="${barW}" height="${Math.max(0,height)}" fill="${categoryColor(group)}" tabindex="0" role="img" aria-label="${esc(accessibleLabel)}" data-chart-tooltip data-tooltip-title="${esc(group)}" data-tooltip-lines="${esc(JSON.stringify(tooltipLines))}"><title>${esc(accessibleLabel)}</title></rect>`;
      if(height>25&&value>0)svg+=`<text class="segment-label" x="${x+barW/2}" y="${base+height/2+4}" text-anchor="middle">${compact(value)}</text>`;
    });
    const totalLabel=series.length>6?compact(totals[index]):money.format(totals[index]);
    const periodLabel=series.length>6?compactMonth(item.month):monthLabel(item.month);
    svg+=`<text class="total-label" x="${x+barW/2}" y="${Math.max(16,base-8)}" text-anchor="middle">${totalLabel}</text><text class="axis-label" x="${x+barW/2}" y="${H-20}" text-anchor="middle">${periodLabel}</text>`;
  });
  svg+="</svg>";
  document.querySelector("#trendChart").innerHTML=series.length?svg:'<div class="empty">No data for this selection</div>';
  document.querySelector("#trendLegend").innerHTML=groups.map(group=>`<span><i style="background:${categoryColor(group)}"></i>${esc(group)}</span>`).join("");
}

function renderVariance(view){
  if(!view.previousMonth){document.querySelector("#varianceChart").innerHTML='<div class="empty">No prior month available</div>';return;}
  const categories=reportCategories().filter(category=>view.group==="All"||view.group===category);
  const rows=categories.map(category=>{
    const current=sum(payload.records.filter(row=>row.month===view.end&&row.report_category===category),"amount_inr");
    const previous=sum(payload.records.filter(row=>row.month===view.previousMonth&&row.report_category===category),"amount_inr");
    return {category,current,previous,delta:current-previous};
  }).filter(row=>row.current||row.previous);
  if(!rows.length){document.querySelector("#varianceChart").innerHTML='<div class="empty">No activity in either comparison month</div>';return;}
  const maxAbs=Math.max(1,...rows.map(row=>Math.abs(row.delta)));
  const W=510,H=270,p={l:112,r:104,t:18,b:36},plotW=W-p.l-p.r,rowH=(H-p.t-p.b)/rows.length;
  let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Magnitude and direction of spend change by category versus previous month">`;
  rows.forEach((row,index)=>{
    const y=p.t+index*rowH+8;
    const width=Math.abs(row.delta)/maxAbs*plotW;
    const color=row.delta>0?"#d9485f":row.delta<0?"#00a94f":"#9aa9a5";
    svg+=`<text class="bar-label" x="${p.l-10}" y="${y+15}" text-anchor="end">${esc(shorten(row.category,16))}</text><rect x="${p.l}" y="${y}" width="${Math.max(width,2)}" height="21" rx="4" fill="${color}"><title>${row.category}: ${row.delta>0?'+':''}${money.format(row.delta)}</title></rect><text class="variance-label" x="${W-p.r+10}" y="${y+15}">${row.delta>0?'+':''}${money.format(row.delta)}</text>`;
  });
  svg+=`<text class="axis-label" x="${p.l}" y="${H-10}">Bar length = size of change</text><text class="axis-label" x="${W-p.r+10}" y="${H-10}">Signed change</text></svg>`;
  const currentTotal=rows.reduce((total,row)=>total+row.current,0);
  const priorTotal=rows.reduce((total,row)=>total+row.previous,0);
  const net=currentTotal-priorTotal;
  const direction=net===0?"No net change":`${net>0?'Spend increased':'Spend decreased'} ${money.format(Math.abs(net))}`;
  document.querySelector("#varianceChart").innerHTML=`${svg}<div class="chart-callout ${net>0?'bad':net<0?'good':'neutral'}"><b>${direction}</b><span>${monthLabel(view.end)} versus ${monthLabel(view.previousMonth)}</span></div>`;
}

function renderVendors(view){
  const latest=view.rows.filter(row=>row.month===view.end);
  const total=sum(latest,"amount_inr");
  const map=Object.create(null);
  latest.forEach(row=>{
    const vendor=row.vendor||"Unspecified";
    const expenseType=row.report_category==="Lunch"?"Lunch":row.category||row.report_category||"Other";
    if(!map[vendor])map[vendor]={vendor,total:0,types:Object.create(null),categories:new Set()};
    map[vendor].total+=Number(row.amount_inr)||0;
    map[vendor].types[expenseType]=(map[vendor].types[expenseType]||0)+(Number(row.amount_inr)||0);
    map[vendor].categories.add(row.report_category||"Other");
  });
  const rows=Object.values(map).sort((a,b)=>b.total-a.total).slice(0,6);
  const expenseTypes=[...new Set(rows.flatMap(row=>Object.keys(row.types)))].sort();
  const typeColors=Object.fromEntries(expenseTypes.map((type,index)=>[type,MISC_COLORS[type]||COLORS[type]||PIE_COLORS[index%PIE_COLORS.length]]));
  const max=Math.max(1,...rows.map(row=>row.total));
  const W=680,H=305,p={l:190,r:145,t:8,b:14},rowH=(H-p.t-p.b)/Math.max(rows.length,1);
  const plotW=W-p.l-p.r;
  let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Top vendor spend in latest month, segmented by expense type">`;
  rows.forEach((row,index)=>{
    const y=p.t+index*rowH+6,totalWidth=plotW*row.total/max;
    let cursor=p.l;
    const categoryNames=[...row.categories].sort((a,b)=>a.localeCompare(b)).join(" · ");
    const vendorLabel=`${row.vendor}. Category: ${categoryNames}.`;
    svg+=`<text class="bar-label" x="${p.l-12}" y="${y+10}" text-anchor="end" role="img" aria-label="${esc(vendorLabel)}"><title>${esc(vendorLabel)}</title><tspan x="${p.l-12}">${esc(shorten(row.vendor,27))}</tspan><tspan class="vendor-category-label" x="${p.l-12}" dy="14">${esc(shorten(categoryNames,30))}</tspan></text>`;
    Object.entries(row.types).sort((a,b)=>b[1]-a[1]).forEach(([expenseType,value])=>{
      const width=plotW*value/max;
      const vendorShare=row.total?value/row.total:0;
      const accessibleLabel=`${row.vendor}. ${expenseType}. ${money.format(value)}. ${pct.format(vendorShare)} of vendor spend.`;
      svg+=`<rect class="vendor-segment chart-tooltip-target" x="${cursor}" y="${y}" width="${Math.max(.8,width)}" height="22" rx="3" fill="${typeColors[expenseType]}" tabindex="0" role="img" aria-label="${esc(accessibleLabel)}" data-chart-tooltip data-tooltip-title="${esc(expenseType)}" data-tooltip-line-one="Vendor: ${esc(row.vendor)}" data-tooltip-line-two="Value: ${esc(money.format(value))}" data-tooltip-line-three="${esc(pct.format(vendorShare))} of this vendor's spend"><title>${esc(accessibleLabel)}</title></rect>`;
      cursor+=width;
    });
    svg+=`<text class="value-label" x="${p.l+totalWidth+9}" y="${y+16}">${compact(row.total)} · ${total?pct.format(row.total/total):'—'}</text>`;
  });
  svg+="</svg>";
  document.querySelector("#vendorChart").innerHTML=rows.length?svg:'<div class="empty">No vendor activity</div>';
}

function renderMisc(view){
  const chart=document.querySelector("#miscChart");
  const legend=document.querySelector("#miscLegend");
  if(view.group==="Lunch"){
    legend.innerHTML="";
    chart.innerHTML='<div class="empty">Select a non-Lunch category or All categories to view expense types</div>';
    return;
  }
  const rows=view.rows.filter(row=>row.report_category!=="Lunch");
  if(!rows.length){
    legend.innerHTML="";
    chart.innerHTML='<div class="empty">No expense-type data for this period</div>';
    return;
  }
  const totals={};
  rows.forEach(row=>totals[row.category]=(totals[row.category]||0)+(Number(row.amount_inr)||0));
  const categories=Object.entries(totals).filter(([,value])=>value>0).sort((a,b)=>b[1]-a[1]);
  legend.innerHTML="";
  chart.innerHTML=pieChartMarkup(categories,"Spend share by expense type for the selected period");
}

function renderLunch(view){
  if(view.group!=="All"&&view.group!=="Lunch"){
    document.querySelector("#lunchChart").innerHTML='<div class="empty">Select Lunch or All categories to view unit economics</div>';
    return;
  }
  const rows=payload.records.filter(row=>row.month===view.end&&row.report_category==="Lunch"&&(row.actual_count||0)>0).sort((a,b)=>(b.per_person_cost_inr||0)-(a.per_person_cost_inr||0));
  const max=Math.max(1,LUNCH_BUDGET,...rows.map(row=>row.per_person_cost_inr||0))*1.12;
  const W=680,H=305,p={l:190,r:100,t:16,b:20},plotW=W-p.l-p.r,rowH=(H-p.t-p.b)/Math.max(rows.length,1);
  let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Lunch cost per person by vendor compared with the ${money.format(LUNCH_BUDGET)} budget">`;
  const budgetX=p.l+LUNCH_BUDGET/max*plotW;
  svg+=`<line class="budget-line" x1="${budgetX}" x2="${budgetX}" y1="${p.t-4}" y2="${H-p.b}"/><text class="budget-label" x="${budgetX}" y="11" text-anchor="middle">Budget ${money.format(LUNCH_BUDGET)}</text>`;
  rows.forEach((row,index)=>{
    const y=p.t+index*rowH+12,value=row.per_person_cost_inr||0,width=value/max*plotW;
    const variance=value-LUNCH_BUDGET;
    const budgetText=variance===0?"on budget":`${moneyOne.format(Math.abs(variance))} ${variance>0?'above':'below'} budget`;
    svg+=`<text class="bar-label" x="${p.l-12}" y="${y+12}" text-anchor="end">${esc(shorten(row.vendor,27))}</text><text class="secondary-label" x="${p.l-12}" y="${y+27}" text-anchor="end">${number.format(row.actual_count)} actual count</text><rect x="${p.l}" y="${y}" width="${width}" height="22" rx="5" fill="${value>LUNCH_BUDGET?'#d9485f':'#2f80ed'}"><title>${esc(row.vendor)}: ${moneyOne.format(value)} per person; ${budgetText}</title></rect><text class="value-label" x="${p.l+width+9}" y="${y+16}">${moneyOne.format(value)}</text>`;
  });
  svg+="</svg>";
  document.querySelector("#lunchChart").innerHTML=rows.length?svg:'<div class="empty">No lunch unit-cost data for this month</div>';
}

function renderTable(view){
  const rows=view.rows.filter(row=>row.month===view.end).sort((a,b)=>b.amount_inr-a.amount_inr);
  document.querySelector("#rowCount").textContent=`${rows.length} expense lines`;
  document.querySelector("#detailRows").innerHTML=rows.length?rows.map(row=>`<tr><td><span class="category-chip" style="--chip:${categoryColor(row.report_category)}">${esc(row.report_category)}</span></td><td><b>${esc(row.vendor)}</b></td><td>${esc(row.category)}</td><td class="numeric">${money.format(row.amount_inr)}</td><td class="numeric">${row.actual_count==null?'—':number.format(row.actual_count)}</td><td class="numeric">${row.per_person_cost_inr==null?'—':moneyOne.format(row.per_person_cost_inr)}</td></tr>`).join(""):'<tr><td colspan="6" class="table-empty">No expense lines for this selection</td></tr>';
}

function openExpandedChart(panel){
  const dialog=document.querySelector("#chartDialog");
  const clone=panel.cloneNode(true);
  clone.querySelectorAll(".expand-chart-button").forEach(button=>button.remove());
  clone.querySelectorAll("[id]").forEach(element=>element.removeAttribute("id"));
  document.querySelector("#chartDialogTitle").textContent=panel.querySelector("h2")?.textContent||"Expanded chart";
  document.querySelector("#expandedChartHost").replaceChildren(clone);
  DashboardUI.openDialog(dialog);
}

function initialiseChartExpansion(){
  document.querySelectorAll(".chart-panel").forEach(panel=>{
    const title=panel.querySelector(".panel-title");
    if(!title||title.querySelector(".expand-chart-button"))return;
    const chartName=panel.querySelector("h2")?.textContent||"chart";
    const button=DashboardUI.createActionButton({
      label:"⛶ Expand",
      ariaLabel:`Expand ${chartName}`,
      className:"expand-chart-button",
      onClick:()=>openExpandedChart(panel),
    });
    title.append(button);
  });
}

function renderSettingsState(state){
  const basePath=document.querySelector("#settingsBasePath");
  const endpointInput=document.querySelector("#apiEndpointInput");
  const endpointStatus=document.querySelector("#endpointStatus");
  const tokenInput=document.querySelector("#openaiTokenInput");
  const tokenStatus=document.querySelector("#tokenStatus");
  const deleteButton=document.querySelector("#deleteTokenButton");
  const openFolderButton=document.querySelector("#openFolderButton");
  const provider=state?.ai_provider==="managed"?"managed":"custom";
  document.querySelector("#aiProviderSelect").value=provider;
  document.querySelector("#managedAiSettings").hidden=provider!=="managed";
  document.querySelector("#customAiSettings").hidden=provider!=="custom";
  const detailedToggle=document.querySelector("#localDetailedAnalysis");
  detailedToggle.checked=Boolean(state?.local_detailed_analysis);
  detailedToggle.disabled=provider!=="managed";
  const detailedStatus=document.querySelector("#localDetailedAnalysisStatus");
  detailedStatus.textContent=detailedToggle.checked
    ?"Enabled. Survey chat may use a limited set of locally masked comments."
    :"Off. Survey chat uses anonymised aggregates only.";
  detailedStatus.className=`token-status${detailedToggle.checked?" success":""}`;
  renderLocalAiState(state?.local_ai);
  renderUpdateState(state?.updates);
  basePath.textContent=state?.base_dir||"Not selected";
  openFolderButton.disabled=!state?.base_dir;
  endpointInput.value=state?.api_endpoint||"http://127.0.0.1:12345/v1";
  endpointStatus.textContent="Stored in application settings, separate from the credential vault.";
  endpointStatus.className="token-status";
  tokenInput.value="";
  tokenStatus.className="token-status";
  if(state?.credential_error){
    tokenStatus.textContent=state.credential_error;
    tokenStatus.classList.add("error");
    deleteButton.disabled=true;
  }else if(state?.token_configured&&provider==="custom"){
    const vault=state?.credential_vault||"operating system credential vault";
    tokenStatus.textContent=`A token is saved securely in ${vault}. Enter a new token only to replace it.`;
    tokenStatus.classList.add("success");
    tokenInput.placeholder="Saved token is hidden";
    deleteButton.disabled=false;
  }else{
    const vault=state?.credential_vault||"operating system credential vault";
    tokenStatus.textContent=`No token is saved in ${vault}.`;
    tokenInput.placeholder="Enter a token to save";
    deleteButton.disabled=true;
  }
}

async function setLocalDetailedAnalysis(){
  const toggle=document.querySelector("#localDetailedAnalysis");
  const note=document.querySelector("#localDetailedAnalysisStatus");
  toggle.disabled=true;
  note.textContent=toggle.checked?"Enabling private detailed analysis…":"Disabling private detailed analysis…";
  note.className="token-status";
  try{
    const api=await waitForDesktopApi("set_local_detailed_analysis");
    if(!api)throw new Error("Local detailed analysis is available in the desktop application.");
    const result=await api.set_local_detailed_analysis(Boolean(toggle.checked));
    note.textContent=result.local_detailed_analysis
      ?"Enabled. Survey chat may use a limited set of locally masked comments."
      :"Off. Survey chat uses anonymised aggregates only.";
    note.className="token-status success";
  }catch(error){
    toggle.checked=!toggle.checked;
    note.textContent=error.message||String(error);
    note.className="token-status error";
  }finally{toggle.disabled=false;}
}

function readableBytes(value){
  const bytes=Number(value)||0;
  if(bytes<1024)return `${bytes} B`;
  const units=["KB","MB","GB","TB"];
  let amount=bytes,index=-1;
  do{amount/=1024;index+=1;}while(amount>=1024&&index<units.length-1);
  return `${amount.toFixed(index>0?1:0)} ${units[index]}`;
}

function renderLocalAiState(state){
  if(!state)return;
  const select=document.querySelector("#localAiModelSelect");
  const existing=[...select.options].map(option=>option.value).join("|");
  const incoming=(state.models||[]).map(model=>model.id).join("|");
  if(existing!==incoming){
    select.innerHTML=(state.models||[]).map(model=>`<option value="${esc(model.id)}">${esc(model.name)}</option>`).join("");
  }
  select.value=state.selected_model||"";
  const selected=(state.models||[]).find(model=>model.id===state.selected_model);
  document.querySelector("#localAiModelDetail").innerHTML=selected?`<strong>${esc(selected.description)}</strong><span>${esc(selected.size)} · ${esc(selected.memory)}</span><small>${selected.installed?"Downloaded; verified before each start":"Not downloaded"} · ${esc(state.runtime_name||"Runtime unavailable")}</small>`:"";
  const status=document.querySelector("#localAiStatus");
  status.textContent=state.error||state.message||"Local AI is not running.";
  status.className=`token-status${state.error?" error":state.running?" success":""}`;
  if(!state.runtime_available){
    status.textContent=state.runtime_installing?"Installing the local AI runtime automatically…":state.error||"No local AI runtime is available.";
    status.className=`token-status${state.runtime_installing?"":" error"}`;
  }
  const progress=document.querySelector("#localAiProgress");
  progress.hidden=!state.downloading;
  document.querySelector("#localAiProgressBar").value=state.download_percent||0;
  document.querySelector("#localAiProgressPercent").textContent=`${state.download_percent||0}%`;
  document.querySelector("#localAiProgressLabel").textContent=`${readableBytes(state.downloaded_bytes)} of ${readableBytes(state.download_total)}`;
  const primary=document.querySelector("#localAiPrimaryButton");
  const cancel=document.querySelector("#cancelLocalAiButton");
  const remove=document.querySelector("#removeLocalAiButton");
  select.disabled=Boolean(state.downloading||state.starting);
  primary.disabled=Boolean(state.downloading||state.starting||state.runtime_installing)||!state.runtime_available;
  primary.textContent=state.runtime_installing?"Installing runtime…":state.downloading?"Downloading…":state.starting?"Starting…":state.running?"Stop local AI":state.selected_installed?"Start & use":"Download & use";
  cancel.hidden=!state.downloading;
  remove.hidden=!state.selected_installed||state.running||state.downloading||state.starting;
}

async function refreshLocalAiState(){
  const api=await waitForDesktopApi("get_local_ai_state",5000);
  if(!api)return;
  try{renderLocalAiState(await api.get_local_ai_state());}
  catch(error){
    const status=document.querySelector("#localAiStatus");
    status.textContent=error.message||String(error);
    status.className="token-status error";
  }
}

async function changeAiProvider(){
  const provider=document.querySelector("#aiProviderSelect").value;
  document.querySelector("#managedAiSettings").hidden=provider!=="managed";
  document.querySelector("#customAiSettings").hidden=provider!=="custom";
  try{
    const api=await waitForDesktopApi("set_ai_provider");
    if(!api)throw new Error("AI settings are available in the desktop application.");
    renderLocalAiState(await api.set_ai_provider(provider));
    await loadSettingsState();
  }catch(error){
    const status=document.querySelector(provider==="managed"?"#localAiStatus":"#endpointStatus");
    status.textContent=error.message||String(error);
    status.className="token-status error";
  }
}

async function selectLocalAiModel(){
  const modelId=document.querySelector("#localAiModelSelect").value;
  try{
    const api=await waitForDesktopApi("select_local_ai_model");
    if(!api)throw new Error("Local AI is available in the desktop application.");
    renderLocalAiState(await api.select_local_ai_model(modelId));
  }catch(error){
    const status=document.querySelector("#localAiStatus");
    status.textContent=error.message||String(error);
    status.className="token-status error";
  }
}

async function runLocalAiPrimaryAction(){
  const button=document.querySelector("#localAiPrimaryButton");
  button.disabled=true;
  try{
    const api=await waitForDesktopApi("get_local_ai_state");
    if(!api)throw new Error("Local AI is available in the desktop application.");
    const state=await api.get_local_ai_state();
    let updated;
    if(state.running)updated=await api.stop_local_ai();
    else if(state.selected_installed){
      button.textContent="Starting…";
      const status=document.querySelector("#localAiStatus");
      status.textContent="Verifying and loading the model. This can take a minute on CPU…";
      status.className="token-status";
      updated=await api.start_local_ai();
    }
    else updated=await api.download_local_ai_model();
    renderLocalAiState(updated);
  }catch(error){
    const status=document.querySelector("#localAiStatus");
    status.textContent=error.message||String(error);
    status.className="token-status error";
  }finally{button.disabled=false;}
}

async function cancelLocalAiDownload(){
  const api=await waitForDesktopApi("cancel_local_ai_download");
  if(api)renderLocalAiState(await api.cancel_local_ai_download());
}

async function removeLocalAiModel(){
  const modelId=document.querySelector("#localAiModelSelect").value;
  if(!window.confirm("Remove this downloaded model from this computer?"))return;
  try{
    const api=await waitForDesktopApi("remove_local_ai_model");
    if(!api)throw new Error("Local AI is available in the desktop application.");
    renderLocalAiState(await api.remove_local_ai_model(modelId));
  }catch(error){
    const status=document.querySelector("#localAiStatus");
    status.textContent=error.message||String(error);
    status.className="token-status error";
  }
}

function renderUpdateState(state){
  const version=document.querySelector("#updateVersion");
  const badge=document.querySelector("#versionBadge");
  const status=document.querySelector("#updateStatus");
  const button=document.querySelector("#checkUpdatesButton");
  const current=state?.current_version||"unknown";
  version.textContent=`Installed version ${current}`;
  badge.textContent=`v${current}`;
  button.disabled=!state?.supported;
  status.textContent=state?.message||"Update status is unavailable.";
  status.className="token-status";
}

async function checkForUpdates(){
  const button=document.querySelector("#checkUpdatesButton");
  const status=document.querySelector("#updateStatus");
  const originalLabel=button.textContent;
  button.disabled=true;
  button.textContent="Checking…";
  status.textContent="Checking the latest GitHub Release…";
  status.className="token-status";
  try{
    const api=await waitForDesktopApi("check_for_updates");
    if(!api)throw new Error("Updates are available in the packaged Windows application.");
    const result=await api.check_for_updates();
    if(!result?.ok)throw new Error(result?.error||"The update check failed.");
    if(result.status==="unsupported"){
      renderUpdateState(result);
      return;
    }
    if(result.status==="up_to_date"){
      status.textContent=`You already have the latest version (${result.current_version}).`;
      status.className="token-status success";
      return;
    }
    if(result.status!=="update_available")throw new Error("GitHub returned an unexpected update status.");
    const notes=String(result.release_notes||"").trim().slice(0,900);
    const prompt=[
      `Version ${result.latest_version} is available.`,
      "",
      notes||"No release notes were provided.",
      "",
      "Download, verify, install, and restart now?",
    ].join("\n");
    if(!window.confirm(prompt)){
      status.textContent=`Version ${result.latest_version} is available. Click Check for updates when you are ready to install it.`;
      status.className="token-status success";
      return;
    }
    button.textContent="Downloading…";
    status.textContent="Downloading and verifying the update. Keep this window open…";
    const installed=await api.install_latest_update();
    if(!installed?.ok)throw new Error(installed?.error||"The update could not be installed.");
    if(installed.status==="up_to_date"){
      status.textContent="The application is already up to date.";
      status.className="token-status success";
      return;
    }
    status.textContent=`Version ${installed.latest_version} was verified. Restarting the application…`;
    status.className="token-status success";
    button.textContent="Restarting…";
    return;
  }catch(error){
    status.textContent=error.message||String(error);
    status.className="token-status error";
  }finally{
    if(button.textContent!=="Restarting…"){
      button.disabled=false;
      button.textContent=originalLabel;
    }
  }
}

async function loadSettingsState(){
  const api=await waitForDesktopApi("get_settings_state");
  if(!api){
    renderSettingsState({credential_error:"Settings are available in the desktop application."});
    return null;
  }
  try{
    const state=await api.get_settings_state();
    renderSettingsState(state);
    return state;
  }catch(error){
    renderSettingsState({credential_error:error.message||String(error)});
    return null;
  }
}

async function openSettings(){
  DashboardUI.openDialog(document.querySelector("#settingsDialog"));
  document.querySelector("#tokenStatus").textContent="Checking credential status…";
  await loadSettingsState();
  clearInterval(localAiPollTimer);
  localAiPollTimer=setInterval(()=>void refreshLocalAiState(),750);
}

async function saveAiApiEndpoint(){
  const input=document.querySelector("#apiEndpointInput");
  const button=document.querySelector("#saveEndpointButton");
  const status=document.querySelector("#endpointStatus");
  const endpoint=input.value.trim();
  if(!endpoint){
    status.textContent="Enter an AI API endpoint before saving.";
    status.className="token-status error";
    input.focus();
    return;
  }
  button.disabled=true;
  try{
    const api=await waitForDesktopApi("save_ai_api_endpoint");
    if(!api)throw new Error("Settings are available in the desktop application.");
    const result=await api.save_ai_api_endpoint(endpoint);
    input.value=result.api_endpoint;
    status.textContent="Endpoint saved in application settings.";
    status.className="token-status success";
  }catch(error){
    status.textContent=error.message||String(error);
    status.className="token-status error";
  }finally{
    button.disabled=false;
  }
}

async function testAiApiEndpoint(){
  const input=document.querySelector("#apiEndpointInput");
  const button=document.querySelector("#testEndpointButton");
  const status=document.querySelector("#endpointStatus");
  button.disabled=true;
  status.textContent="Testing endpoint and token…";
  status.className="token-status";
  try{
    const api=await waitForDesktopApi("test_ai_api_endpoint");
    if(!api)throw new Error("Endpoint testing is available in the desktop application.");
    const result=await api.test_ai_api_endpoint(input.value.trim());
    if(!result?.ok)throw new Error(result?.error||"The endpoint test failed.");
    status.textContent=`Connected using ${result.protocol}. ${result.model_count} model${result.model_count===1?"":"s"} available; Ask Dashboard will use ${result.model}.`;
    status.className="token-status success";
  }catch(error){
    status.textContent=error.message||String(error);
    status.className="token-status error";
  }finally{
    button.disabled=false;
  }
}

async function saveOpenAIToken(){
  const input=document.querySelector("#openaiTokenInput");
  const button=document.querySelector("#saveTokenButton");
  const token=input.value.trim();
  if(!token){
    const status=document.querySelector("#tokenStatus");
    status.textContent="Enter an AI API token before saving.";
    status.className="token-status error";
    input.focus();
    return;
  }
  input.value="";
  button.disabled=true;
  try{
    const api=await waitForDesktopApi("save_openai_api_token");
    if(!api)throw new Error("Settings are available in the desktop application.");
    await api.save_openai_api_token(token);
    await loadSettingsState();
  }catch(error){
    const status=document.querySelector("#tokenStatus");
    status.textContent=error.message||String(error);
    status.className="token-status error";
  }finally{
    button.disabled=false;
  }
}

async function deleteOpenAIToken(){
  const button=document.querySelector("#deleteTokenButton");
  button.disabled=true;
  try{
    const api=await waitForDesktopApi("delete_openai_api_token");
    if(!api)throw new Error("Settings are available in the desktop application.");
    await api.delete_openai_api_token();
    await loadSettingsState();
  }catch(error){
    const status=document.querySelector("#tokenStatus");
    status.textContent=error.message||String(error);
    status.className="token-status error";
    button.disabled=false;
  }
}

document.querySelectorAll("#groupFilter,#monthFilter").forEach(element=>element.addEventListener("change",render));
document.querySelector("#lookbackFilter").addEventListener("change",()=>{
  updatePeriodControls();
  render();
});
document.querySelector("#currencyFilter").addEventListener("change",event=>{
  displayCurrency=event.target.value==="USD"?"USD":"INR";
  syncCurrencyControls();
  if(payload.meta?.months?.length)render();
  window.WorkplaceDashboard?.render?.();
  void saveCurrencyPreferences();
});
document.querySelector("#exchangeRateInput").addEventListener("change",event=>{
  const rate=Number(event.target.value);
  if(!Number.isFinite(rate)||rate<=0){
    event.target.value=String(usdToInrRate);
    setStatus("USD exchange rate must be greater than zero.");
    return;
  }
  usdToInrRate=rate;
  if(payload.meta?.months?.length)render();
  window.WorkplaceDashboard?.render?.();
  void saveCurrencyPreferences();
});
document.querySelector("#workplaceCurrencyFilter").addEventListener("change",event=>{
  displayCurrency=event.target.value==="USD"?"USD":"INR";
  syncCurrencyControls();
  if(payload.meta?.months?.length)render();
  window.WorkplaceDashboard?.render?.();
  void saveCurrencyPreferences();
});
document.querySelector("#workplaceExchangeRateInput").addEventListener("change",event=>{
  const rate=Number(event.target.value);
  if(!Number.isFinite(rate)||rate<=0){
    event.target.value=String(usdToInrRate);
    document.querySelector("#workplaceStatus").textContent="USD exchange rate must be greater than zero.";
    return;
  }
  usdToInrRate=rate;
  syncCurrencyControls();
  if(payload.meta?.months?.length)render();
  window.WorkplaceDashboard?.render?.();
  void saveCurrencyPreferences();
});
document.querySelector("#workbookFilter").addEventListener("change",async event=>{
  try{
    setStatus("Switching workbook…");
    const response=await fetch("/api/select-workbook",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({id:event.target.value}),
    });
    const result=await response.json();
    if(!response.ok||!result.ok)throw new Error(result.error||"Could not switch workbook");
    libraryState=result;
    populateWorkbookSelector();
    latestKnownMonth=null;
    await Promise.allSettled([loadData("Loading selected workbook…"),window.CollaborationDashboard?.load?.()].filter(Boolean));
  }catch(error){setStatus(error.message);}
});
document.querySelector("#refreshButton").addEventListener("click",async()=>{
  const button=document.querySelector("#refreshButton");
  const originalLabel=button.textContent;
  button.disabled=true;
  button.textContent="Refreshing…";
  try{
    setStatus("Scanning local expense files…");
    const ready=await refreshLibrary();
    if(!ready)return;
    const response=await fetch("/api/refresh",{cache:"no-store"});
    const result=await response.json();
    if(!result.ok)throw new Error(result.error||"Refresh failed");
    await loadAllDashboardData("Loading refreshed data…");
  }catch(error){setStatus(error.message);}
  finally{
    button.disabled=false;
    button.textContent=originalLabel;
  }
});
document.querySelector("#chooseFolderButton").addEventListener("click",event=>chooseBaseDirectory(event.currentTarget));
document.querySelector("#changeFolderButton").addEventListener("click",event=>chooseBaseDirectory(event.currentTarget));
document.querySelector("#openFolderButton").addEventListener("click",async()=>{
  try{
    const api=await waitForDesktopApi("open_base_directory");
    if(!api)throw new Error("Open the pywebview desktop app to browse the base folder.");
    const result=await api.open_base_directory();
    if(!result.ok)throw new Error(result.error||"Could not open the base folder");
  }catch(error){
    const status=document.querySelector("#tokenStatus");
    status.textContent=error.message||String(error);
    status.className="token-status error";
  }
});
document.querySelector("#settingsButton").addEventListener("click",()=>void openSettings());
document.querySelector("#checkUpdatesButton").addEventListener("click",()=>void checkForUpdates());
document.querySelector("#saveEndpointButton").addEventListener("click",()=>void saveAiApiEndpoint());
document.querySelector("#testEndpointButton").addEventListener("click",()=>void testAiApiEndpoint());
document.querySelector("#saveTokenButton").addEventListener("click",()=>void saveOpenAIToken());
document.querySelector("#deleteTokenButton").addEventListener("click",()=>void deleteOpenAIToken());
document.querySelector("#aiProviderSelect").addEventListener("change",()=>void changeAiProvider());
document.querySelector("#localDetailedAnalysis").addEventListener("change",()=>void setLocalDetailedAnalysis());
document.querySelector("#localAiModelSelect").addEventListener("change",()=>void selectLocalAiModel());
document.querySelector("#localAiPrimaryButton").addEventListener("click",()=>void runLocalAiPrimaryAction());
document.querySelector("#cancelLocalAiButton").addEventListener("click",()=>void cancelLocalAiDownload());
document.querySelector("#removeLocalAiButton").addEventListener("click",()=>void removeLocalAiModel());
document.querySelector("#openaiTokenInput").addEventListener("keydown",event=>{
  if(event.key==="Enter"){
    event.preventDefault();
    void saveOpenAIToken();
  }
});
document.querySelector("#apiEndpointInput").addEventListener("keydown",event=>{
  if(event.key==="Enter"){
    event.preventDefault();
    void saveAiApiEndpoint();
  }
});
document.querySelector("#chartDialog").addEventListener("close",()=>document.querySelector("#expandedChartHost").replaceChildren());
document.querySelector("#settingsDialog").addEventListener("close",()=>{
  document.querySelector("#openaiTokenInput").value="";
  clearInterval(localAiPollTimer);
  localAiPollTimer=null;
});
document.addEventListener("click",event=>{
  const toggle=event.target.closest?.(".monthly-series-toggle[data-plan-year]");
  if(!toggle||!toggle.closest(".monthly-series-legend"))return;
  event.preventDefault();
  const expandedHost=toggle.closest("#expandedChartHost");
  const label=toggle.dataset.planYear;
  if(hiddenMonthlyPlanYears.has(label))hiddenMonthlyPlanYears.delete(label);
  else hiddenMonthlyPlanYears.add(label);
  renderMonthlyTrend(filtered());
  if(expandedHost){
    const clone=cloneExpandedMonthlyTrend();
    if(clone)expandedHost.replaceChildren(clone);
  }
});
DashboardUI.initialiseDialogs();
DashboardUI.initialiseTabs(document.querySelector("#reportTabs"),{defaultPanelId:"expenseReportPanel"});
initialiseChartExpansion();
initialiseChartTooltips();

window.addEventListener("pywebviewready",()=>{
  desktopReady=true;
  if(!libraryState.configured||!currencyPreferencesLoaded)bootstrapped=false;
  bootstrap();
});
setTimeout(()=>bootstrap(),1200);
