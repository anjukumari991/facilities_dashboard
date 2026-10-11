(function initialiseAuditReports(global){
  const ICONS={pdf:"📕",word:"📘",excel:"📊",presentation:"📙",image:"🖼️",text:"📄",file:"📁"};
  let payload={reports:[],meta:{}};
  const escapeHtml=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  const monthLabel=iso=>new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN",{month:"short",year:"numeric"});
  const fileSize=value=>{
    const bytes=Number(value)||0;
    if(bytes<1024)return `${bytes} B`;
    if(bytes<1024*1024)return `${(bytes/1024).toFixed(bytes<10240?1:0)} KB`;
    return `${(bytes/(1024*1024)).toFixed(1)} MB`;
  };

  function selectedMonth(){return document.querySelector("#monthFilter")?.value||"";}

  function render(){
    const month=selectedMonth();
    const reports=month?payload.reports.filter(report=>report.month===month):[];
    document.querySelector("#auditReportCount").textContent=`${reports.length} file${reports.length===1?"":"s"}`;
    const list=document.querySelector("#auditReportList");
    if(!month){list.innerHTML='<div class="audit-report-empty">Select an expense month to view its audit reports.</div>';return;}
    if(!reports.length){list.innerHTML=`<div class="audit-report-empty">No audit reports found under <b>${escapeHtml(monthLabel(month))}</b>.</div>`;return;}
    list.innerHTML=reports.map(report=>`<button class="audit-report-item" type="button" data-audit-report-id="${escapeHtml(report.id)}" title="Double-click to open ${escapeHtml(report.name)}"><span class="audit-report-icon" aria-hidden="true">${ICONS[report.icon]||ICONS.file}</span><span class="audit-report-name">${escapeHtml(report.name)}</span><span class="audit-report-meta">${escapeHtml(report.extension)} · ${escapeHtml(fileSize(report.size_bytes))}</span></button>`).join("");
  }

  async function openReport(identifier){
    try{
      const api=global.pywebview?.api;
      if(!api||typeof api.open_audit_report!=="function")throw new Error("Audit reports can be opened from the desktop application.");
      const result=await api.open_audit_report(identifier);
      if(!result?.ok)throw new Error(result?.error||"The audit report could not be opened.");
    }catch(error){
      document.querySelector("#auditReportList").innerHTML=`<div class="audit-report-empty error">${escapeHtml(error.message||String(error))}</div>`;
    }
  }

  async function load(){
    try{
      const response=await fetch("/api/audit-reports",{cache:"no-store"});
      const result=await response.json();
      if(!response.ok||result.error)throw new Error(result.error||"Audit reports could not be loaded.");
      payload=result;
      render();
      return payload;
    }catch(error){
      payload={reports:[],meta:{}};
      document.querySelector("#auditReportCount").textContent="";
      document.querySelector("#auditReportList").innerHTML=`<div class="audit-report-empty error">${escapeHtml(error.message||String(error))}</div>`;
      return payload;
    }
  }

  document.querySelector("#monthFilter").addEventListener("change",render);
  document.querySelector("#auditReportList").addEventListener("dblclick",event=>{
    const item=event.target.closest("[data-audit-report-id]");
    if(item)void openReport(item.dataset.auditReportId);
  });
  document.querySelector("#auditReportList").addEventListener("keydown",event=>{
    const item=event.target.closest("[data-audit-report-id]");
    if(item&&event.key==="Enter")void openReport(item.dataset.auditReportId);
  });

  global.AuditReports={load,render,getPayload:()=>payload};
})(window);
