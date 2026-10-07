const COLORS={Lunch:"#00a94f",Pantry:"#2f80ed",Miscellaneous:"#8a63d2",Fruits:"#f2a93b",Workspace:"#0f766e",Travel:"#d97706",Courier:"#64748b",Unclassified:"#9aa9a5",Other:"#9aa9a5"};
const REQUIRED_BUCKETS=["Lunch","Pantry","Miscellaneous","Fruits"];
const MISC_COLORS={Stationery:"#f2a93b",Flowers:"#d9488c",Medicine:"#8a63d2",Medicines:"#8a63d2",Office:"#2f80ed","Meeting Room & Reception":"#00a94f","Sent to Emp":"#d97706","New Joiners":"#0f766e",Other:"#9aa9a5"};
const LUNCH_BUDGET=200;
let payload={records:[],meta:{}};
let latestKnownMonth=null;
let libraryState={configured:false,files:[],selected_id:null};
let desktopReady=false;
let bootstrapped=false;

const money=new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:0});
const moneyOne=new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:1});
const number=new Intl.NumberFormat("en-IN",{maximumFractionDigits:0});
const pct=new Intl.NumberFormat("en-IN",{style:"percent",maximumFractionDigits:1});
const monthLabel=iso=>new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN",{month:"short",year:"numeric"});
const shortMonth=iso=>new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN",{month:"short"});
const compactMonth=iso=>new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN",{month:"short",year:"2-digit"});
const sum=(rows,field)=>rows.reduce((total,row)=>total+(Number(row[field])||0),0);
const compact=value=>new Intl.NumberFormat("en-IN",{notation:"compact",maximumFractionDigits:1}).format(value);
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

async function loadData(message="Refreshing local workbook…"){
  setStatus(message);
  const response=await fetch("/api/data",{cache:"no-store"});
  const result=await response.json();
  if(result.error){clearDashboardData();throw new Error(result.error);}
  payload=result;
  if(!payload.meta?.months?.length){clearDashboardData();throw new Error("This workbook has no valid expense rows to display.");}
  initialiseFilters();
  render();
  const latest=payload.meta.months.at(-1);
  const source=payload.meta.source_relative_path||payload.meta.source_name;
  setStatus(`Loaded ${payload.meta.record_count} rows from ${source}${latest?` through ${monthLabel(latest)}`:""}`);
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
  ["kpis","bucketCards","trendChart","trendLegend","varianceChart","vendorChart","miscChart","miscLegend","lunchChart","detailRows"].forEach(id=>{
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
  document.querySelector("#dashboardContent").hidden=true;
}

function showDashboard(){
  document.querySelector("#setupPanel").hidden=true;
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
    showSetup("No expense workbooks found",`Checked ${libraryState.expenses_dir} at ${checkedAt}. Add .xlsx or .xlsm files inside this folder, then select Refresh.`,"Change base location");
    return false;
  }
  populateWorkbookSelector();
  showDashboard();
  return true;
}

async function chooseBaseDirectory(){
  const button=document.querySelector("#chooseFolderButton");
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
    if(ready){
      try{await loadData("Loading selected workbook…");}
      catch(error){setStatus(error.message);}
    }
    return ready;
  }finally{
    button.disabled=false;
    button.textContent=libraryState.configured?"Change base location":originalLabel;
  }
}

async function bootstrap(){
  if(bootstrapped)return;
  bootstrapped=true;
  try{
    const api=await waitForDesktopApi("choose_base_directory",5000);
    const ready=await refreshLibrary();
    if(!libraryState.configured&&api){
      await chooseBaseDirectory();
      return;
    }
    if(ready){
      try{await loadData("Loading selected workbook…");}
      catch(error){setStatus(error.message);}
    }
  }catch(error){
    showSetup("Dashboard could not start",error.message);
  }
}

function initialiseFilters(){
  const group=document.querySelector("#groupFilter");
  const month=document.querySelector("#monthFilter");
  const oldGroup=group.value;
  const oldMonth=month.value;
  const wasShowingLatest=!oldMonth||oldMonth===latestKnownMonth;
  const categories=[...REQUIRED_BUCKETS,...payload.meta.report_categories.filter(value=>!REQUIRED_BUCKETS.includes(value))];
  group.innerHTML=["All",...categories].map(value=>`<option value="${esc(value)}">${value==="All"?"All categories":esc(value)}</option>`).join("");
  month.innerHTML=[...payload.meta.months].reverse().map(value=>`<option value="${value}">${monthLabel(value)}</option>`).join("");
  if([...group.options].some(option=>option.value===oldGroup))group.value=oldGroup;
  if(!wasShowingLatest&&[...month.options].some(option=>option.value===oldMonth))month.value=oldMonth;
  else if(payload.meta.months.length)month.value=payload.meta.months.at(-1);
  latestKnownMonth=payload.meta.months.at(-1)||null;
}

