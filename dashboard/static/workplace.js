(function initialiseWorkplaceDashboard(global){
  const COLORS={rental:"#087f52",variable:"#f2a93b",accent:"#2f80ed",danger:"#d9485f"};
  const ICONS={pdf:"📕",word:"📘",excel:"📊",presentation:"📙",image:"🖼️",text:"📄",file:"📁"};
  let payload={records:[],contracts:[],forecast:{},meta:{}};

  const escapeHtml=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  const monthLabel=iso=>new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN",{month:"short",year:"numeric"});
  const shortDate=iso=>new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"});
  const currency=()=>document.querySelector("#workplaceCurrencyFilter")?.value==="USD"?"USD":"INR";
  const exchangeRate=()=>Math.max(.01,Number(document.querySelector("#workplaceExchangeRateInput")?.value)||96);
  const converted=value=>currency()==="USD"?Number(value||0)/exchangeRate():Number(value||0);
  const money=value=>new Intl.NumberFormat(currency()==="USD"?"en-US":"en-IN",{style:"currency",currency:currency(),currencyDisplay:"narrowSymbol",maximumFractionDigits:0}).format(converted(value));
  const compact=value=>new Intl.NumberFormat("en-IN",{notation:"compact",maximumFractionDigits:1}).format(converted(value));
  const percent=value=>new Intl.NumberFormat("en-IN",{style:"percent",maximumFractionDigits:1}).format(value||0);
  const sum=rows=>rows.reduce((total,row)=>total+Number(row.amount_inr||0),0);
  const tooltipLines=lines=>escapeHtml(JSON.stringify(lines));

  function clear(message){
    document.querySelector("#workplaceStatus").textContent=message;
    document.querySelector("#workplaceKpis").replaceChildren();
    document.querySelector("#workplaceTrendChart").innerHTML='<div class="empty">No workplace cost data is available</div>';
    document.querySelector("#workplaceAdditionalChart").innerHTML='<div class="empty">No additional cost events are available</div>';
    document.querySelector("#workplaceTrendLegend").replaceChildren();
    document.querySelector("#workplaceDetailRows").innerHTML='<tr><td colspan="6" class="table-empty">No workplace invoices found</td></tr>';
    document.querySelector("#workplaceRowCount").textContent="";
    renderContracts();
    renderForecast();
  }

  function populateFilter(){
    const select=document.querySelector("#workplaceFyFilter");
    const previous=select.value||"all";
    const years=payload.meta?.fiscal_years||[];
    select.innerHTML='<option value="all">All FYs</option>'+[...years].reverse().map(year=>`<option value="${escapeHtml(year.label)}">${escapeHtml(year.label)}</option>`).join("");
    select.value=[...select.options].some(option=>option.value===previous)?previous:"all";
  }

  function currentView(){
    const fiscalYear=document.querySelector("#workplaceFyFilter").value||"all";
    const records=fiscalYear==="all"?payload.records:payload.records.filter(row=>row.fiscal_year===fiscalYear);
    const months=[...new Set(records.map(row=>row.month))].sort();
    const fiscalMeta=(payload.meta?.fiscal_years||[]).find(item=>item.label===fiscalYear);
    return {fiscalYear,records,months,fiscalMeta};
  }

  function renderForecast(){
    const forecast=payload.forecast||{};
    document.querySelector("#workplaceForecastFy").textContent=forecast.fiscal_year||"Next FY";
    document.querySelector("#workplaceExpectedAnnual").textContent=forecast.expected_annual?money(forecast.expected_annual):"—";
    document.querySelector("#workplaceExpectedMonthly").textContent=forecast.expected_monthly?money(forecast.expected_monthly):"—";
    document.querySelector("#workplaceHistoricalMonthly").textContent=forecast.average_monthly?money(forecast.average_monthly):"—";
    document.querySelector("#workplaceHistoricalAnnual").textContent=forecast.historical_annualized?money(forecast.historical_annualized):"—";
    document.querySelector("#workplaceForecastCoverage").textContent=forecast.months_observed
      ?`Based on ${forecast.months_observed} loaded month${forecast.months_observed===1?"":"s"} across all available financial years; missing months are excluded.`
      :"Add workplace invoices to calculate the next-year outlook.";
  }

  function renderKpis(view){
    const total=sum(view.records);
    const monthly=Object.fromEntries(view.months.map(month=>[month,sum(view.records.filter(row=>row.month===month))]));
    const latestMonth=view.months.at(-1);
    const previousMonth=view.months.at(-2);
    const latest=latestMonth?monthly[latestMonth]:0;
    const previous=previousMonth?monthly[previousMonth]:0;
    const movement=previous?(latest-previous)/previous:null;
    const rentalRows=view.records.filter(row=>row.cost_type==="Monthly rental");
    const rentalMonths=new Set(rentalRows.map(row=>row.month));
    const monthlyRental=rentalMonths.size?sum(rentalRows)/rentalMonths.size:0;
    const variable=total-sum(rentalRows);
    const cards=[
      [view.fiscalYear==="all"?"Total workplace cost":`${view.fiscalYear} workplace cost`,money(total),view.months.length?`${view.months.length} loaded month${view.months.length===1?"":"s"}`:"No loaded months",COLORS.rental],
      ["Latest monthly cost",latestMonth?money(latest):"—",latestMonth?`${monthLabel(latestMonth)}${movement==null?"":` · ${movement>=0?"+":""}${percent(movement)} vs prior loaded month`}`:"No monthly data",movement>0?COLORS.danger:COLORS.rental],
      ["Committed monthly rental",monthlyRental?money(monthlyRental):"—",rentalMonths.size?`Average across ${rentalMonths.size} rental month${rentalMonths.size===1?"":"s"}`:"No monthly rental recognised",COLORS.accent],
      ["Additional cost",money(variable),total?`${percent(variable/total)} of selected workplace cost`:"No additional costs",COLORS.variable],
    ];
    document.querySelector("#workplaceKpis").innerHTML=cards.map(([label,value,note,color])=>`<article class="kpi" style="--accent:${color}"><div class="kpi-label">${escapeHtml(label)}</div><div class="kpi-value">${escapeHtml(value)}</div><div class="kpi-note">${escapeHtml(note)}</div></article>`).join("");
  }

  function renderTrend(view){
    const chart=document.querySelector("#workplaceTrendChart");
    const legend=document.querySelector("#workplaceTrendLegend");
    if(!view.months.length){chart.innerHTML='<div class="empty">No workplace cost trend is available</div>';legend.replaceChildren();return;}
    const grouped=view.months.map(month=>({month,rows:view.records.filter(row=>row.month===month).sort((a,b)=>(a.cost_type==="Monthly rental"?-1:1)-(b.cost_type==="Monthly rental"?-1:1))}));
    const totals=grouped.map(group=>sum(group.rows));
    const max=Math.max(1,...totals)*1.15;
    const W=Math.max(820,view.months.length*70),H=320,p={l:72,r:20,t:28,b:48},plotW=W-p.l-p.r,plotH=H-p.t-p.b;
    const slot=plotW/view.months.length,barWidth=Math.min(42,slot*.62),y=value=>p.t+plotH-value/max*plotH;
    let svg=`<svg viewBox="0 0 ${W} ${H}" style="min-width:${Math.max(720,view.months.length*58)}px" role="img" aria-label="Monthly workplace cost split into rental and additional invoices">`;
    for(let index=0;index<=4;index++){
      const value=max*index/4,axisY=p.t+plotH-index*plotH/4;
      svg+=`<line class="gridline" x1="${p.l}" x2="${W-p.r}" y1="${axisY}" y2="${axisY}"/><text class="axis-label" x="${p.l-10}" y="${axisY+4}" text-anchor="end">${escapeHtml(compact(value))}</text>`;
    }
    grouped.forEach((group,index)=>{
      const center=p.l+slot*(index+.5),x=center-barWidth/2;
      let cumulative=0;
      group.rows.forEach(row=>{
        const value=Number(row.amount_inr||0),height=value/max*plotH,segmentY=y(cumulative+value);
        const rental=row.cost_type==="Monthly rental";
        const lines=[`Description: ${row.description}`,`Amount: ${money(value)}`,`Invoice: ${row.invoice_number}`,`Period: ${row.period}`];
        svg+=`<rect class="${rental?"workplace-rental-segment":"workplace-variable-segment"} chart-tooltip-target" x="${x}" y="${segmentY}" width="${barWidth}" height="${Math.max(1,height)}" tabindex="0" role="img" aria-label="${escapeHtml(lines.join(". "))}" data-chart-tooltip data-tooltip-title="${escapeHtml(row.cost_type)}" data-tooltip-lines="${tooltipLines(lines)}"><title>${escapeHtml(lines.join(". "))}</title></rect>`;
        cumulative+=value;
      });
      svg+=`<text class="workplace-total-label" x="${center}" y="${Math.max(14,y(totals[index])-8)}" text-anchor="middle">${escapeHtml(compact(totals[index]))}</text><text class="axis-label" x="${center}" y="${H-18}" text-anchor="middle">${escapeHtml(monthLabel(group.month).replace(" "," ’"))}</text>`;
    });
    svg+="</svg>";
    chart.innerHTML=svg;
    legend.innerHTML=`<span><i style="background:${COLORS.rental}"></i>Monthly rental</span><span><i style="background:${COLORS.variable}"></i>Additional cost</span>`;
  }

  function renderAdditional(view){
    const chart=document.querySelector("#workplaceAdditionalChart");
    const rows=view.records.filter(row=>row.cost_type!=="Monthly rental").sort((a,b)=>a.date.localeCompare(b.date)).slice(-12);
    if(!rows.length){chart.innerHTML='<div class="empty">No additional workplace cost events in this selection</div>';return;}
    const max=Math.max(1,...rows.map(row=>Number(row.amount_inr||0)));
    const W=900,H=Math.max(250,rows.length*38+30),p={l:130,r:255,t:12,b:18},plotW=W-p.l-p.r,rowH=(H-p.t-p.b)/rows.length;
    let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Additional workplace costs by invoice date">`;
    rows.forEach((row,index)=>{
      const y=p.t+index*rowH+5,value=Number(row.amount_inr||0),width=value/max*plotW;
      const lines=[`Description: ${row.description}`,`Amount: ${money(value)}`,`Invoice: ${row.invoice_number}`,`Date: ${shortDate(row.date)}`];
      svg+=`<text class="bar-label" x="${p.l-12}" y="${y+16}" text-anchor="end">${escapeHtml(monthLabel(row.month))}</text><rect class="workplace-event-bar chart-tooltip-target" x="${p.l}" y="${y}" width="${Math.max(2,width)}" height="22" rx="5" fill="${COLORS.variable}" tabindex="0" role="img" aria-label="${escapeHtml(lines.join(". "))}" data-chart-tooltip data-tooltip-title="Additional cost" data-tooltip-lines="${tooltipLines(lines)}"><title>${escapeHtml(lines.join(". "))}</title></rect><text class="value-label" x="${p.l+width+9}" y="${y+16}">${escapeHtml(money(value))}</text><text class="secondary-label chart-tooltip-target" x="${W-p.r+145}" y="${y+16}" text-anchor="middle" tabindex="0" role="img" aria-label="${escapeHtml(lines.join(". "))}" data-chart-tooltip data-tooltip-title="${escapeHtml(row.description)}" data-tooltip-lines="${tooltipLines([`Amount: ${money(value)}`,`Invoice: ${row.invoice_number}`,`Date: ${shortDate(row.date)}`])}">${escapeHtml(row.description.length>34?`${row.description.slice(0,33)}…`:row.description)}<title>${escapeHtml(row.description)}</title></text>`;
    });
    svg+="</svg>";
    chart.innerHTML=svg;
  }

  function renderTable(view){
    const rows=[...view.records].sort((a,b)=>b.date.localeCompare(a.date));
    document.querySelector("#workplaceRowCount").textContent=`${rows.length} invoice${rows.length===1?"":"s"}`;
    document.querySelector("#workplaceDetailRows").innerHTML=rows.length?rows.map(row=>`<tr><td><b>${escapeHtml(row.invoice_number)}</b></td><td>${escapeHtml(shortDate(row.date))}</td><td>${escapeHtml(row.period)}</td><td class="workplace-description-cell">${escapeHtml(row.description)}</td><td>${escapeHtml(row.cost_type)}</td><td class="numeric">${escapeHtml(money(row.amount_inr))}</td></tr>`).join(""):'<tr><td colspan="6" class="table-empty">No workplace invoices found for this selection</td></tr>';
  }

  async function openContract(identifier){
    const status=document.querySelector("#workplaceStatus");
    try{
      const api=global.pywebview?.api;
      if(!api||typeof api.open_contract!=="function")throw new Error("Contract files can be opened from the desktop application.");
      const result=await api.open_contract(identifier);
      if(!result?.ok)throw new Error(result?.error||"The contract could not be opened.");
    }catch(error){status.textContent=error.message||String(error);}
  }

  function renderContracts(){
    const contracts=payload.contracts||[];
    document.querySelector("#contractCount").textContent=`${contracts.length} file${contracts.length===1?"":"s"}`;
    const grid=document.querySelector("#contractGrid");
    grid.innerHTML=contracts.length?contracts.map(contract=>`<button class="contract-item" type="button" data-contract-id="${escapeHtml(contract.id)}" title="Double-click to open ${escapeHtml(contract.name)}"><span class="contract-icon" aria-hidden="true">${ICONS[contract.icon]||ICONS.file}</span><span class="contract-name">${escapeHtml(contract.name)}</span><span class="contract-meta">${escapeHtml(contract.extension)} · double-click to open</span></button>`).join(""):'<div class="contract-empty">No contract files found in the contracts folder.</div>';
  }

  function render(){
    if(!payload.records?.length){clear("No recognised workplace workbooks were found under the workplace folder.");return;}
    const view=currentView();
    renderForecast();
    renderKpis(view);
    renderTrend(view);
    renderAdditional(view);
    renderTable(view);
    renderContracts();
    const warnings=[];
    if(payload.meta.duplicate_count)warnings.push(`${payload.meta.duplicate_count} duplicate invoice${payload.meta.duplicate_count===1?"":"s"} ignored`);
    if(payload.meta.conflicting_duplicates)warnings.push(`${payload.meta.conflicting_duplicates} conflicting duplicate${payload.meta.conflicting_duplicates===1?"":"s"}`);
    if(payload.meta.period_mismatches)warnings.push(`${payload.meta.period_mismatches} Date/Period mismatch${payload.meta.period_mismatches===1?"":"es"}`);
    const selection=view.fiscalYear==="all"?"all financial years":`${view.fiscalYear} · ${view.fiscalMeta?.loaded_months||view.months.length}/12 months loaded`;
    document.querySelector("#workplaceStatus").textContent=`Loaded ${payload.meta.record_count} invoices from ${payload.meta.file_count} workbook${payload.meta.file_count===1?"":"s"} · ${selection}${warnings.length?` · ${warnings.join(" · ")}`:""}`;
  }

  async function load(){
    document.querySelector("#workplaceStatus").textContent="Scanning local workplace files…";
    try{
      const response=await fetch("/api/workplace",{cache:"no-store"});
      const result=await response.json();
      if(!response.ok||result.error)throw new Error(result.error||"Workplace data could not be loaded.");
      payload=result;
      populateFilter();
      render();
      return payload;
    }catch(error){
      payload={records:[],contracts:[],forecast:{},meta:{}};
      clear(error.message||String(error));
      return payload;
    }
  }

  document.querySelector("#workplaceFyFilter").addEventListener("change",render);
  document.querySelector("#contractGrid").addEventListener("dblclick",event=>{
    const item=event.target.closest("[data-contract-id]");
    if(item)void openContract(item.dataset.contractId);
  });
  document.querySelector("#contractGrid").addEventListener("keydown",event=>{
    const item=event.target.closest("[data-contract-id]");
    if(item&&event.key==="Enter")void openContract(item.dataset.contractId);
  });

  global.WorkplaceDashboard={
    load,
    render,
    getContext:()=>({fiscal_year:document.querySelector("#workplaceFyFilter").value||"all"}),
    getPayload:()=>payload,
  };
})(window);
