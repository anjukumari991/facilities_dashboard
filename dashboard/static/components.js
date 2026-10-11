(function initialiseDashboardComponents(global){
  function openDialog(dialog){
    if(!dialog)return;
    if(typeof dialog.showModal==="function")dialog.showModal();
    else dialog.setAttribute("open","");
  }

  function closeDialog(dialog){
    if(!dialog)return;
    if(typeof dialog.close==="function"&&dialog.open)dialog.close();
    else dialog.removeAttribute("open");
  }

  function initialiseDialogs(root=document){
    root.querySelectorAll("dialog").forEach(dialog=>{
      dialog.querySelectorAll("[data-dialog-close]").forEach(button=>{
        button.addEventListener("click",()=>closeDialog(dialog));
      });
      dialog.addEventListener("click",event=>{
        if(event.target===dialog)closeDialog(dialog);
      });
    });
  }

  function initialiseTabs(tabList,{defaultPanelId}={}){
    if(!tabList)return null;
    const tabs=[...tabList.querySelectorAll("[data-tab-target]")];
    const panels=[...document.querySelectorAll("[data-tab-panel]")];

    function select(panelId,{focus=false}={}){
      const selected=tabs.find(tab=>tab.dataset.tabTarget===panelId)||tabs.find(tab=>tab.dataset.tabTarget===defaultPanelId)||tabs[0];
      if(!selected)return;
      tabs.forEach(tab=>{
        const active=tab===selected;
        tab.setAttribute("aria-selected",String(active));
        tab.tabIndex=active?0:-1;
      });
      panels.forEach(panel=>{panel.hidden=panel.id!==selected.dataset.tabTarget;});
      if(focus)selected.focus();
      tabList.dispatchEvent(new CustomEvent("dashboard:tabchange",{detail:{panelId:selected.dataset.tabTarget}}));
    }

    tabs.forEach((tab,index)=>{
      tab.addEventListener("click",()=>select(tab.dataset.tabTarget));
      tab.addEventListener("keydown",event=>{
        if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
        event.preventDefault();
        let nextIndex=index;
        if(event.key==="ArrowLeft")nextIndex=(index-1+tabs.length)%tabs.length;
        if(event.key==="ArrowRight")nextIndex=(index+1)%tabs.length;
        if(event.key==="Home")nextIndex=0;
        if(event.key==="End")nextIndex=tabs.length-1;
        select(tabs[nextIndex].dataset.tabTarget,{focus:true});
      });
    });
    select(defaultPanelId);
    return {select};
  }

  function createActionButton({label,ariaLabel=label,className="button",onClick}){
    const button=document.createElement("button");
    button.type="button";
    button.className=className;
    button.textContent=label;
    button.setAttribute("aria-label",ariaLabel);
    if(onClick)button.addEventListener("click",onClick);
    return button;
  }

  global.DashboardUI={openDialog,closeDialog,initialiseDialogs,initialiseTabs,createActionButton};
})(window);