function filtered(){
  const group=document.querySelector("#groupFilter").value;
  const end=document.querySelector("#monthFilter").value;
  const lookback=Number(document.querySelector("#lookbackFilter").value);
  const availableSpan=monthDistance(payload.meta.months[0],end);
  const monthCount=lookback===999?availableSpan:Math.min(lookback,availableSpan);
  const months=calendarMonths(end,monthCount);
  const rows=payload.records.filter(row=>months.includes(row.month)&&(group==="All"||row.report_category===group));
  const previousMonth=shiftMonth(end,-1);
  return {group,end,months,rows,previousMonth:previousMonth>=payload.meta.months[0]?previousMonth:null};
}

function render(){
  const view=filtered();
  renderKpis(view);
  renderBuckets(view);
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
  const lunchBudgetNote=!showLunch?"Available for Lunch or All categories":mealCost===null?"No lunch activity":mealCost===LUNCH_BUDGET?`On the ₹${LUNCH_BUDGET} budget · ${number.format(meals)} actual count`:`${moneyOne.format(Math.abs(mealCost-LUNCH_BUDGET))} ${mealCost>LUNCH_BUDGET?'above':'below'} ₹${LUNCH_BUDGET} budget · ${number.format(meals)} actual count`;
  const cards=[
    ["Latest-month spend",money.format(currentTotal),`${monthLabel(view.end)} · ${scope}`,"#00a94f"],
    [`${view.months.length}-month spend`,money.format(windowTotal),`${monthLabel(view.months[0])} to ${monthLabel(view.months.at(-1))}`,"#0b5a4d"],
    ["Average per month",money.format(average),`Across ${view.months.length} selected months`,"#2f80ed"],
    ["Month-on-month",change===null?"—":`${change>=0?"+":""}${pct.format(change)}`,change===null?"No prior-month data":`${money.format(currentTotal-previousTotal)} vs ${monthLabel(view.previousMonth)}`,change>0?"#d9485f":"#00a94f",change===null?"":change>0?"unfavourable":"favourable"],
    ["Lunch cost / person",mealCost===null?"—":moneyOne.format(mealCost),lunchBudgetNote,mealCost!==null&&mealCost>LUNCH_BUDGET?"#d9485f":"#00a94f",mealCost===null?"":mealCost>LUNCH_BUDGET?"unfavourable":"favourable"],
    ["Top-vendor share",concentration===null?"—":pct.format(concentration),topVendor?`${topVendor[0]} · ${money.format(topVendor[1])}`:"No vendor activity","#f2a93b"],
  ];
  document.querySelector("#kpis").innerHTML=cards.map(([label,value,note,color,state])=>`<article class="kpi" style="--accent:${color}"><div class="kpi-label">${label}</div><div class="kpi-value ${state||""}">${value}</div><div class="kpi-note">${esc(note)}</div></article>`).join("");
}

function renderBuckets(view){
  const months=calendarMonths(view.end,Math.min(3,monthDistance(payload.meta.months[0],view.end)));
  const previousMonth=months.length>1?months.at(-2):null;
  document.querySelector("#bucketCards").innerHTML=REQUIRED_BUCKETS.map(category=>{
    const values=months.map(month=>sum(payload.records.filter(row=>row.month===month&&row.report_category===category),"amount_inr"));
    const latest=values.at(-1)||0;
    const previous=values.at(-2)||0;
    const threeMonthTotal=values.reduce((a,b)=>a+b,0);
    const movement=previous?(latest-previous)/previous:null;
    const color=COLORS[category];
    const movementClass=movement===null?"neutral":movement>0?"up":"down";
    const movementText=movement===null?"No comparison":`${movement>=0?"▲":"▼"} ${pct.format(Math.abs(movement))} vs ${shortMonth(previousMonth)}`;
    return `<article class="bucket-card"><div class="bucket-head"><div class="bucket-name">${category}</div><i class="bucket-dot" style="background:${color}"></i></div><div class="bucket-total">${money.format(latest)}</div><div class="bucket-sub"><span>Latest month</span><b class="movement ${movementClass}">${movementText}</b></div><div class="bucket-months">${months.map((month,index)=>`<div><span>${shortMonth(month)}</span><b>${compact(values[index])}</b><i style="height:${Math.max(4,values[index]/Math.max(1,...values)*34)}px;background:${color}"></i></div>`).join("")}</div><div class="bucket-total-line"><span>Three-month total</span><b>${money.format(threeMonthTotal)}</b></div></article>`;
  }).join("");
}

