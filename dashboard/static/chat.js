(function initialiseDashboardChat(global){
  const histories={expense:[],survey:[],workplace:[],collaborations:[]};
  const tabConfiguration={
    expense:{panel:"expenseReportPanel",label:"Expense Report",suggestions:["What are the biggest cost drivers?","Compare category spend over time","Where could we investigate savings?"]},
    survey:{panel:"surveyReportPanel",label:"Survey Report",suggestions:["Which touchpoints need attention?","Compare this survey with the previous survey","Suggest practical follow-up actions"]},
    workplace:{panel:"workplacePanel",label:"Workplace",suggestions:["Explain the next-FY workplace forecast","Compare rental and additional costs","Which months had the highest workplace cost?"]},
    collaborations:{panel:"collaborationsPanel",label:"Collaborations",suggestions:["Which teams have we assisted most?","Compare collaboration activity by status","How has collaboration reach changed across Plan Years?"]},
  };
  let activeTab="expense";
  let busy=false;

  const dialog=document.querySelector("#chatDialog");
  const available=document.querySelector("#chatAvailable");
  const unavailable=document.querySelector("#chatUnavailable");
  const messages=document.querySelector("#chatMessages");
  const suggestions=document.querySelector("#chatSuggestions");
  const input=document.querySelector("#chatInput");
  const sendButton=document.querySelector("#chatSendButton");
  const status=document.querySelector("#chatStatus");
  const privacyNotice=document.querySelector("#chatPrivacyNotice");
  const chartColors=["#087f52","#2f80ed","#d97706","#8a63d2","#d9488c","#0891b2","#65a30d","#dc2626"];

  function svgElement(name,attributes={}){
    const element=document.createElementNS("http://www.w3.org/2000/svg",name);
    Object.entries(attributes).forEach(([key,value])=>element.setAttribute(key,String(value)));
    return element;
  }

  function chartNumber(value){
    return new Intl.NumberFormat("en-IN",{maximumFractionDigits:2,notation:Math.abs(value)>=100000?"compact":"standard"}).format(value);
  }

  function chartLabel(value){
    const text=String(value||"");
    if(/^\d{4}-\d{2}-01$/.test(text))return new Date(`${text}T00:00:00`).toLocaleDateString("en-IN",{month:"short",year:"2-digit"});
    return text.length>13?`${text.slice(0,12)}…`:text;
  }

  function addSvgTitle(element,text){
    const title=svgElement("title");
    title.textContent=text;
    element.append(title);
  }

  function pointTooltip(seriesName,point,unit=""){
    const primary=`${seriesName} · ${point.label}: ${chartNumber(point.value)} ${unit}`.trim();
    const details=Array.isArray(point.details)?point.details.filter(Boolean):[];
    return details.length?`${primary}\n${details.join(" · ")}`:primary;
  }

  function renderCartesianChart(svg,chart,series){
    const W=430,H=245,p={l:48,r:14,t:18,b:52},plotW=W-p.l-p.r,plotH=H-p.t-p.b;
    const labels=[];
    series.forEach(item=>item.points.forEach(point=>{if(!labels.includes(point.label))labels.push(point.label);}));
    const values=series.flatMap(item=>item.points.map(point=>Number(point.value))).filter(Number.isFinite);
    const max=Math.max(1,...values),min=Math.min(0,...values),range=max-min||1;
    const y=value=>p.t+plotH-(Number(value)-min)/range*plotH;
    const x=index=>p.l+(index+.5)*plotW/Math.max(1,labels.length);
    for(let index=0;index<=4;index++){
      const value=min+range*index/4,axisY=y(value);
      svg.append(svgElement("line",{x1:p.l,x2:W-p.r,y1:axisY,y2:axisY,class:"chat-chart-grid"}));
      const text=svgElement("text",{x:p.l-7,y:axisY+4,"text-anchor":"end",class:"chat-chart-axis"});
      text.textContent=chartNumber(value);
      svg.append(text);
    }
    labels.forEach((label,index)=>{
      const text=svgElement("text",{x:x(index),y:H-19,"text-anchor":"middle",class:"chat-chart-axis"});
      text.textContent=chartLabel(label);
      addSvgTitle(text,label);
      svg.append(text);
    });

    if(chart.type==="line"){
      series.forEach((item,seriesIndex)=>{
        const pointMap=new Map(item.points.map(point=>[point.label,point]));
        const plotted=labels.map((label,index)=>({point:pointMap.get(label),x:x(index)})).filter(item=>item.point);
        if(plotted.length>1){
          const path=svgElement("path",{d:plotted.map((item,index)=>`${index?"L":"M"}${item.x} ${y(item.point.value)}`).join(" "),class:"chat-chart-line",stroke:chartColors[seriesIndex%chartColors.length]});
          svg.append(path);
        }
        plotted.forEach(item=>{
          const circle=svgElement("circle",{cx:item.x,cy:y(item.point.value),r:4.5,fill:chartColors[seriesIndex%chartColors.length],class:"chat-chart-point"});
          addSvgTitle(circle,pointTooltip(item.name||series[seriesIndex].name,item.point,chart.y_label||""));
          svg.append(circle);
        });
      });
      return;
    }

    const slot=plotW/Math.max(1,labels.length),groupWidth=Math.min(slot*.72,58),barWidth=groupWidth/Math.max(1,series.length);
    labels.forEach((label,labelIndex)=>{
      series.forEach((item,seriesIndex)=>{
        const point=item.points.find(candidate=>candidate.label===label);
        if(!point)return;
        const top=y(Math.max(0,point.value)),bottom=y(Math.min(0,point.value));
        const rect=svgElement("rect",{
          x:x(labelIndex)-groupWidth/2+seriesIndex*barWidth,
          y:top,
          width:Math.max(2,barWidth-2),
          height:Math.max(2,bottom-top),
          rx:3,
          fill:chartColors[seriesIndex%chartColors.length],
          class:"chat-chart-bar",
        });
        addSvgTitle(rect,pointTooltip(item.name,point,chart.y_label||""));
        svg.append(rect);
      });
    });
  }

  function renderPieChart(svg,chart,series){
    const points=series[0]?.points||[],total=points.reduce((sum,point)=>sum+Math.max(0,Number(point.value)||0),0);
    const cx=130,cy=112,r=82;
    let start=-Math.PI/2;
    points.forEach((point,index)=>{
      const share=total?Math.max(0,Number(point.value)||0)/total:0,end=start+share*Math.PI*2;
      const x1=cx+r*Math.cos(start),y1=cy+r*Math.sin(start),x2=cx+r*Math.cos(end),y2=cy+r*Math.sin(end);
      const attributes={fill:chartColors[index%chartColors.length],class:"chat-chart-pie-slice"};
      const shape=share>.9999
        ?svgElement("circle",{...attributes,cx,cy,r})
        :svgElement("path",{...attributes,d:`M${cx} ${cy} L${x1} ${y1} A${r} ${r} 0 ${share>.5?1:0} 1 ${x2} ${y2} Z`});
      const piePoint={...point,details:[...(point.details||[]),`${(share*100).toFixed(1)}% of total`]};
      addSvgTitle(shape,pointTooltip(series[0]?.name||"Value",piePoint,chart.y_label||""));
      svg.append(shape);
      start=end;
    });
  }

  function renderAdHocChart(chart){
    const article=document.createElement("article");
    article.className="chat-chart-card";
    const heading=document.createElement("strong");
    heading.textContent=String(chart?.title||"Ad-hoc chart");
    const note=document.createElement("small");
    note.textContent="Generated from anonymised aggregates in this tab";
    article.append(heading,note);
    const series=(Array.isArray(chart?.series)?chart.series:[]).slice(0,8).map(item=>({
      name:String(item?.name||"Series").slice(0,100),
      points:(Array.isArray(item?.points)?item.points:[]).slice(0,25).map(point=>({label:String(point?.label||""),value:Number(point?.value),details:(Array.isArray(point?.details)?point.details:[]).slice(0,5).map(value=>String(value).slice(0,100))})).filter(point=>Number.isFinite(point.value)),
    })).filter(item=>item.points.length);
    if(!series.length)return article;
    const svg=svgElement("svg",{viewBox:chart.type==="pie"?"0 0 430 245":"0 0 430 245",role:"img","aria-label":String(chart.title||"Ad-hoc aggregate chart")});
    if(chart.type==="pie"&&series.length===1)renderPieChart(svg,chart,series);
    else renderCartesianChart(svg,{...chart,type:chart.type==="line"?"line":"bar"},series);
    article.append(svg);
    const legend=document.createElement("div");
    legend.className="chat-chart-legend";
    series.forEach((item,index)=>{
      const entry=document.createElement("span");
      const marker=document.createElement("i");
      marker.style.background=chartColors[index%chartColors.length];
      entry.append(marker,document.createTextNode(item.name));
      legend.append(entry);
    });
    if(series.length>1||chart.type==="pie")article.append(legend);
    return article;
  }

  function resolveActiveTab(){
    const panel=document.querySelector('#reportTabs [role="tab"][aria-selected="true"]')?.dataset.tabTarget;
    return Object.entries(tabConfiguration).find(([,config])=>config.panel===panel)?.[0]||"expense";
  }

  function contextFor(tab){
    if(tab==="expense"){
      const category=document.querySelector("#groupFilter");
      const month=document.querySelector("#monthFilter");
      const period=document.querySelector("#lookbackFilter");
      return {
        tab,
        report_category:category?.value||"All",
        through_month:month?.value||"",
        period:period?.selectedOptions?.[0]?.textContent||period?.value||"",
      };
    }
    if(tab==="survey")return {tab,...(global.SurveyDashboard?.getContext?.()||{})};
    if(tab==="collaborations")return {tab,...(global.CollaborationDashboard?.getContext?.()||{})};
    return {tab,...(global.WorkplaceDashboard?.getContext?.()||{})};
  }

  function addMessage(message){
    const element=document.createElement("div");
    element.className=`chat-message ${message.role}`;
    element.textContent=message.content;
    if(message.role==="assistant"&&message.chart){
      element.classList.add("has-chart");
      element.append(renderAdHocChart(message.chart));
    }
    if(message.role==="assistant"&&Array.isArray(message.sources)&&message.sources.length){
      const sources=document.createElement("span");
      sources.className="chat-message-sources";
      sources.append(document.createTextNode("Verified facts: "));
      message.sources.slice(0,3).forEach((source,index)=>{
        if(index)sources.append(document.createTextNode(" · "));
        const link=document.createElement("a");
        link.href=String(source.url||"");
        link.target="_blank";
        link.rel="noopener noreferrer";
        link.textContent=String(source.name||"Source");
        sources.append(link);
      });
      element.append(sources);
    }
    if(message.role==="assistant"&&message.navigation_tab&&tabConfiguration[message.navigation_tab]){
      const move=document.createElement("button");
      move.type="button";
      move.className="chat-navigation-button";
      move.textContent=`Open ${tabConfiguration[message.navigation_tab].label}`;
      move.addEventListener("click",()=>{
        global.DashboardUI.closeDialog(dialog);
        document.querySelector(`[data-tab-target="${tabConfiguration[message.navigation_tab].panel}"]`)?.click();
      });
      element.append(move);
    }
    if(message.role==="assistant"&&Number.isFinite(message.aggregate_queries)&&!message.scope_refusal){
      const meta=document.createElement("span");
      meta.className="chat-message-meta";
      meta.textContent=message.local_detailed_analysis
        ?"Based on anonymised aggregates and locally masked survey comments."
        :message.aggregate_queries
          ?`Based on ${message.aggregate_queries} anonymised aggregate calculation${message.aggregate_queries===1?"":"s"}.`
          :"No dashboard data calculation was needed.";
      element.append(meta);
    }
    messages.append(element);
  }

  function renderHistory(){
    messages.replaceChildren();
    const history=histories[activeTab];
    if(!history.length){
      const welcome=document.createElement("div");
      welcome.className="chat-message assistant";
      welcome.textContent=`Ask a question about the current ${tabConfiguration[activeTab].label.toLowerCase()} and filters.`;
      messages.append(welcome);
    }else history.forEach(addMessage);
    messages.scrollTop=messages.scrollHeight;
  }

  function renderSuggestions(){
    suggestions.replaceChildren();
    tabConfiguration[activeTab].suggestions.forEach(prompt=>{
      const button=document.createElement("button");
      button.type="button";
      button.className="chat-suggestion";
      button.textContent=prompt;
      button.addEventListener("click",()=>{
        input.value=prompt;
        input.focus();
      });
      suggestions.append(button);
    });
  }

  function renderTab(){
    activeTab=resolveActiveTab();
    document.querySelector("#chatContextLabel").textContent=tabConfiguration[activeTab].label;
    renderHistory();
    renderSuggestions();
    status.textContent="";
    status.className="chat-status";
  }

  function showUnavailable(message="AI support is not available. Add an AI API token in Settings."){
    available.hidden=true;
    unavailable.hidden=false;
    document.querySelector("#chatUnavailableMessage").textContent=message;
  }

  function showAvailable(){
    unavailable.hidden=true;
    available.hidden=false;
  }

  function renderPrivacyNotice(settings){
    const detailed=Boolean(settings?.ai_provider==="managed"&&settings?.local_detailed_analysis);
    privacyNotice.textContent=detailed
      ?"Local detailed analysis is on. Survey chat may use a limited set of locally masked comments for the selected period. Identity columns and full response rows are excluded, and custom endpoints never receive this chat context."
      :"Ask Dashboard is restricted to anonymised aggregates from the active tab. It cannot search the web or combine data across tabs. The separate Survey Summarize action sends masked comment text only after confirmation; identity columns and raw response rows are never included.";
  }

  async function openChat(){
    renderTab();
    global.DashboardUI.openDialog(dialog);
    showUnavailable("Checking AI support…");
    try{
      const api=await global.waitForDesktopApi?.("get_settings_state",5000);
      if(!api){showUnavailable();return;}
      const settings=await api.get_settings_state();
      renderPrivacyNotice(settings);
      if(settings?.credential_error){showUnavailable(`${settings.credential_error} Open Settings and save the API token again.`);return;}
      if(settings?.ai_provider==="managed"&&!settings?.local_ai?.runtime_available){showUnavailable("No local AI runtime is available. Close the app and relaunch it using the platform launcher.");return;}
      if(settings?.ai_provider==="managed"&&!settings?.local_ai?.selected_installed){showUnavailable("AI support is not available yet. Open Settings and download a local model.");return;}
      if(!settings?.token_configured){showUnavailable();return;}
      showAvailable();
      input.focus();
    }catch(_error){showUnavailable();}
  }

  async function sendQuestion(event){
    event?.preventDefault();
    const question=input.value.trim();
    if(!question||busy)return;
    busy=true;
    input.value="";
    input.disabled=true;
    sendButton.disabled=true;
    const prior=histories[activeTab].map(({role,content})=>({role,content}));
    const userMessage={role:"user",content:question};
    histories[activeTab].push(userMessage);
    addMessage(userMessage);
    messages.scrollTop=messages.scrollHeight;
    status.className="chat-status thinking";
    status.textContent="AI is thinking… Please wait.";
    try{
      const api=await global.waitForDesktopApi?.("ask_dashboard",5000);
      if(!api)throw new Error("AI support is available only in the desktop application.");
      const result=await api.ask_dashboard(question,contextFor(activeTab),prior);
      if(["token_unavailable","token_invalid","credential_vault_error","model_access_denied","model_unavailable"].includes(result?.code)){
        histories[activeTab].pop();
        renderHistory();
        showUnavailable(result?.error);
        return;
      }
      if(!result?.ok)throw new Error(result?.error||"AI support could not complete the request.");
      const assistantMessage={
        role:"assistant",
        content:result.answer,
        aggregate_queries:Number(result.aggregate_queries||0),
        chart:result.chart||null,
        scope_refusal:Boolean(result.scope_refusal),
        navigation_tab:result.navigation_tab||"",
        sources:Array.isArray(result.sources)?result.sources:[],
        local_detailed_analysis:Boolean(result.local_detailed_analysis),
      };
      histories[activeTab].push(assistantMessage);
      addMessage(assistantMessage);
      status.textContent=result.scope_refusal
        ?"Request kept within the active tab."
        :result.aggregate_queries
        ?result.local_detailed_analysis
          ?"Used anonymised aggregates and locally masked survey comments."
          :`Used ${result.aggregate_queries} anonymised aggregate calculation${result.aggregate_queries===1?"":"s"}.`
        :"No dashboard data calculation was needed.";
      status.className="chat-status";
    }catch(error){
      const errorMessage={role:"assistant",content:error.message||String(error)};
      histories[activeTab].push(errorMessage);
      addMessage(errorMessage);
      status.textContent=error.message||"The request was not completed.";
      status.className="chat-status error";
    }finally{
      busy=false;
      input.disabled=false;
      sendButton.disabled=false;
      messages.scrollTop=messages.scrollHeight;
      input.focus();
    }
  }

  document.querySelector("#chatButton").addEventListener("click",()=>void openChat());
  document.querySelector("#chatForm").addEventListener("submit",event=>void sendQuestion(event));
  input.addEventListener("keydown",event=>{
    if(event.key==="Enter"&&!event.shiftKey){
      event.preventDefault();
      void sendQuestion();
    }
  });
  document.querySelector("#newChatButton").addEventListener("click",()=>{
    histories[activeTab]=[];
    renderHistory();
    input.focus();
  });
  document.querySelector("#chatOpenSettingsButton").addEventListener("click",()=>{
    global.DashboardUI.closeDialog(dialog);
    document.querySelector("#settingsButton").click();
  });
  document.querySelector("#reportTabs").addEventListener("dashboard:tabchange",()=>{
    if(dialog.open)renderTab();
  });

  global.DashboardChat={open:openChat,clear:()=>{histories[activeTab]=[];renderHistory();}};
})(window);
