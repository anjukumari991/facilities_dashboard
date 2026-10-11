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
    if(message.role==="assistant"&&Number.isFinite(message.aggregate_queries)){
      const meta=document.createElement("span");
      meta.className="chat-message-meta";
      meta.textContent=message.aggregate_queries?`Based on ${message.aggregate_queries} anonymised aggregate calculation${message.aggregate_queries===1?"":"s"}.`:"No dashboard data calculation was needed.";
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

  async function openChat(){
    renderTab();
    global.DashboardUI.openDialog(dialog);
    showUnavailable("Checking AI support…");
    try{
      const api=await global.waitForDesktopApi?.("get_settings_state",5000);
      if(!api){showUnavailable();return;}
      const settings=await api.get_settings_state();
      if(settings?.credential_error){showUnavailable(`${settings.credential_error} Open Settings and save the API token again.`);return;}
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
      const assistantMessage={role:"assistant",content:result.answer,aggregate_queries:Number(result.aggregate_queries||0)};
      histories[activeTab].push(assistantMessage);
      addMessage(assistantMessage);
      status.textContent=result.aggregate_queries
        ?`Used ${result.aggregate_queries} anonymised aggregate calculation${result.aggregate_queries===1?"":"s"}.`
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
