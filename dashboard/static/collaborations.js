(function initialiseCollaborationDashboard(global){
  const STATUS_COLORS={completed:"#087f52",ongoing:"#d97706",planned:"#2f80ed"};
  const EXTRA_COLORS=["#8a63d2","#d9488c","#0891b2","#65a30d","#dc2626","#64748b","#0f766e"];
  const TEAM_COLORS=["#087f52","#2f80ed","#8a63d2","#d97706","#0891b2","#d9488c","#65a30d","#0f766e","#dc2626","#64748b"];
  let payload={records:[],meta:{}};

  const escapeHtml=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  const monthLabel=iso=>new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN",{month:"short",year:"numeric"});
  const number=value=>new Intl.NumberFormat("en-IN",{maximumFractionDigits:1}).format(value||0);
  const percent=value=>new Intl.NumberFormat("en-IN",{style:"percent",maximumFractionDigits:1}).format(value||0);
  const shorten=(value,length)=>String(value||"").length>length?`${String(value).slice(0,length-1)}…`:String(value||"");
  const tooltipLines=lines=>escapeHtml(JSON.stringify(lines));

  function orderedStatuses(records=payload.records){
    const statuses=[...new Set(records.map(row=>row.status).filter(Boolean))];
    const preferred={completed:0,ongoing:1,planned:2};
    return statuses.sort((left,right)=>(preferred[left.toLowerCase()]??99)-(preferred[right.toLowerCase()]??99)||left.localeCompare(right));
  }

  function statusColor(status){
    const normalized=String(status||"").toLowerCase();
    if(STATUS_COLORS[normalized])return STATUS_COLORS[normalized];
    let hash=0;
    for(const character of normalized)hash=(hash*31+character.charCodeAt(0))>>>0;
    return EXTRA_COLORS[hash%EXTRA_COLORS.length];
  }

  function teamColor(team){
    let hash=0;
    for(const character of String(team||""))hash=(hash*31+character.charCodeAt(0))>>>0;
    return TEAM_COLORS[hash%TEAM_COLORS.length];
  }

  function options(select,values,allLabel,formatter=value=>value){
    const previous=select.value||"all";
    select.innerHTML=`<option value="all">${escapeHtml(allLabel)}</option>`+values.map(value=>`<option value="${escapeHtml(value)}">${escapeHtml(formatter(value))}</option>`).join("");
    select.value=[...select.options].some(option=>option.value===previous)?previous:"all";
  }

  function updateMonthFilter(){
    const planYear=document.querySelector("#collaborationPyFilter").value||"all";
    const months=[...new Set(payload.records.filter(row=>planYear==="all"||row.plan_year===planYear).map(row=>row.month))].sort().reverse();
    options(document.querySelector("#collaborationMonthFilter"),months,"All months",monthLabel);
  }

  function populateFilters(){
    const planYears=(payload.meta?.plan_years||[]).map(item=>item.label).reverse();
    options(document.querySelector("#collaborationPyFilter"),planYears,"All PYs");
    options(document.querySelector("#collaborationDepartmentFilter"),payload.meta?.departments||[],"All departments");
    options(document.querySelector("#collaborationStatusFilter"),orderedStatuses(),"All statuses");
    updateMonthFilter();
  }

  function currentView(){
    const planYear=document.querySelector("#collaborationPyFilter").value||"all";
    const month=document.querySelector("#collaborationMonthFilter").value||"all";
    const department=document.querySelector("#collaborationDepartmentFilter").value||"all";
    const status=document.querySelector("#collaborationStatusFilter").value||"all";
    const records=payload.records.filter(row=>(planYear==="all"||row.plan_year===planYear)&&(month==="all"||row.month===month)&&(department==="all"||row.department===department)&&(status==="all"||row.status===status));
    return {planYear,month,department,status,records,months:[...new Set(records.map(row=>row.month))].sort()};
  }

  function clear(message){
    document.querySelector("#collaborationStatus").textContent=message;
    document.querySelector("#collaborationKpis").replaceChildren();
    document.querySelector("#collaborationTeamChart").innerHTML='<div class="empty">No team activity is available</div>';
    document.querySelector("#collaborationDetailRows").innerHTML='<tr><td colspan="6" class="table-empty">No collaboration activities found</td></tr>';
    document.querySelector("#collaborationRowCount").textContent="";
  }

  function renderKpis(view){
    const teams=new Set(view.records.map(row=>row.department));
    const cards=[
      ["Total Activities",number(view.records.length),`${view.months.length} active month${view.months.length===1?"":"s"}`,"#087f52"],
      ["Teams assisted",number(teams.size),teams.size?`${number(view.records.length/teams.size)} activities per team` : "No teams in this selection","#2f80ed"],
      ...orderedStatuses(view.records).map(status=>{
        const count=view.records.filter(row=>row.status===status).length;
        return [status,number(count),view.records.length?`${percent(count/view.records.length)} of selected activities`:"No matching activities",statusColor(status)];
      }),
    ];
    document.querySelector("#collaborationKpis").innerHTML=cards.map(([label,value,note,color])=>`<article class="kpi" style="--accent:${color}"><div class="kpi-label">${escapeHtml(label)}</div><div class="kpi-value">${escapeHtml(value)}</div><div class="kpi-note">${escapeHtml(note)}</div></article>`).join("");
  }

  function renderTeams(view){
    const chart=document.querySelector("#collaborationTeamChart");
    if(!view.records.length){chart.innerHTML='<div class="empty">No team activity for this selection</div>';return;}
    const teams=[...new Set(view.records.map(row=>row.department))].map(team=>({
      team,
      rows:view.records.filter(row=>row.department===team),
    })).sort((left,right)=>right.rows.length-left.rows.length||left.team.localeCompare(right.team));
    const total=view.records.length;
    const W=280,H=280,cx=140,cy=140,r=118;
    let startAngle=-Math.PI/2;
    let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Share of selected activities by team">`;
    teams.forEach(item=>{
      const count=item.rows.length,share=count/total,endAngle=startAngle+share*Math.PI*2;
      const color=teamColor(item.team);
      const activityLines=[`Activities: ${count}`,...item.rows.map((row,index)=>`${index+1}. ${row.activity}`)];
      const tooltipTitle=`${item.team} · ${count} activit${count===1?"y":"ies"}`;
      const accessibleLabel=`${item.team}. ${count} activities. ${percent(share)} of selected activities.`;
      const tooltipAttributes=`tabindex="0" role="img" aria-label="${escapeHtml(accessibleLabel)}" data-chart-tooltip data-tooltip-title="${escapeHtml(tooltipTitle)}" data-tooltip-lines="${tooltipLines(activityLines)}"`;
      if(teams.length===1){
        svg+=`<circle class="collaboration-team-slice chart-tooltip-target" cx="${cx}" cy="${cy}" r="${r}" fill="${color}" ${tooltipAttributes}><title>${escapeHtml(accessibleLabel)}</title></circle>`;
      }else{
        const x1=cx+r*Math.cos(startAngle),y1=cy+r*Math.sin(startAngle);
        const x2=cx+r*Math.cos(endAngle),y2=cy+r*Math.sin(endAngle);
        const largeArc=share>.5?1:0;
        svg+=`<path class="collaboration-team-slice chart-tooltip-target" d="M${cx} ${cy} L${x1} ${y1} A${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z" fill="${color}" ${tooltipAttributes}><title>${escapeHtml(accessibleLabel)}</title></path>`;
      }
      if(share>=.07){
        const labelAngle=startAngle+share*Math.PI,labelRadius=r*.64;
        svg+=`<text class="pie-label" x="${cx+labelRadius*Math.cos(labelAngle)}" y="${cy+labelRadius*Math.sin(labelAngle)+4}">${count}</text>`;
      }
      startAngle=endAngle;
    });
    svg+="</svg>";
    const legend=teams.map(item=>{
      const count=item.rows.length,share=count/total;
      const lines=[`Activities: ${count}`,...item.rows.map((row,index)=>`${index+1}. ${row.activity}`)];
      return `<div class="pie-legend-row collaboration-team-legend-row chart-tooltip-target" tabindex="0" role="img" aria-label="${escapeHtml(`${item.team}. ${count} activities.`)}" data-chart-tooltip data-tooltip-title="${escapeHtml(`${item.team} · ${count} activit${count===1?"y":"ies"}`)}" data-tooltip-lines="${tooltipLines(lines)}"><i style="background:${teamColor(item.team)}"></i><span title="${escapeHtml(item.team)}">${escapeHtml(item.team)}</span><b>${count}<small>${percent(share)}</small></b></div>`;
    }).join("");
    chart.innerHTML=`<div class="pie-layout collaboration-team-pie-layout">${svg}<div class="pie-legend collaboration-team-legend">${legend}</div></div>`;
  }

  function renderStatusLegend(element,records){
    element.innerHTML=orderedStatuses(records).map(status=>`<span><i style="background:${statusColor(status)}"></i>${escapeHtml(status)}</span>`).join("");
  }

  function renderMonthly(view){
    const chart=document.querySelector("#collaborationMonthlyChart");
    const legend=document.querySelector("#collaborationMonthlyLegend");
    if(!view.records.length){chart.innerHTML='<div class="empty">No monthly collaboration activity for this selection</div>';legend.replaceChildren();return;}
    const statuses=orderedStatuses(view.records);
    const grouped=view.months.map(month=>({month,rows:view.records.filter(row=>row.month===month)}));
    const max=Math.max(4,...grouped.map(group=>group.rows.length));
    const W=Math.max(760,grouped.length*84),H=310,p={l:55,r:18,t:30,b:48},plotW=W-p.l-p.r,plotH=H-p.t-p.b;
    const slot=plotW/grouped.length,barWidth=Math.min(48,slot*.62),y=value=>p.t+plotH-value/max*plotH;
    let svg=`<svg viewBox="0 0 ${W} ${H}" style="min-width:${Math.max(640,grouped.length*72)}px" role="img" aria-label="Monthly collaboration activities split by status">`;
    for(let index=0;index<=4;index++){
      const value=Math.round(max*index/4),axisY=p.t+plotH-index*plotH/4;
      svg+=`<line class="gridline" x1="${p.l}" x2="${W-p.r}" y1="${axisY}" y2="${axisY}"/><text class="axis-label" x="${p.l-9}" y="${axisY+4}" text-anchor="end">${value}</text>`;
    }
    grouped.forEach((group,index)=>{
      const center=p.l+slot*(index+.5),x=center-barWidth/2;
      let cumulative=0;
      statuses.forEach(status=>{
        const rows=group.rows.filter(row=>row.status===status),count=rows.length;
        if(!count)return;
        const segmentY=y(cumulative+count),height=count/max*plotH;
        const teams=new Set(rows.map(row=>row.department));
        const lines=[`Collaborations: ${count}`,`Teams assisted: ${teams.size}`,`Monthly share: ${percent(count/group.rows.length)}`];
        svg+=`<rect class="collaboration-segment chart-tooltip-target" x="${x}" y="${segmentY}" width="${barWidth}" height="${Math.max(2,height)}" fill="${statusColor(status)}" tabindex="0" role="img" aria-label="${escapeHtml(`${monthLabel(group.month)}. ${status}. ${lines.join(". ")}`)}" data-chart-tooltip data-tooltip-title="${escapeHtml(`${monthLabel(group.month)} · ${status}`)}" data-tooltip-lines="${tooltipLines(lines)}"><title>${escapeHtml(lines.join(". "))}</title></rect>`;
        cumulative+=count;
      });
      svg+=`<text class="total-label" x="${center}" y="${Math.max(15,y(group.rows.length)-8)}" text-anchor="middle">${group.rows.length}</text><text class="axis-label" x="${center}" y="${H-18}" text-anchor="middle">${escapeHtml(compactMonth(group.month))}</text>`;
    });
    chart.innerHTML=svg+"</svg>";
    renderStatusLegend(legend,view.records);
  }

  function renderDepartments(view){
    const chart=document.querySelector("#collaborationDepartmentChart");
    const legend=document.querySelector("#collaborationDepartmentLegend");
    if(!view.records.length){chart.innerHTML='<div class="empty">No department coverage for this selection</div>';legend.replaceChildren();return;}
    const statuses=orderedStatuses(view.records);
    const departments=[...new Set(view.records.map(row=>row.department))].map(department=>({department,rows:view.records.filter(row=>row.department===department)})).sort((a,b)=>b.rows.length-a.rows.length||a.department.localeCompare(b.department));
    const max=Math.max(4,...departments.map(item=>item.rows.length));
    const W=820,H=Math.max(290,departments.length*48+45),p={l:235,r:45,t:18,b:35},plotW=W-p.l-p.r,rowH=(H-p.t-p.b)/departments.length;
    const x=value=>p.l+value/max*plotW;
    let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Departments assisted split by collaboration status">`;
    for(let index=0;index<=4;index++){
      const value=Math.round(max*index/4),axisX=p.l+plotW*index/4;
      svg+=`<line class="gridline" x1="${axisX}" x2="${axisX}" y1="${p.t}" y2="${H-p.b}"/><text class="axis-label" x="${axisX}" y="${H-12}" text-anchor="middle">${value}</text>`;
    }
    departments.forEach((item,index)=>{
      const cy=p.t+index*rowH+rowH/2;
      let cumulative=0;
      const departmentLabel=shorten(item.department,30);
      svg+=`<text class="bar-label chart-tooltip-target" x="${p.l-12}" y="${cy+4}" text-anchor="end" tabindex="0" role="img" aria-label="${escapeHtml(item.department)}" data-chart-tooltip data-tooltip-title="${escapeHtml(item.department)}" data-tooltip-line-one="Collaborations: ${item.rows.length}">${escapeHtml(departmentLabel)}<title>${escapeHtml(item.department)}</title></text>`;
      statuses.forEach(status=>{
        const rows=item.rows.filter(row=>row.status===status),count=rows.length;
        if(!count)return;
        const start=x(cumulative),width=count/max*plotW;
        const activities=rows.slice(0,3).map(row=>row.activity);
        const lines=[`Collaborations: ${count}`,...activities.map(activity=>`Activity: ${activity}`),...(rows.length>3?[`Plus ${rows.length-3} more`]:[])];
        svg+=`<rect class="collaboration-segment chart-tooltip-target" x="${start}" y="${cy-9}" width="${Math.max(2,width)}" height="18" rx="4" fill="${statusColor(status)}" tabindex="0" role="img" aria-label="${escapeHtml(`${item.department}. ${status}. ${count} collaborations.`)}" data-chart-tooltip data-tooltip-title="${escapeHtml(`${item.department} · ${status}`)}" data-tooltip-lines="${tooltipLines(lines)}"><title>${escapeHtml(lines.join(". "))}</title></rect>`;
        cumulative+=count;
      });
      svg+=`<text class="value-label" x="${x(item.rows.length)+8}" y="${cy+4}">${item.rows.length}</text>`;
    });
    chart.innerHTML=svg+"</svg>";
    renderStatusLegend(legend,view.records);
  }

  function renderPlanYears(view){
    const chart=document.querySelector("#collaborationPyChart");
    if(!view.records.length){chart.innerHTML='<div class="empty">No Plan Year comparison for this selection</div>';return;}
    const years=[...new Set(view.records.map(row=>row.plan_year))].sort().map(planYear=>{
      const rows=view.records.filter(row=>row.plan_year===planYear);
      return {planYear,collaborations:rows.length,teams:new Set(rows.map(row=>row.department)).size};
    });
    const max=Math.max(4,...years.flatMap(item=>[item.collaborations,item.teams]));
    const W=Math.max(520,years.length*150),H=290,p={l:55,r:18,t:28,b:47},plotW=W-p.l-p.r,plotH=H-p.t-p.b,slot=plotW/years.length;
    const barWidth=Math.min(34,slot*.25),y=value=>p.t+plotH-value/max*plotH;
    let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Plan Year comparison of collaboration activities and teams assisted">`;
    for(let index=0;index<=4;index++){
      const value=Math.round(max*index/4),axisY=p.t+plotH-index*plotH/4;
      svg+=`<line class="gridline" x1="${p.l}" x2="${W-p.r}" y1="${axisY}" y2="${axisY}"/><text class="axis-label" x="${p.l-9}" y="${axisY+4}" text-anchor="end">${value}</text>`;
    }
    years.forEach((item,index)=>{
      const center=p.l+slot*(index+.5);
      [["Collaborations",item.collaborations,"#087f52",center-barWidth-3],["Teams assisted",item.teams,"#2f80ed",center+3]].forEach(([label,value,color,x])=>{
        const top=y(value),height=p.t+plotH-top;
        svg+=`<rect class="collaboration-segment chart-tooltip-target" x="${x}" y="${top}" width="${barWidth}" height="${Math.max(2,height)}" rx="5" fill="${color}" tabindex="0" role="img" aria-label="${escapeHtml(`${item.planYear}. ${label}: ${value}.`)}" data-chart-tooltip data-tooltip-title="${escapeHtml(item.planYear)}" data-tooltip-line-one="${escapeHtml(`${label}: ${value}`)}"><title>${escapeHtml(`${label}: ${value}`)}</title></rect><text class="value-label" x="${Number(x)+barWidth/2}" y="${Math.max(15,top-7)}" text-anchor="middle">${value}</text>`;
      });
      svg+=`<text class="axis-label" x="${center}" y="${H-17}" text-anchor="middle">${escapeHtml(item.planYear)}</text>`;
    });
    chart.innerHTML=svg+"</svg>";
  }

  function detailText(value,label,length){
    if(!value)return '<span class="collaboration-empty-value">—</span>';
    return `<span class="collaboration-truncated chart-tooltip-target" tabindex="0" data-chart-tooltip data-tooltip-title="${escapeHtml(label)}" data-tooltip-line-one="${escapeHtml(value)}">${escapeHtml(shorten(value,length))}</span>`;
  }

  function renderTable(view){
    const rows=[...view.records].sort((a,b)=>b.month.localeCompare(a.month)||a.department.localeCompare(b.department)||a.activity.localeCompare(b.activity));
    document.querySelector("#collaborationRowCount").textContent=`${rows.length} collaboration${rows.length===1?"":"s"}`;
    document.querySelector("#collaborationDetailRows").innerHTML=rows.length?rows.map(row=>`<tr><td>${escapeHtml(monthLabel(row.month))}</td><td><b>${escapeHtml(row.department)}</b></td><td class="collaboration-text-cell">${detailText(row.activity,"Activity / Collaboration",48)}</td><td><span class="collaboration-status-chip" style="--status-color:${statusColor(row.status)}">${escapeHtml(row.status)}</span></td><td class="collaboration-text-cell">${detailText(row.timeline,"Timeline",38)}</td><td class="collaboration-text-cell">${detailText(row.outcome,"Outcome",58)}</td></tr>`).join(""):'<tr><td colspan="6" class="table-empty">No collaboration activities found for this selection</td></tr>';
  }

  function render(){
    if(!payload.records?.length){
      const message=payload.meta?.sheet_found===false
        ?`Add a sheet named “Facilities Team Collaboration” to the expense workbook to use this tab.`
        :"The collaboration sheet contains no valid rows.";
      clear(message);
      return;
    }
    const view=currentView();
    renderKpis(view);
    renderTeams(view);
    renderTable(view);
    const warnings=[];
    if(payload.meta.invalid_rows)warnings.push(`${payload.meta.invalid_rows} invalid row${payload.meta.invalid_rows===1?"":"s"} ignored`);
    if(payload.meta.duplicate_count)warnings.push(`${payload.meta.duplicate_count} exact duplicate${payload.meta.duplicate_count===1?"":"s"} ignored`);
    if(payload.meta.conflicting_duplicates)warnings.push(`${payload.meta.conflicting_duplicates} updated duplicate${payload.meta.conflicting_duplicates===1?"":"s"} resolved using the last row`);
    const scope=[view.planYear==="all"?"All PYs":view.planYear,view.month==="all"?"All months":monthLabel(view.month),view.department==="all"?"All departments":view.department,view.status==="all"?"All statuses":view.status].join(" · ");
    document.querySelector("#collaborationStatus").textContent=`Showing ${view.records.length} of ${payload.meta.record_count} activities · ${scope}${warnings.length?` · ${warnings.join(" · ")}`:""}`;
  }

  async function load(){
    document.querySelector("#collaborationStatus").textContent="Loading collaboration activity…";
    try{
      const response=await fetch("/api/collaborations",{cache:"no-store"});
      const result=await response.json();
      if(!response.ok||result.error)throw new Error(result.error||"Collaboration data could not be loaded.");
      payload=result;
      populateFilters();
      render();
      return payload;
    }catch(error){
      payload={records:[],meta:{}};
      clear(error.message||String(error));
      return payload;
    }
  }

  document.querySelector("#collaborationPyFilter").addEventListener("change",()=>{updateMonthFilter();render();});
  document.querySelectorAll("#collaborationMonthFilter,#collaborationDepartmentFilter,#collaborationStatusFilter").forEach(element=>element.addEventListener("change",render));

  global.CollaborationDashboard={
    load,
    render,
    getContext:()=>({
      plan_year:document.querySelector("#collaborationPyFilter").value||"all",
      month:document.querySelector("#collaborationMonthFilter").value||"all",
      department:document.querySelector("#collaborationDepartmentFilter").value||"all",
      status:document.querySelector("#collaborationStatusFilter").value||"all",
    }),
    getPayload:()=>payload,
  };
})(window);
