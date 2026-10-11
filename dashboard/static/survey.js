(function initialiseSurveyDashboard(global){
  const TREND_SERIES=[
    {key:"overall",label:"Overall",color:"#087f52",kind:"stars",value:period=>period.overall_favorable_rate,average:period=>period.overall_average,distribution:period=>period.rating_distributions?.overall||{}},
    {key:"enhancements",label:"Workplace enhancements",color:"#2f80ed",kind:"stars",value:period=>period.enhancement_favorable_rate,average:period=>period.enhancement_average,distribution:period=>period.rating_distributions?.enhancements||{}},
    {key:"food",label:"Lunch / food & beverages",color:"#d97706",kind:"satisfaction",value:period=>period.food_satisfaction_rate,distribution:period=>period.satisfaction_distributions?.food||{}},
    {key:"work_areas",label:"Work Areas",color:"#7c3aed",kind:"satisfaction"},
    {key:"meeting_rooms",label:"Meeting Rooms",color:"#db2777",kind:"satisfaction"},
    {key:"pantry",label:"Pantry",color:"#0891b2",kind:"satisfaction"},
    {key:"washroom",label:"Washroom",color:"#dc2626",kind:"satisfaction"},
    {key:"environment",label:"Environment",color:"#65a30d",kind:"satisfaction"},
    {key:"reception",label:"Reception Area",color:"#9333ea",kind:"satisfaction"},
    {key:"kitchen_breakout",label:"Kitchen / Breakout",color:"#0f766e",kind:"satisfaction"},
  ];
  const RATING_COLORS={"1":"#c9364f","2":"#e77a55","3":"#f2c14e","4":"#79b77a","5":"#087f52"};
  let payload={periods:[],meta:{}};
  const hiddenTrendSeries=new Set();
  const commentSummaries=new Map();
  let summaryBusy=false;
  let pendingSummarySelection="";
  let pendingSummaryRevision="";
  let commentDataRevision="";

  const escapeHtml=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  const monthLabel=iso=>new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN",{month:"short",year:"numeric"});
  const shortMonth=iso=>new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN",{month:"short",year:"2-digit"});
  const percent=value=>value==null?"—":`${Number(value).toFixed(1)}%`;
  const score=value=>value==null?"—":`${Number(value).toFixed(2)} ⭐`;
  const delta=(current,previous,suffix=" pp")=>{
    if(current==null||previous==null)return "No prior survey comparison";
    const difference=Number(current)-Number(previous);
    return `${difference>=0?"+":""}${difference.toFixed(1)}${suffix} vs previous survey`;
  };

  function clear(message){
    document.querySelector("#surveyStatus").textContent=message;
    document.querySelector("#surveyKpis").replaceChildren();
    ["surveyRatingTrendChart","surveyParticipationChart","surveyTouchpointChart","surveyRatingChart"].forEach(id=>document.querySelector(`#${id}`).replaceChildren());
    document.querySelector("#surveyRatingTrendLegend").replaceChildren();
    document.querySelector("#surveyCommentList").innerHTML='<div class="survey-comments-empty">No survey comments are available.</div>';
    document.querySelector("#surveyCommentCount").textContent="0 comments";
    renderSummary("all");
  }

  function populateFilter(){
    const select=document.querySelector("#surveyMonthFilter");
    const previous=select.value||"all";
    select.innerHTML='<option value="all">All surveys</option>'+[...payload.periods].reverse().map(period=>`<option value="${period.month}">${escapeHtml(monthLabel(period.month))}</option>`).join("");
    select.value=[...select.options].some(option=>option.value===previous)?previous:"all";
  }

  function currentView(){
    const selection=document.querySelector("#surveyMonthFilter").value||"all";
    const focusIndex=selection==="all"?payload.periods.length-1:payload.periods.findIndex(period=>period.month===selection);
    const index=focusIndex>=0?focusIndex:payload.periods.length-1;
    return {
      selection,
      current:payload.periods[index]||null,
      previous:index>0?payload.periods[index-1]:null,
      periods:payload.periods,
    };
  }

  function renderKpis(view){
    const current=view.current;
    const previous=view.previous;
    const touchpoints=Object.values(current.touchpoints||{}).filter(item=>item.rate!=null);
    const ranked=[...touchpoints].sort((a,b)=>b.rate-a.rate);
    const strongest=ranked[0];
    const priority=ranked.at(-1);
    const cards=[
      ["Responses",String(current.response_count||0),`${monthLabel(current.month)} survey base`,"#087f52"],
      ["Overall experience",score(current.overall_average),delta(current.overall_average,previous?.overall_average," points"),"#087f52"],
      ["Positive ratings",percent(current.overall_favorable_rate),`4–5 ⭐ responses · ${delta(current.overall_favorable_rate,previous?.overall_favorable_rate)}`,"#2f80ed"],
      ["Food & beverages",percent(current.food_satisfaction_rate),`Satisfied responses · ${delta(current.food_satisfaction_rate,previous?.food_satisfaction_rate)}`,"#d97706"],
      ["Strongest touchpoint",strongest?percent(strongest.rate):"—",strongest?`${strongest.label} · ${strongest.responses} responses`:"No touchpoint ratings","#00a94f"],
      ["Priority touchpoint",priority?percent(priority.rate):"—",priority?`${priority.label} · ${priority.responses} responses`:"No touchpoint ratings","#d9485f"],
    ];
    document.querySelector("#surveyKpis").innerHTML=cards.map(([label,value,note,color])=>`<article class="kpi" style="--accent:${color}"><div class="kpi-label">${escapeHtml(label)}</div><div class="kpi-value">${escapeHtml(value)}</div><div class="kpi-note">${escapeHtml(note)}</div></article>`).join("");
  }

  function renderTrend(view){
    const ratingChart=document.querySelector("#surveyRatingTrendChart");
    const participationChart=document.querySelector("#surveyParticipationChart");
    const periods=view.periods;
    if(!periods.length){
      ratingChart.innerHTML='<div class="empty">No rating trend is available</div>';
      participationChart.innerHTML='<div class="empty">No participation trend is available</div>';
      return;
    }
    const legend=document.querySelector("#surveyRatingTrendLegend");
    const availableSeries=TREND_SERIES.map(definition=>({
      ...definition,
      value:definition.value||((period)=>period.touchpoints?.[definition.key]?.rate),
      distribution:definition.distribution||((period)=>period.touchpoints?.[definition.key]?.distribution||{}),
    })).filter(definition=>periods.some(period=>definition.value(period)!=null));
    legend.innerHTML=availableSeries.map(item=>{
      const visible=!hiddenTrendSeries.has(item.key);
      return `<button class="survey-series-toggle${visible?"":" is-hidden"}" type="button" aria-pressed="${visible}" data-survey-series="${escapeHtml(item.key)}" title="${visible?"Hide":"Show"} ${escapeHtml(item.label)}"><i style="background:${item.color}"></i>${escapeHtml(item.label)}</button>`;
    }).join("");
    const series=availableSeries.filter(item=>!hiddenTrendSeries.has(item.key));
    const distributionLines=(definition,period)=>{
      const distribution=definition.distribution(period);
      if(definition.kind==="stars"){
        return [
          `Positive response: ${percent(definition.value(period))} (4–5 stars)`,
          `Average rating: ${score(definition.average(period))}`,
          ...[1,2,3,4,5].map(rating=>`${"⭐".repeat(rating)}: ${Number(distribution[String(rating)]||0)} responses`),
        ];
      }
      const order=["Very satisfied","Satisfied","Neutral","Dissatisfied","Very dissatisfied"];
      const available=order.filter(label=>Object.prototype.hasOwnProperty.call(distribution,label));
      return [
        `Positive response: ${percent(definition.value(period))}`,
        ...(available.length?available:["Satisfied","Dissatisfied"]).map(label=>`${label}: ${Number(distribution[label]||0)} responses`),
      ];
    };
    const W=Math.max(650,periods.length*130),H=300,p={l:58,r:22,t:28,b:46},plotW=W-p.l-p.r,plotH=H-p.t-p.b;
    const x=index=>p.l+(periods.length===1?plotW/2:index*plotW/(periods.length-1));
    const visibleValues=series.flatMap(definition=>periods.map(period=>definition.value(period))).filter(value=>value!=null&&Number.isFinite(Number(value))).map(Number);
    let ratingMin=0,ratingMax=100;
    if(visibleValues.length){
      const rawMin=Math.min(...visibleValues),rawMax=Math.max(...visibleValues);
      const desiredSpan=Math.max(20,rawMax-rawMin+10);
      const midpoint=(rawMin+rawMax)/2;
      ratingMin=Math.max(0,Math.floor((midpoint-desiredSpan/2)/5)*5);
      ratingMax=Math.min(100,Math.ceil((midpoint+desiredSpan/2)/5)*5);
      if(ratingMax-ratingMin<20){
        if(ratingMin===0)ratingMax=Math.min(100,20);
        else ratingMin=Math.max(0,ratingMax-20);
      }
    }
    const yRating=value=>p.t+plotH-(Number(value)-ratingMin)/(ratingMax-ratingMin)*plotH;
    const ratingTicks=Array.from({length:5},(_,index)=>ratingMin+(ratingMax-ratingMin)*index/4);
    let ratingSvg=`<svg viewBox="0 0 ${W} ${H}" style="min-width:${Math.max(560,periods.length*105)}px" role="img" aria-label="Quarterly positive response trend for every rated area. Scale ${ratingMin} to ${ratingMax} percent.">`;
    ratingTicks.forEach(value=>{
      const axisY=yRating(value);
      const label=Number.isInteger(value)?value:value.toFixed(1);
      ratingSvg+=`<line class="gridline" x1="${p.l}" x2="${W-p.r}" y1="${axisY}" y2="${axisY}"/><text class="axis-label" x="${p.l-9}" y="${axisY+4}" text-anchor="end">${label}%</text>`;
    });
    series.forEach(definition=>{
      const points=periods.map((period,index)=>({x:x(index),y:yRating(definition.value(period)),value:definition.value(period),period})).filter(point=>point.value!=null);
      if(points.length>1)ratingSvg+=`<path class="survey-trend-line" stroke="${definition.color}" d="${points.map((point,index)=>`${index?"L":"M"}${point.x} ${point.y}`).join(" ")}"/>`;
      points.forEach(point=>{
        const selected=point.period.month===view.current.month;
        const detailLines=distributionLines(definition,point.period);
        const lines=escapeHtml(JSON.stringify(detailLines));
        const title=`${definition.label} · ${monthLabel(point.period.month)}`;
        const accessibleLabel=`${title}. ${detailLines.join(". ")}`;
        ratingSvg+=`<circle class="survey-trend-point chart-tooltip-target" cx="${point.x}" cy="${point.y}" r="${selected?5.5:4}" fill="${definition.color}" tabindex="0" role="img" aria-label="${escapeHtml(accessibleLabel)}" data-chart-tooltip data-tooltip-title="${escapeHtml(title)}" data-tooltip-lines="${lines}"><title>${escapeHtml(accessibleLabel)}</title></circle>`;
      });
    });
    if(!series.length)ratingSvg+=`<text class="survey-empty-selection" x="${p.l+plotW/2}" y="${p.t+plotH/2}" text-anchor="middle">Select an area from the legend to display its trend</text>`;
    periods.forEach((period,index)=>{
      const selected=period.month===view.current.month;
      ratingSvg+=`<text class="axis-label${selected?" survey-selected-label":""}" x="${x(index)}" y="${H-17}" text-anchor="middle">${escapeHtml(shortMonth(period.month))}</text>`;
    });
    ratingSvg+="</svg>";
    ratingChart.innerHTML=ratingSvg;

    const responseMax=Math.max(10,Math.ceil(Math.max(...periods.map(period=>Number(period.response_count)||0))*1.2/10)*10);
    const yResponses=value=>p.t+plotH-(Number(value)||0)/responseMax*plotH;
    // Bars use band centres rather than the line chart's endpoint positions.
    // This leaves half a category of breathing room beside both Y-axis edges,
    // preventing the first bar/value from colliding with the tick labels.
    const responseX=index=>p.l+(index+.5)*plotW/periods.length;
    let participationSvg=`<svg viewBox="0 0 ${W} ${H}" style="min-width:${Math.max(560,periods.length*105)}px" role="img" aria-label="Quarterly anonymous survey responses">`;
    [0,.25,.5,.75,1].forEach(part=>{
      const value=Math.round(responseMax*part),axisY=yResponses(value);
      participationSvg+=`<line class="gridline" x1="${p.l}" x2="${W-p.r}" y1="${axisY}" y2="${axisY}"/><text class="axis-label" x="${p.l-9}" y="${axisY+4}" text-anchor="end">${value}</text>`;
    });
    periods.forEach((period,index)=>{
      const selected=period.month===view.current.month;
      const center=responseX(index),barWidth=Math.min(64,plotW/periods.length*.55);
      const barY=yResponses(period.response_count),barHeight=p.t+plotH-barY;
      const accessibleLabel=`${monthLabel(period.month)}. ${period.response_count||0} anonymous survey responses.`;
      participationSvg+=`<rect class="survey-response-bar chart-tooltip-target${selected?" selected":""}" x="${center-barWidth/2}" y="${barY}" width="${barWidth}" height="${barHeight}" rx="6" tabindex="0" role="img" aria-label="${escapeHtml(accessibleLabel)}" data-chart-tooltip data-tooltip-title="${escapeHtml(monthLabel(period.month))}" data-tooltip-line-one="Survey responses: ${period.response_count||0}"><title>${escapeHtml(accessibleLabel)}</title></rect><text class="survey-response-value" x="${center}" y="${Math.max(18,barY-8)}" text-anchor="middle">${period.response_count||0}</text><text class="axis-label${selected?" survey-selected-label":""}" x="${center}" y="${H-17}" text-anchor="middle">${escapeHtml(shortMonth(period.month))}</text>`;
    });
    participationSvg+="</svg>";
    participationChart.innerHTML=participationSvg;
  }

  function renderTouchpoints(view){
    const chart=document.querySelector("#surveyTouchpointChart");
    const description=document.querySelector("#surveyTouchpointDescription");
    const current=view.current;
    const previous=view.previous;
    const rows=Object.entries(current.touchpoints||{}).map(([key,item])=>({key,...item,previous:previous?.touchpoints?.[key]?.rate})).filter(item=>item.rate!=null).sort((a,b)=>b.rate-a.rate);
    description.textContent=previous?`Ranked by ${monthLabel(current.month)} satisfaction. The thin marker shows ${monthLabel(previous.month)}.`:`Ranked by ${monthLabel(current.month)} satisfaction. Reception Area and Meeting Rooms are measured separately.`;
    if(!rows.length){chart.innerHTML='<div class="empty">No touchpoint ratings are available</div>';return;}
    const W=760,H=Math.max(310,rows.length*48+45),p={l:235,r:112,t:18,b:35},plotW=W-p.l-p.r,rowH=(H-p.t-p.b)/rows.length;
    const x=value=>p.l+(Number(value)||0)/100*plotW;
    let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Ranked workplace touchpoint satisfaction">`;
    [0,25,50,75,100].forEach(value=>{
      const axisX=x(value);
      svg+=`<line class="gridline" x1="${axisX}" x2="${axisX}" y1="${p.t}" y2="${H-p.b}"/><text class="axis-label" x="${axisX}" y="${H-12}" text-anchor="middle">${value}%</text>`;
    });
    rows.forEach((row,index)=>{
      const cy=p.t+index*rowH+rowH/2,currentX=x(row.rate),previousX=row.previous==null?null:x(row.previous);
      const barColor=row.rate>=90?"#087f52":row.rate>=75?"#d97706":"#c9364f";
      const difference=row.previous==null?null:Number(row.rate)-Number(row.previous);
      svg+=`<text class="bar-label" x="${p.l-12}" y="${cy+4}" text-anchor="end">${escapeHtml(row.label)}</text>`;
      svg+=`<rect class="survey-rank-track" x="${p.l}" y="${cy-7}" width="${plotW}" height="14" rx="7"/><rect class="survey-rank-bar" x="${p.l}" y="${cy-7}" width="${Math.max(2,currentX-p.l)}" height="14" rx="7" fill="${barColor}"><title>${escapeHtml(monthLabel(current.month))}: ${percent(row.rate)} from ${row.responses} responses</title></rect>`;
      if(previousX!=null)svg+=`<line class="survey-previous-marker" x1="${previousX}" x2="${previousX}" y1="${cy-12}" y2="${cy+12}"><title>${escapeHtml(monthLabel(previous.month))}: ${percent(row.previous)}</title></line>`;
      svg+=`<text class="value-label" x="${W-p.r+10}" y="${cy+4}">${percent(row.rate)}${difference==null?"":` <tspan class="${difference>=0?"survey-delta-up":"survey-delta-down"}">${difference>=0?"▲":"▼"}${Math.abs(difference).toFixed(1)}</tspan>`}</text>`;
    });
    svg+="</svg>";
    chart.innerHTML=svg;
  }

  function renderRatings(view){
    const chart=document.querySelector("#surveyRatingChart");
    const rows=[
      {label:"Overall experience",distribution:view.current.rating_distributions?.overall||{}},
      {label:"Lunch, snacks & hygiene changes",distribution:view.current.rating_distributions?.enhancements||{}},
    ];
    chart.innerHTML=`<div class="survey-pie-grid">${rows.map(row=>{
      const total=Object.values(row.distribution).reduce((sum,value)=>sum+Number(value||0),0);
      const average=total?[1,2,3,4,5].reduce((sum,rating)=>sum+rating*Number(row.distribution[String(rating)]||0),0)/total:null;
      let startAngle=-Math.PI/2;
      const segments=[1,2,3,4,5].map(rating=>{
        const count=Number(row.distribution[String(rating)]||0),share=total?count/total:0,stars="⭐".repeat(rating);
        if(!count)return "";
        const endAngle=startAngle+share*Math.PI*2;
        const x1=90+70*Math.cos(startAngle),y1=90+70*Math.sin(startAngle);
        const x2=90+70*Math.cos(endAngle),y2=90+70*Math.sin(endAngle);
        const largeArc=share>.5?1:0;
        const midAngle=startAngle+share*Math.PI;
        const labelX=90+43*Math.cos(midAngle),labelY=90+43*Math.sin(midAngle)+3;
        const label=`${row.label}. ${stars}. ${count} responses. ${(share*100).toFixed(1)} percent.`;
        const attributes=`class="survey-pie-segment chart-tooltip-target" fill="${RATING_COLORS[String(rating)]}" tabindex="0" role="img" aria-label="${escapeHtml(label)}" data-chart-tooltip data-tooltip-title="${escapeHtml(`${row.label} · ${stars}`)}" data-tooltip-line-one="Responses: ${count}" data-tooltip-line-two="Share: ${(share*100).toFixed(1)}%"`;
        const shape=share>.9999?`<circle ${attributes} cx="90" cy="90" r="70"><title>${escapeHtml(label)}</title></circle>`:`<path ${attributes} d="M90 90 L${x1} ${y1} A70 70 0 ${largeArc} 1 ${x2} ${y2} Z"><title>${escapeHtml(label)}</title></path>`;
        const sliceLabel=share>=.08?`<text class="survey-pie-slice-label" x="${labelX}" y="${labelY}">${(share*100).toFixed(0)}%</text>`:"";
        startAngle=endAngle;
        return shape+sliceLabel;
      }).join("");
      const keys=[1,2,3,4,5].map(rating=>{
        const count=Number(row.distribution[String(rating)]||0),share=total?count/total:0;
        return `<div><i style="background:${RATING_COLORS[String(rating)]}"></i><span>${"⭐".repeat(rating)}</span><b>${(share*100).toFixed(0)}%</b></div>`;
      }).join("");
      return `<article class="survey-pie-card"><header><div><strong>${escapeHtml(row.label)}</strong><small>${escapeHtml(monthLabel(view.current.month))} · ${total} responses</small></div><b>${average==null?"—":average.toFixed(2)} ⭐ avg</b></header><div class="survey-pie-body"><svg viewBox="0 0 180 180" role="img" aria-label="${escapeHtml(`${row.label} rating distribution`)}">${segments}</svg><div class="survey-pie-key">${keys}</div></div></article>`;
    }).join("")}</div>`;
  }

  function commentsForView(view){
    const periods=view.selection==="all"?payload.periods:payload.periods.filter(period=>period.month===view.selection);
    return periods.flatMap(period=>(period.comments||[]).map(comment=>({...comment,month:period.month})));
  }

  function commentsRevision(source){
    return JSON.stringify((source?.periods||[]).map(period=>[
      period.month,
      ...(period.comments||[]).map(comment=>[comment.topic||"",comment.text||""]),
    ]));
  }

  function summaryEmpty(message="The AI request is made only when you select Summarize."){
    return `<div class="survey-summary-empty"><strong>No summary generated</strong><span>${escapeHtml(message)}</span></div>`;
  }

  function renderSummaryLoading(selection,commentCount){
    const host=document.querySelector("#surveySummaryContent");
    const context=document.querySelector("#surveySummaryContext");
    context.textContent=selection==="all"?"Analyzing comments across all survey periods…":`Analyzing comments from ${monthLabel(selection)}…`;
    host.innerHTML=`<div class="survey-summary-loading" role="status" aria-live="polite"><span class="survey-summary-spinner" aria-hidden="true"></span><strong>Summarizing comments…</strong><span>Reviewing ${commentCount} anonymized comment${commentCount===1?"":"s"}. This can take up to 90 seconds with a local AI model.</span></div>`;
  }

  function renderSummary(selection){
    const host=document.querySelector("#surveySummaryContent");
    const context=document.querySelector("#surveySummaryContext");
    const cached=commentSummaries.get(selection);
    context.textContent=selection==="all"?"Themes across all survey periods.":`Themes from ${monthLabel(selection)}.`;
    if(!cached){host.innerHTML=summaryEmpty();return;}
    const definitions=[
      ["appreciations","Appreciations","What employees value","#087f52"],
      ["employee_asks","Employee asks","Requested changes or support","#2f80ed"],
      ["focus_areas","Focus areas","Recurring concerns needing attention","#d97706"],
      ["suggested_actions","Suggested actions","AI-generated proposals","#7c3aed"],
    ];
    host.innerHTML=definitions.map(([key,title,note,color])=>{
      const items=Array.isArray(cached.summary?.[key])?cached.summary[key]:[];
      const list=items.length?`<ul>${items.map(item=>`<li><span>${escapeHtml(item.point)}</span>${item.mentions?`<small>${item.mentions} comment${item.mentions===1?"":"s"}</small>`:""}</li>`).join("")}</ul>`:'<p class="survey-summary-none">No clear theme identified.</p>';
      return `<article class="survey-summary-section" style="--summary-accent:${color}"><header><div><h4>${title}</h4><span>${note}</span></div></header>${list}</article>`;
    }).join("");
  }

  function renderComments(view){
    const comments=commentsForView(view);
    const list=document.querySelector("#surveyCommentList");
    const count=document.querySelector("#surveyCommentCount");
    const button=document.querySelector("#surveySummarizeButton");
    count.textContent=`${comments.length} comment${comments.length===1?"":"s"}`;
    button.disabled=summaryBusy||comments.length<5;
    button.title=comments.length&&comments.length<5?"At least five comments are required to protect respondent privacy.":"Summarize selected comments with AI";
    button.textContent=commentSummaries.has(view.selection)?"Regenerate":"Summarize";
    if(!comments.length){
      list.innerHTML='<div class="survey-comments-empty"><strong>No comments found</strong><span>The selected survey responses do not contain a recognised comments or feedback column.</span></div>';
    }else{
      list.innerHTML=comments.map((comment,index)=>`<article class="survey-comment-card"><div class="survey-comment-meta"><span>${escapeHtml(comment.topic||"Comment")}</span>${view.selection==="all"?`<small>${escapeHtml(monthLabel(comment.month))}</small>`:""}</div><p>${escapeHtml(comment.text)}</p><b aria-label="Comment ${index+1}">${index+1}</b></article>`).join("");
    }
    if(summaryBusy&&pendingSummarySelection===view.selection)renderSummaryLoading(view.selection,comments.length);
    else renderSummary(view.selection);
    if(comments.length&&comments.length<5){
      document.querySelector("#surveySummaryContext").textContent="At least five comments are required for AI summarization to protect respondent privacy.";
    }
  }

  async function summarizeComments(){
    if(summaryBusy)return;
    const view=currentView();
    const comments=commentsForView(view);
    if(comments.length<5)return;
    const selectionLabel=view.selection==="all"?"all survey periods":monthLabel(view.selection);
    const confirmed=global.confirm(`Send ${comments.length} locally masked comment${comments.length===1?"":"s"} from ${selectionLabel} to the configured AI endpoint? Identity columns are never included.`);
    if(!confirmed)return;
    const button=document.querySelector("#surveySummarizeButton");
    const status=document.querySelector("#surveySummaryStatus");
    summaryBusy=true;
    pendingSummarySelection=view.selection;
    pendingSummaryRevision=commentDataRevision;
    button.disabled=true;
    button.textContent="Summarizing…";
    renderSummaryLoading(view.selection,comments.length);
    status.className="survey-summary-status";
    status.textContent="Preparing anonymized comments and requesting structured themes…";
    try{
      const api=await global.waitForDesktopApi?.("summarize_survey_comments",5000);
      if(!api)throw new Error("AI support is available only in the desktop application.");
      const result=await api.summarize_survey_comments(view.selection);
      if(!result?.ok)throw new Error(result?.error||"The comments could not be summarized.");
      if(pendingSummaryRevision!==commentDataRevision)throw new Error("Survey comments changed while the summary was being generated. Select Summarize again for the refreshed data.");
      commentSummaries.set(view.selection,result);
      const limited=result.truncated?" The AI input was limited to protect performance and token usage.":"";
      if(currentView().selection===view.selection){
        renderSummary(view.selection);
        status.textContent=`Summary generated from ${result.comment_count} anonymized comment${result.comment_count===1?"":"s"}.${limited}`;
      }
    }catch(error){
      if(currentView().selection===view.selection)renderSummary(view.selection);
      status.textContent=error.message||String(error);
      status.className="survey-summary-status error";
    }finally{
      summaryBusy=false;
      pendingSummarySelection="";
      pendingSummaryRevision="";
      button.disabled=commentsForView(currentView()).length<5;
      button.textContent=commentSummaries.has(currentView().selection)?"Regenerate":"Summarize";
    }
  }

  function render(){
    if(!payload.periods.length){
      const meta=payload.meta||{};
      const reasons=meta.invalid_reasons||{};
      const reasonLabels={
        unreadable_workbook:"could not be opened (encrypted, incomplete, or damaged)",
        unrecognised_headers:"did not contain the required headers together in the first ten rows",
        no_valid_start_times:"contained the headers but no valid Start time values",
        processing_error:"could not be processed",
      };
      const details=Object.entries(reasons).filter(([,count])=>Number(count)>0).map(([reason,count])=>`${count} ${reasonLabels[reason]||"could not be recognised"}`);
      const discovered=Number(meta.discovered_files||meta.invalid_files||0);
      clear(discovered?`Found ${discovered} survey workbook${discovered===1?"":"s"}, but none could be loaded${details.length?`: ${details.join("; ")}`:"."}`:"No supported .xlsx or .xlsm survey files were found under the surveys folder.");
      return;
    }
    const view=currentView();
    renderKpis(view);
    renderTrend(view);
    renderTouchpoints(view);
    renderRatings(view);
    renderComments(view);
    const meta=payload.meta||{};
    const fileText=`${meta.file_count||0} file${meta.file_count===1?"":"s"}`;
    const duplicateText=meta.duplicate_count?` · ${meta.duplicate_count} duplicate response${meta.duplicate_count===1?"":"s"} ignored`:"";
    const invalidText=meta.invalid_files?` · ${meta.invalid_files} unrecognised file${meta.invalid_files===1?"":"s"} skipped`:"";
    document.querySelector("#surveyStatus").textContent=`${fileText} · ${meta.response_count||0} unique responses${duplicateText}${invalidText}`;
  }

  async function load(){
    document.querySelector("#surveyStatus").textContent="Scanning local survey files…";
    try{
      const response=await fetch("/api/surveys",{cache:"no-store"});
      const result=await response.json();
      if(!response.ok||result.error)throw new Error(result.error||"Survey data could not be loaded.");
      const nextCommentRevision=commentsRevision(result);
      const commentsChanged=Boolean(commentDataRevision&&nextCommentRevision!==commentDataRevision);
      payload=result;
      if(commentsChanged){
        commentSummaries.clear();
        const summaryStatus=document.querySelector("#surveySummaryStatus");
        summaryStatus.textContent="Survey comments changed. Generate a new summary for the refreshed data.";
        summaryStatus.className="survey-summary-status";
      }
      commentDataRevision=nextCommentRevision;
      populateFilter();
      render();
      return payload;
    }catch(error){
      payload={periods:[],meta:{}};
      clear(error.message||String(error));
      return payload;
    }
  }

  document.querySelector("#surveyMonthFilter").addEventListener("change",()=>{
    const status=document.querySelector("#surveySummaryStatus");
    status.textContent="";
    status.className="survey-summary-status";
    render();
  });
  document.querySelector("#surveySummarizeButton").addEventListener("click",()=>void summarizeComments());
  document.addEventListener("click",event=>{
    const toggle=event.target.closest("[data-survey-series]");
    if(!toggle||!toggle.closest(".survey-series-legend"))return;
    const expandedHost=toggle.closest("#expandedChartHost");
    const key=toggle.dataset.surveySeries;
    if(hiddenTrendSeries.has(key))hiddenTrendSeries.delete(key);
    else hiddenTrendSeries.add(key);
    renderTrend(currentView());
    if(expandedHost){
      const sourcePanel=document.querySelector("#surveyRatingTrendChart").closest(".chart-panel");
      const clone=sourcePanel.cloneNode(true);
      clone.querySelectorAll(".expand-chart-button").forEach(button=>button.remove());
      clone.querySelectorAll("[id]").forEach(element=>element.removeAttribute("id"));
      expandedHost.replaceChildren(clone);
    }
  });
  global.SurveyDashboard={
    load,
    render,
    isBusy:()=>summaryBusy,
    getContext:()=>({survey_month:document.querySelector("#surveyMonthFilter").value==="all"?"":document.querySelector("#surveyMonthFilter").value}),
    getPayload:()=>payload,
  };
})(window);