function renderTrend(view){
  const groups=[...REQUIRED_BUCKETS,...payload.meta.report_categories.filter(group=>!REQUIRED_BUCKETS.includes(group))].filter(group=>view.rows.some(row=>row.report_category===group));
  const series=view.months.map(month=>({month,values:Object.fromEntries(groups.map(group=>[group,sum(view.rows.filter(row=>row.month===month&&row.report_category===group),"amount_inr")]))}));
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
      svg+=`<rect x="${x}" y="${base}" width="${barW}" height="${Math.max(0,height)}" fill="${COLORS[group]||COLORS.Other}"><title>${group}: ${money.format(value)}</title></rect>`;
      if(height>25&&value>0)svg+=`<text class="segment-label" x="${x+barW/2}" y="${base+height/2+4}" text-anchor="middle">${compact(value)}</text>`;
    });
    const totalLabel=series.length>6?compact(totals[index]):money.format(totals[index]);
    const periodLabel=series.length>6?compactMonth(item.month):monthLabel(item.month);
    svg+=`<text class="total-label" x="${x+barW/2}" y="${Math.max(16,base-8)}" text-anchor="middle">${totalLabel}</text><text class="axis-label" x="${x+barW/2}" y="${H-20}" text-anchor="middle">${periodLabel}</text>`;
  });
  svg+="</svg>";
  document.querySelector("#trendChart").innerHTML=series.length?svg:'<div class="empty">No data for this selection</div>';
  document.querySelector("#trendLegend").innerHTML=groups.map(group=>`<span><i style="background:${COLORS[group]||COLORS.Other}"></i>${esc(group)}</span>`).join("");
}

function renderVariance(view){
  if(!view.previousMonth){document.querySelector("#varianceChart").innerHTML='<div class="empty">No prior month available</div>';return;}
  const categories=[...REQUIRED_BUCKETS,...payload.meta.report_categories.filter(category=>!REQUIRED_BUCKETS.includes(category))].filter(category=>view.group==="All"||view.group===category);
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
  const map={};
  latest.forEach(row=>map[row.vendor]=(map[row.vendor]||0)+row.amount_inr);
  const rows=Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const max=Math.max(1,...rows.map(row=>row[1]));
  const W=680,H=305,p={l:190,r:145,t:8,b:14},rowH=(H-p.t-p.b)/Math.max(rows.length,1);
  let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Top vendor spend in latest month">`;
  rows.forEach(([label,value],index)=>{
    const y=p.t+index*rowH+6,width=(W-p.l-p.r)*value/max;
    svg+=`<text class="bar-label" x="${p.l-12}" y="${y+16}" text-anchor="end">${esc(shorten(label,27))}</text><rect x="${p.l}" y="${y}" width="${width}" height="22" rx="5" fill="${index===0?'#087f52':'#7bc99a'}"><title>${esc(label)}: ${money.format(value)} (${total?pct.format(value/total):'—'})</title></rect><text class="value-label" x="${p.l+width+9}" y="${y+16}">${compact(value)} · ${total?pct.format(value/total):'—'}</text>`;
  });
  svg+="</svg>";
  document.querySelector("#vendorChart").innerHTML=rows.length?svg:'<div class="empty">No vendor activity</div>';
}

function renderMisc(view){
  const chart=document.querySelector("#miscChart");
  const legend=document.querySelector("#miscLegend");
  if(view.group!=="All"&&view.group!=="Miscellaneous"){
    legend.innerHTML="";
    chart.innerHTML='<div class="empty">Select Miscellaneous or All categories to view expense types</div>';
    return;
  }
  const months=calendarMonths(view.end,Math.min(3,monthDistance(payload.meta.months[0],view.end)));
  const rows=payload.records.filter(row=>months.includes(row.month)&&row.report_category==="Miscellaneous");
  const types=[...new Set(rows.map(row=>row.category))].sort((a,b)=>sum(rows.filter(row=>row.category===b),"amount_inr")-sum(rows.filter(row=>row.category===a),"amount_inr"));
  if(!rows.length){
    legend.innerHTML="";
    chart.innerHTML='<div class="empty">No miscellaneous expense-type data for this period</div>';
    return;
  }
  const series=months.map(month=>({month,values:Object.fromEntries(types.map(type=>[type,sum(rows.filter(row=>row.month===month&&row.category===type),"amount_inr")]))}));
  const totals=series.map(item=>Object.values(item.values).reduce((a,b)=>a+b,0));
  const max=Math.max(1,...totals)*1.16;
  const W=580,H=305,p={l:54,r:16,t:34,b:48},plotW=W-p.l-p.r,plotH=H-p.t-p.b;
  const barW=Math.min(92,plotW/series.length*.52);
  let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Miscellaneous spend by expense type for the latest three months">`;
  for(let i=0;i<=4;i++){
    const value=max*i/4,y=p.t+plotH-i*plotH/4;
    svg+=`<line class="gridline" x1="${p.l}" x2="${W-p.r}" y1="${y}" y2="${y}"/><text class="axis-label" x="${p.l-8}" y="${y+4}" text-anchor="end">${compact(value)}</text>`;
  }
  series.forEach((item,index)=>{
    const x=p.l+(index+.5)*plotW/series.length-barW/2;
    let base=p.t+plotH;
    types.forEach(type=>{
      const value=item.values[type]||0,height=value/max*plotH;
      base-=height;
      const color=MISC_COLORS[type]||MISC_COLORS.Other;
      svg+=`<rect x="${x}" y="${base}" width="${barW}" height="${Math.max(0,height)}" fill="${color}"><title>${esc(type)}: ${money.format(value)}</title></rect>`;
      if(height>24&&value>0)svg+=`<text class="segment-label" x="${x+barW/2}" y="${base+height/2+4}" text-anchor="middle">${compact(value)}</text>`;
    });
    svg+=`<text class="total-label" x="${x+barW/2}" y="${Math.max(17,base-8)}" text-anchor="middle">${money.format(totals[index])}</text><text class="axis-label" x="${x+barW/2}" y="${H-18}" text-anchor="middle">${compactMonth(item.month)}</text>`;
  });
  svg+="</svg>";
  chart.innerHTML=svg;
  legend.innerHTML=types.map(type=>`<span><i style="background:${MISC_COLORS[type]||MISC_COLORS.Other}"></i>${esc(type)}</span>`).join("");
}

function renderLunch(view){
  if(view.group!=="All"&&view.group!=="Lunch"){
    document.querySelector("#lunchChart").innerHTML='<div class="empty">Select Lunch or All categories to view unit economics</div>';
    return;
  }
  const rows=payload.records.filter(row=>row.month===view.end&&row.report_category==="Lunch"&&(row.actual_count||0)>0).sort((a,b)=>(b.per_person_cost_inr||0)-(a.per_person_cost_inr||0));
  const max=Math.max(1,LUNCH_BUDGET,...rows.map(row=>row.per_person_cost_inr||0))*1.12;
  const W=680,H=305,p={l:190,r:100,t:16,b:20},plotW=W-p.l-p.r,rowH=(H-p.t-p.b)/Math.max(rows.length,1);
  let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Lunch cost per person by vendor compared with the 200 rupee budget">`;
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
  document.querySelector("#detailRows").innerHTML=rows.length?rows.map(row=>`<tr><td><span class="category-chip" style="--chip:${COLORS[row.report_category]||COLORS.Other}">${esc(row.report_category)}</span></td><td><b>${esc(row.vendor)}</b></td><td>${esc(row.category)}</td><td class="numeric">${money.format(row.amount_inr)}</td><td class="numeric">${row.actual_count==null?'—':number.format(row.actual_count)}</td><td class="numeric">${row.per_person_cost_inr==null?'—':moneyOne.format(row.per_person_cost_inr)}</td></tr>`).join(""):'<tr><td colspan="6" class="table-empty">No expense lines for this selection</td></tr>';
}

document.querySelectorAll("#groupFilter,#monthFilter,#lookbackFilter").forEach(element=>element.addEventListener("change",render));
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
    await loadData("Loading selected workbook…");
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
    await loadData("Loading refreshed data…");
  }catch(error){setStatus(error.message);}
  finally{
    button.disabled=false;
    button.textContent=originalLabel;
  }
});
document.querySelector("#chooseFolderButton").addEventListener("click",()=>chooseBaseDirectory());
document.querySelector("#changeFolderButton").addEventListener("click",()=>chooseBaseDirectory());
document.querySelector("#openFolderButton").addEventListener("click",async()=>{
  const api=await waitForDesktopApi("open_base_directory");
  if(!api){setStatus("Open the pywebview desktop app to browse the base folder.");return;}
  const result=await api.open_base_directory();
  if(!result.ok)setStatus(result.error||"Could not open the base folder");
});

window.addEventListener("pywebviewready",()=>{
  desktopReady=true;
  if(!libraryState.configured)bootstrapped=false;
  bootstrap();
});
setTimeout(()=>bootstrap(),1200);

setInterval(()=>{
  if(document.visibilityState==="visible"&&libraryState.selected_id)loadData("Checking for workbook updates…").catch(error=>setStatus(error.message));
},60000);
