let dashboardData = null;
let bowlerExplorerData = null;
let explorerSelectedProfile = null;
let explorerSelectedYear = "2026";
let explorerSelectedDivision = "U18B";
let activeDashboardContext = null;
let defaultVisitView = null;
let familyCountdownTimer = null;
let dashboardAutoRefreshTimer = null;
let pendingDashboardUpdate = false;

const STATE_NAMES = {
  AK:"Alaska",AL:"Alabama",AR:"Arkansas",AZ:"Arizona",CA:"California",CO:"Colorado",CT:"Connecticut",DC:"District of Columbia",DE:"Delaware",FL:"Florida",GA:"Georgia",HI:"Hawaii",IA:"Iowa",ID:"Idaho",IL:"Illinois",IN:"Indiana",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",MA:"Massachusetts",MD:"Maryland",ME:"Maine",MI:"Michigan",MN:"Minnesota",MO:"Missouri",MS:"Mississippi",MT:"Montana",NC:"North Carolina",ND:"North Dakota",NE:"Nebraska",NH:"New Hampshire",NJ:"New Jersey",NM:"New Mexico",NV:"Nevada",NY:"New York",OH:"Ohio",OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",VA:"Virginia",VT:"Vermont",WA:"Washington",WI:"Wisconsin",WV:"West Virginia",WY:"Wyoming",
  AB:"Alberta",BC:"British Columbia",MB:"Manitoba",NB:"New Brunswick",NL:"Newfoundland and Labrador",NS:"Nova Scotia",NT:"Northwest Territories",NU:"Nunavut",ON:"Ontario",PE:"Prince Edward Island",QC:"Quebec",SK:"Saskatchewan",YT:"Yukon",FC:"Foreign country"
};

const EXPLORER_DIVISIONS = {
  U12B:"U12 Boys",U12G:"U12 Girls",U14B:"U14 Boys",U14G:"U14 Girls",
  U16B:"U16 Boys",U16G:"U16 Girls",U18B:"U18 Boys",U18G:"U18 Girls"
};

const SECTION_VISIBILITY_KEY = "jack-wix-dashboard:section-visibility:v2";
const SECTION_ORDER_KEY = "jack-wix-dashboard:section-order:v1";
const PINNED_SECTION_IDS = new Set(["section-results-status"]);
const DEFAULT_SECTION_VISIBILITY = {"section-equipment":false};
const DEFAULT_SECTION_ORDER = [
  "section-dashboard-guide",
  "section-bowler-explorer",
  "section-qualifying-overview",
  "section-since-last-visit",
  "section-current-statistics",
  "section-year-comparison",
  "section-progress",
  "section-cut-status",
  "section-scores",
  "section-schedule",
  "section-tournament-path",
  "section-alabama",
  "section-equipment"
];
const LAST_VISIT_KEY = "jack-wix-dashboard:last-visit";
const FAVORITES_KEY = "jack-wix-dashboard:favorite-alabama-bowlers";
let favoriteBowlers = loadStoredArray(FAVORITES_KEY);

function readStoredJson(key,fallback){
  try{
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  }catch(error){
    console.warn(`Unable to read ${key}`,error);
    return fallback;
  }
}

function writeStoredJson(key,value){
  try{
    localStorage.setItem(key,JSON.stringify(value));
    return true;
  }catch(error){
    console.warn(`Unable to save ${key}`,error);
    return false;
  }
}

function loadStoredArray(key){
  const value=readStoredJson(key,[]);
  return Array.isArray(value) ? value : [];
}

function setupCollapsibleSections(){
  document.querySelectorAll("details.dashboard-section").forEach(section=>{
    section.open=false;
  });
}

function setupSectionControls(){
  const sections=[...document.querySelectorAll("details.dashboard-section")];
  const expand=document.getElementById("expand-all");
  const collapse=document.getElementById("collapse-all");
  expand?.addEventListener("click",()=>sections.filter(section=>!section.hidden).forEach(section=>{section.open=true;}));
  collapse?.addEventListener("click",()=>sections.filter(section=>!section.hidden).forEach(section=>{section.open=false;}));
}

function sectionDisplayName(section){
  return section.querySelector(":scope > summary h2")?.textContent?.trim()
    || section.querySelector(":scope > summary .label")?.textContent?.trim()
    || section.id.replace(/^section-/,"").replaceAll("-"," ");
}

function sectionUserVisible(saved,sectionId){
  if(PINNED_SECTION_IDS.has(sectionId)) return true;
  if(Object.prototype.hasOwnProperty.call(saved,sectionId)) return saved[sectionId]!==false;
  return DEFAULT_SECTION_VISIBILITY[sectionId]!==false;
}

function applyStoredSectionOrder(){
  const main=document.querySelector(".family-more-body") || document.querySelector("main.container");
  const sections=[...document.querySelectorAll("details.dashboard-section")];
  if(!main || !sections.length) return;
  const pinned=sections.filter(section=>PINNED_SECTION_IDS.has(section.id));
  const movable=sections.filter(section=>!PINNED_SECTION_IDS.has(section.id));
  const byId=new Map(movable.map(section=>[section.id,section]));
  const saved=readStoredJson(SECTION_ORDER_KEY,[]);
  const requested=Array.isArray(saved) && saved.length ? saved : DEFAULT_SECTION_ORDER;
  const ids=[...requested.filter(id=>byId.has(id)),...movable.map(section=>section.id).filter(id=>!requested.includes(id))];
  pinned.slice().reverse().forEach(section=>main.prepend(section));
  ids.forEach(id=>main.append(byId.get(id)));
}

function saveSectionOrder(){
  writeStoredJson(
    SECTION_ORDER_KEY,
    [...document.querySelectorAll("details.dashboard-section")]
      .filter(section=>!PINNED_SECTION_IDS.has(section.id))
      .map(section=>section.id)
  );
}

function refreshSectionOrderButtons(){
  const rows=[...document.querySelectorAll("[data-section-visibility]")].filter(row=>!row.hidden);
  rows.forEach((row,index)=>{
    row.querySelector(".section-order-up").disabled=index===0;
    row.querySelector(".section-order-down").disabled=index===rows.length-1;
  });
}

function clearSectionDragState(){
  document.querySelectorAll("[data-section-visibility]").forEach(row=>row.classList.remove("dragging","drop-before","drop-after"));
}

function moveDashboardSection(sourceId,targetId,after=false){
  if(!sourceId || !targetId || sourceId===targetId) return;
  const source=document.getElementById(sourceId);
  const target=document.getElementById(targetId);
  const sourceRow=document.querySelector(`[data-section-visibility="${sourceId}"]`);
  const targetRow=document.querySelector(`[data-section-visibility="${targetId}"]`);
  if(!source || !target || !sourceRow || !targetRow) return;
  if(after){
    target.after(source);
    targetRow.after(sourceRow);
  }else{
    target.before(source);
    targetRow.before(sourceRow);
  }
  saveSectionOrder();
  refreshSectionOrderButtons();
  const position=[...document.querySelectorAll("[data-section-visibility]")]
    .filter(row=>!row.hidden)
    .findIndex(row=>row.dataset.sectionVisibility===sourceId)+1;
  setText("section-order-status",`${sectionDisplayName(source)} moved to position ${position}.`);
}

function moveDashboardSectionOneStep(sectionId,direction){
  const rows=[...document.querySelectorAll("[data-section-visibility]")].filter(row=>!row.hidden);
  const index=rows.findIndex(row=>row.dataset.sectionVisibility===sectionId);
  const targetIndex=index+direction;
  if(index<0 || targetIndex<0 || targetIndex>=rows.length) return;
  moveDashboardSection(sectionId,rows[targetIndex].dataset.sectionVisibility,direction>0);
}

function bindSectionOrderControls(container){
  container.querySelectorAll(".section-order-handle").forEach(handle=>{
    handle.addEventListener("click",event=>event.preventDefault());
    handle.addEventListener("pointerdown",()=>{handle.closest("[data-section-visibility]").dataset.dragReady="true";});
    handle.addEventListener("pointerup",()=>{delete handle.closest("[data-section-visibility]").dataset.dragReady;});
    handle.addEventListener("pointercancel",()=>{delete handle.closest("[data-section-visibility]").dataset.dragReady;});
    handle.addEventListener("dragstart",event=>{
      const row=handle.closest("[data-section-visibility]");
      row.classList.add("dragging");
      event.dataTransfer.effectAllowed="move";
      event.dataTransfer.setData("text/plain",row.dataset.sectionVisibility);
      event.stopPropagation();
    });
    handle.addEventListener("dragend",event=>{
      delete handle.closest("[data-section-visibility]").dataset.dragReady;
      clearSectionDragState();
      event.stopPropagation();
    });
  });
  container.querySelectorAll("[data-section-visibility]").forEach(row=>{
    row.addEventListener("dragstart",event=>{
      if(row.dataset.dragReady!=="true"){
        event.preventDefault();
        return;
      }
      row.classList.add("dragging");
      event.dataTransfer.effectAllowed="move";
      event.dataTransfer.setData("text/plain",row.dataset.sectionVisibility);
    });
    row.addEventListener("dragend",()=>{
      delete row.dataset.dragReady;
      clearSectionDragState();
    });
    row.addEventListener("dragover",event=>{
      event.preventDefault();
      clearSectionDragState();
      const after=event.clientY>row.getBoundingClientRect().top+row.getBoundingClientRect().height/2;
      row.classList.add(after?"drop-after":"drop-before");
      event.dataTransfer.dropEffect="move";
    });
    row.addEventListener("dragleave",()=>row.classList.remove("drop-before","drop-after"));
    row.addEventListener("drop",event=>{
      event.preventDefault();
      const sourceId=event.dataTransfer.getData("text/plain");
      const after=row.classList.contains("drop-after");
      moveDashboardSection(sourceId,row.dataset.sectionVisibility,after);
      clearSectionDragState();
    });
    row.querySelector(".section-order-up").addEventListener("click",event=>{
      event.preventDefault();
      moveDashboardSectionOneStep(row.dataset.sectionVisibility,-1);
    });
    row.querySelector(".section-order-down").addEventListener("click",event=>{
      event.preventDefault();
      moveDashboardSectionOneStep(row.dataset.sectionVisibility,1);
    });
  });
  refreshSectionOrderButtons();
}

function applySectionVisibility(){
  const saved=readStoredJson(SECTION_VISIBILITY_KEY,{});
  document.querySelectorAll("details.dashboard-section").forEach(section=>{
    const available=section.dataset.contextAvailable!=="false";
    const userVisible=sectionUserVisible(saved,section.id);
    section.hidden=!available || !userVisible;
    const control=document.querySelector(`[data-section-visibility="${section.id}"]`);
    if(!control) return;
    control.hidden=!available;
    const input=control.querySelector("input");
    input.checked=userVisible;
    input.disabled=!available;
    control.classList.toggle("unavailable",!available);
    control.querySelector(".section-visibility-label").textContent=sectionDisplayName(section);
    control.querySelector(".section-visibility-status").textContent=available ? "Available" : "Unavailable for current selection";
  });
  refreshSectionOrderButtons();
}

function setSectionAvailability(sectionId,available){
  const section=document.getElementById(sectionId);
  if(!section) return;
  section.dataset.contextAvailable=String(Boolean(available));
}

function blockHasPostedData(block){
  return Boolean(block && (Number(block.total)>0 || (Array.isArray(block.games) && block.games.length>0)));
}

function setQualifyingOverviewAvailability({schedule=[],blocks=[],isDefaultJack=false}={}){
  const personalSchedule=isDefaultJack
    ? schedule.filter(event=>event?.start && event?.title && event?.location)
    : [];
  const hasNext=personalSchedule.some(event=>new Date(event.start).getTime()>Date.now());
  const hasLast=personalSchedule.some((event,index)=>blockHasPostedData(blocks[index]));
  const nextCard=document.getElementById("next-block-card");
  const lastCard=document.getElementById("last-block-card");
  const grid=nextCard?.closest(".feature-grid");
  if(nextCard) nextCard.hidden=!hasNext;
  if(lastCard) lastCard.hidden=!hasLast;
  if(grid) grid.classList.toggle("single-card",Number(hasNext)+Number(hasLast)===1);
  return {hasNext,hasLast,hasOverview:hasNext || hasLast,hasSchedule:personalSchedule.length>0};
}

function refreshSectionVisibilityLabels(){
  document.querySelectorAll("details.dashboard-section").forEach(section=>{
    const label=document.querySelector(`[data-section-visibility="${section.id}"] .section-visibility-label`);
    if(label) label.textContent=sectionDisplayName(section);
  });
  applySectionVisibility();
}

function setupSectionVisibilityManager(){
  applyStoredSectionOrder();
  const sections=[...document.querySelectorAll("details.dashboard-section")]
    .filter(section=>!PINNED_SECTION_IDS.has(section.id));
  const container=document.getElementById("section-visibility-options");
  if(!container) return;
  sections.forEach(section=>{section.dataset.contextAvailable="true";});
  container.innerHTML=sections.map(section=>`
    <div class="section-visibility-option" data-section-visibility="${escapeHtml(section.id)}" draggable="true">
      <button class="section-order-handle" type="button" draggable="true" aria-label="Drag ${escapeHtml(sectionDisplayName(section))} to reorder" title="Drag to reorder">↕</button>
      <label class="section-visibility-choice">
        <input type="checkbox" ${sectionUserVisible({},section.id)?"checked":""}>
        <span class="section-visibility-label">${escapeHtml(sectionDisplayName(section))}</span>
        <small class="section-visibility-status">Available</small>
      </label>
      <div class="section-order-buttons" aria-label="Move ${escapeHtml(sectionDisplayName(section))}">
        <button class="section-order-up" type="button" aria-label="Move ${escapeHtml(sectionDisplayName(section))} up" title="Move up">↑</button>
        <button class="section-order-down" type="button" aria-label="Move ${escapeHtml(sectionDisplayName(section))} down" title="Move down">↓</button>
      </div>
    </div>`).join("");

  container.querySelectorAll("input").forEach(input=>{
    input.addEventListener("change",()=>{
      const control=input.closest("[data-section-visibility]");
      const saved=readStoredJson(SECTION_VISIBILITY_KEY,{});
      saved[control.dataset.sectionVisibility]=input.checked;
      writeStoredJson(SECTION_VISIBILITY_KEY,saved);
      applySectionVisibility();
    });
  });
  bindSectionOrderControls(container);

  document.getElementById("show-all-sections")?.addEventListener("click",()=>{
    const saved=readStoredJson(SECTION_VISIBILITY_KEY,{});
    sections.forEach(section=>{saved[section.id]=true;});
    writeStoredJson(SECTION_VISIBILITY_KEY,saved);
    applySectionVisibility();
  });
  document.getElementById("hide-all-sections")?.addEventListener("click",()=>{
    const saved=readStoredJson(SECTION_VISIBILITY_KEY,{});
    sections.forEach(section=>{saved[section.id]=false;});
    writeStoredJson(SECTION_VISIBILITY_KEY,saved);
    applySectionVisibility();
  });
  applySectionVisibility();
}

const fmt = new Intl.DateTimeFormat("en-US",{weekday:"long",month:"long",day:"numeric",hour:"numeric",minute:"2-digit",timeZone:"America/Chicago",timeZoneName:"short"});
const weekdayFmt = new Intl.DateTimeFormat("en-US",{weekday:"long",timeZone:"America/Chicago"});

async function load(){
  const res = await fetch(`data/dashboard.json?v=${Date.now()}`,{cache:"no-store"});
  const d = await res.json();
  dashboardData = d;

  const fieldSize=d.field_size?.current_report ?? d.current.field_size ?? null;
  const fieldFinal=Boolean(d.field_size?.is_final);
  if(d.current.position && fieldSize){
    setText("position", `#${d.current.position} of ${fieldSize}`);
    setText(
      "field-size-note",
      d.field_size?.note || (fieldFinal
        ? "Total U18B participants"
        : "Participants posted in the latest report; final field updates after remaining Day 1 squads")
    );
  }else{
    setText("position", d.current.position ? `#${d.current.position}` : "—");
    setText("field-size-note", "U18B participant count unavailable");
  }
  setText("total", d.current.total ?? "—");
  setText("average", d.current.average?.toFixed(2) ?? "—");
  setText("games-complete", `${d.current.games_complete}/16`);
  renderCutProjection(d.current || {}, d.cut_projection || {});
  setText("updated", `Dashboard refreshed ${fmt.format(new Date(d.updated_at))}`);
  renderSourceStatus(d.source_status || {}, d.updated_at);
  renderFamilyDashboard({
    name:"Jack Wix",
    year:"2026",
    current:{...d.current,field_size:fieldSize},
    fieldSize,
    blocks:d.blocks || [],
    schedule:d.schedule || [],
    source:d.source_status || {},
    updatedAt:d.updated_at,
    isDefaultJack:true,
    cutProjection:d.cut_projection || null
  });
  renderSinceLastVisit(d);
  captureDefaultVisitView();

  renderBlocks(d.blocks);
  renderYearComparison(d.year_comparison || {}, d);
  renderProgress(d.history || [], d.current || {}, d.cut_projection || {});
  renderPerformanceHighlights(d.blocks || []);
  renderEquipment(d.equipment || {});
  renderLastQualifier(d.schedule, d.blocks);
  renderSchedule(d.schedule);
  renderNextActions(d.schedule);
  renderTournamentPath(d.tournament_path || [], d.current || {});
  startCountdown(d.schedule);
  loadBowlerExplorer().catch(error=>{
    console.error(error);
    setText("explorer-data-status","Bowler list unavailable");
    setText("explorer-search-status","The searchable bowler data could not be loaded. The primary dashboard remains available below.");
  });
}


function renderCutProjection(current, projection){
  const fc=document.getElementById("from-cut");
  const needed=document.getElementById("needed-average");
  const diff=current.pins_from_cut;
  const neededValue=current.needed_average;
  const scoreIsProjected=projection.score_official !== true;

  fc.textContent=diff == null ? "Pending" : `${scoreIsProjected ? "≈ " : ""}${diff > 0 ? "+" : ""}${diff}`;
  fc.className=diff == null ? "" : diff >= 0 ? "positive" : "negative";
  needed.textContent=neededValue == null ? "Pending" : `${scoreIsProjected ? "≈ " : ""}${Number(neededValue).toFixed(2)}`;

  setText("cut-status-badge", projection.label || (projection.position_confirmed ? `Top ${projection.advancing_place} confirmed` : "Cut update pending"));
  setText("cut-status-title", projection.title || (projection.position_confirmed ? `The advancement cut is confirmed at ${projection.advancing_place}st place` : "Advancement cut update pending"));
  setText("cut-status-explanation", projection.explanation || "The advancing position and live score pace are temporarily unavailable.");
  setText("cut-gap-basis", projection.gap_basis || "Current score-line comparison unavailable");
  setText("needed-average-basis", projection.needed_average_basis || "Current-pace target unavailable");

  const badge=document.getElementById("cut-status-badge");
  badge.className=`cut-status-badge ${projection.position_confirmed ? "confirmed-position" : "placeholder"}`;
}

function renderSourceStatus(source, fallbackCheckedAt){
  const dot=document.getElementById("source-status-dot");
  const link=document.getElementById("source-report-link");
  const status=source.status || "unknown";
  dot.className=`status-dot ${status}`;

  const sourceTime=source.last_updated_at ? fmt.format(new Date(source.last_updated_at)) : null;
  const checkedTime=source.last_checked_at
    ? fmt.format(new Date(source.last_checked_at))
    : fallbackCheckedAt ? fmt.format(new Date(fallbackCheckedAt)) : null;

  if(status==="current" && sourceTime){
    setText("source-status-title", `Bowl.com last updated results ${sourceTime}`);
  }else if(status==="delayed" && sourceTime){
    setText("source-status-title", `Bowl.com results were last updated ${sourceTime}`);
  }else if(sourceTime){
    setText("source-status-title", `Latest Bowl.com report timestamp: ${sourceTime}`);
  }else{
    setText("source-status-title", "Bowl.com update time is temporarily unavailable");
  }

  const details=[];
  if(source.report) details.push(source.report);
  if(checkedTime) details.push(`Dashboard last checked ${checkedTime}`);
  setText("source-status-detail", details.join(" · "));

  if(source.source_url){
    link.href=source.source_url;
    link.textContent="Open latest report ↗";
  }
}

function formatSourceTime(value){
  return value ? fmt.format(new Date(value)) : null;
}

function latestPostedBlock(blocks=[]){
  return [...blocks].reverse().find(block=>blockHasPostedData(block)) || null;
}

function buildRemainingCutPlan(current={},projection={}){
  const games=Math.max(0,Number(current.games_complete || 0));
  const total=Number(current.total);
  const target=Number(projection.projected_final_total);
  if(!Number.isFinite(total) || !Number.isFinite(target) || games>=16) return null;
  const remainingGames=16-games;
  const remainingPins=Math.max(0,target-total);
  const remainingBlocks=Math.ceil(remainingGames/4);
  const base=Math.floor(remainingPins/remainingBlocks);
  const extra=remainingPins%remainingBlocks;
  const blockTargets=Array.from({length:remainingBlocks},(_,index)=>base+(index<extra?1:0));
  return {
    remainingGames,
    remainingPins,
    remainingBlocks,
    blockTargets,
    neededAverage:remainingGames ? remainingPins/remainingGames : null
  };
}

function remainingBlockLabels(schedule=[],gamesComplete=0,count=0,isDefaultJack=false){
  if(isDefaultJack){
    const firstRound=Math.floor(gamesComplete/4);
    return schedule.slice(firstRound,firstRound+count).map(event=>event?.start ? weekdayFmt.format(new Date(event.start)) : null)
      .map((label,index)=>label || `Block ${index+1}`);
  }
  return Array.from({length:count},(_,index)=>index===0 ? "Next block" : index===count-1 ? "Final block" : `Block ${index+1}`);
}

function renderFamilyCutTarget({name,current={},projection={},schedule=[],isDefaultJack=false}){
  const card=document.getElementById("family-cut-card");
  if(!card) return;
  const advancingPlace=Number(projection.advancing_place);
  const plan=buildRemainingCutPlan(current,projection);
  const hasCutContext=projection.position_confirmed===true && Number.isFinite(advancingPlace) && plan;
  card.hidden=!hasCutContext;
  if(!hasCutContext) return;

  const firstName=String(name || "Bowler").split(" ")[0];
  const labels=remainingBlockLabels(schedule,Number(current.games_complete || 0),plan.remainingBlocks,isDefaultJack);
  setText("family-cut-badge",`Top ${advancingPlace} confirmed`);
  setText("family-cut-title",plan.remainingBlocks===2
    ? `${firstName} needs ${plan.remainingPins.toLocaleString()} pins over ${labels[0]} and ${labels[1]} at the current pace`
    : `${firstName} needs ${plan.remainingPins.toLocaleString()} pins over ${plan.remainingGames} remaining games at the current pace`);
  setText("family-cut-summary",`The live ${advancingPlace}st-place pace projects to ${Number(projection.projected_final_total).toLocaleString()} pins after 16 games. The final score line can still move.`);

  const metrics=document.getElementById("family-cut-metrics");
  metrics.innerHTML=plan.blockTargets.map((target,index)=>`
    <div>
      <span>${escapeHtml(labels[index] || `Block ${index+1}`)} target</span>
      <strong>${target.toLocaleString()}</strong>
      <small>${(target/Math.min(4,plan.remainingGames-index*4)).toFixed(2)} average</small>
    </div>`).join("")+`
    <div>
      <span>Average needed</span>
      <strong>${plan.neededAverage.toFixed(2)}</strong>
      <small>Across ${plan.remainingGames} games</small>
    </div>`;

  const scenarios=document.getElementById("family-cut-scenarios");
  if(plan.remainingBlocks===2){
    const balanced=plan.blockTargets[0];
    const firstScores=[balanced-50,balanced-25,balanced,balanced+25,balanced+50].filter(score=>score>=0 && score<=plan.remainingPins);
    scenarios.hidden=false;
    scenarios.innerHTML=`<p>If ${escapeHtml(labels[0])}'s total changes, ${escapeHtml(labels[1])}'s target changes with it:</p><div>${firstScores.map(score=>`<span><strong>${escapeHtml(labels[0])} ${score}</strong><small>${escapeHtml(labels[1])} ${plan.remainingPins-score}</small></span>`).join("")}</div>`;
  }else{
    scenarios.hidden=true;
    scenarios.innerHTML="";
  }
}

function updateFamilyCountdown(schedule=[],isDefaultJack=false){
  if(familyCountdownTimer) clearInterval(familyCountdownTimer);
  const card=document.getElementById("family-next-card");
  if(!card) return;
  card.hidden=!isDefaultJack;
  if(!isDefaultJack) return;

  const update=()=>{
    const now=Date.now();
    const next=schedule.find(event=>event?.start && new Date(event.start).getTime()>now);
    if(!next){
      setText("family-next-title","Qualifying schedule complete");
      setText("family-next-detail","Watch the official standings for the next stage of the tournament.");
      setText("family-countdown","Complete");
      return;
    }
    const remaining=new Date(next.start).getTime()-now;
    const days=Math.floor(remaining/86400000);
    const hours=Math.floor(remaining%86400000/3600000);
    const minutes=Math.floor(remaining%3600000/60000);
    setText("family-next-title",next.title || "Next qualifying block");
    setText("family-next-detail",`${fmt.format(new Date(next.start))} · ${next.location || "Location pending"}`);
    setText("family-countdown",`${days}d ${String(hours).padStart(2,"0")}h ${String(minutes).padStart(2,"0")}m`);
  };
  update();
  familyCountdownTimer=setInterval(update,30000);
}

function renderFamilyDashboard({name,year,current={},fieldSize,blocks=[],schedule=[],source={},updatedAt,isDefaultJack=false,cutProjection=null}){
  const games=Math.max(0,Number(current.games_complete || 0));
  const total=current.total == null ? Number.NaN : Number(current.total);
  const average=current.average == null ? Number.NaN : Number(current.average);
  const rankValue=current.position ?? current.rank;
  const fieldValue=fieldSize ?? current.field_size;
  const rank=rankValue == null ? Number.NaN : Number(rankValue);
  const field=fieldValue == null ? Number.NaN : Number(fieldValue);
  const hasResults=games>0 && Number.isFinite(total) && Number.isFinite(average);
  const firstName=String(name || "Bowler").split(" ")[0];
  const rankedPlace=Number.isFinite(rank)
    ? `#${rank}${Number.isFinite(field) ? ` of ${field.toLocaleString()}` : ""}`
    : null;
  const position=rankedPlace
    ? `${current.tied ? "Tied for " : ""}${rankedPlace}`
    : "Not yet posted";
  const headlinePosition=rankedPlace
    ? `${current.tied ? "tied for " : ""}${rankedPlace}`
    : "not yet ranked";

  setText("family-kicker",`${possessiveName(name || "Bowler")} Junior Gold ${year} progress`);
  setText("family-headline",hasResults
    ? `${firstName} is ${headlinePosition} after ${games} ${games===1 ? "game" : "games"}`
    : `${possessiveName(name || "Bowler")} scores have not been posted yet`);
  setText("family-summary",hasResults
    ? `${total.toLocaleString()} total pins with a ${average.toFixed(2)} average. ${games<16 ? `${16-games} qualifying ${16-games===1 ? "game" : "games"} remain.` : "All 16 qualifying games are complete."}${cutProjection?.position_confirmed ? ` The top ${cutProjection.advancing_place} advance.` : ""}`
    : "This page will update when Bowl.com publishes the official scores.");
  setText("family-position",position);
  setText("family-total",hasResults ? total.toLocaleString() : "—");
  setText("family-average",hasResults ? average.toFixed(2) : "—");
  setText("family-games",`${games} of 16`);
  setText("family-progress-label",`${games} of 16 games`);
  const progress=Math.min(100,(games/16)*100);
  const progressTrack=document.querySelector(".family-progress-track");
  progressTrack?.setAttribute("aria-valuenow",String(Math.min(16,games)));
  const progressFill=document.getElementById("family-progress-fill");
  if(progressFill) progressFill.style.width=`${progress}%`;

  const latest=latestPostedBlock(blocks);
  const latestCard=document.getElementById("family-latest-card");
  latestCard.hidden=!latest;
  if(latest){
    const scores=(Array.isArray(latest.games) ? latest.games : []).map(Number).filter(Number.isFinite);
    const blockTotal=Number(latest.total) || scores.reduce((sum,score)=>sum+score,0);
    setText("family-latest-round",`Qualifying Round ${latest.round || "—"}`);
    document.getElementById("family-latest-games").innerHTML=scores.length
      ? scores.map((score,index)=>`<span><small>Game ${index+1}</small><strong>${score}</strong></span>`).join("")
      : '<span class="family-score-pending">Individual game scores are unavailable.</span>';
    setText("family-latest-total",blockTotal ? `${blockTotal.toLocaleString()} pins${scores.length ? ` · ${(blockTotal/scores.length).toFixed(2)} average` : ""}` : "Results posted");
    setText("family-latest-note",`${possessiveName(firstName)} most recently posted qualifying block.`);
  }

  const sourceTime=formatSourceTime(source.last_updated_at);
  const checkedTime=formatSourceTime(source.last_checked_at || updatedAt);
  const status=source.status || "unknown";
  const sourceDot=document.getElementById("family-source-dot");
  if(sourceDot) sourceDot.className=`status-dot ${status}`;
  setText("family-source-label",status==="current"
    ? "Official results are current"
    : status==="delayed"
      ? "Bowl.com has not posted a recent update"
      : status==="archive" ? `Final archived ${year} results` : "Official update time is unavailable");
  setText("family-source-detail",[
    sourceTime ? `Bowl.com updated ${sourceTime}` : null,
    checkedTime ? `checked ${checkedTime}` : null
  ].filter(Boolean).join(" · "));
  const sourceLink=document.getElementById("family-source-link");
  sourceLink.href=source.source_url || sourceLink.href;
  renderFamilyCutTarget({name,current,projection:cutProjection || {},schedule,isDefaultJack});
  updateFamilyCountdown(schedule,isDefaultJack);
}

function setText(id,v){document.getElementById(id).textContent=v}

async function checkForPublishedResults({manual=false}={}){
  const button=document.getElementById("refresh-results");
  const status=document.getElementById("family-refresh-status");
  if(!button || !status || !dashboardData) return;
  if(pendingDashboardUpdate){
    if(manual) location.reload();
    return;
  }

  button.disabled=true;
  if(manual) status.textContent="Checking the published dashboard…";
  try{
    const response=await fetch(`data/dashboard.json?v=${Date.now()}`,{cache:"no-store"});
    if(!response.ok) throw new Error(`Dashboard refresh request failed: ${response.status}`);
    const latest=await response.json();
    if(latest.updated_at && latest.updated_at!==dashboardData.updated_at){
      pendingDashboardUpdate=true;
      button.textContent="Load new results";
      button.classList.add("has-update");
      status.textContent="New published results are ready.";
      return;
    }
    if(manual) status.textContent="You’re viewing the latest published dashboard.";
  }catch(error){
    console.error(error);
    if(manual) status.textContent="Unable to check for published results right now.";
  }finally{
    button.disabled=false;
  }
}

function setupDashboardRefresh(){
  document.getElementById("refresh-results")?.addEventListener("click",()=>{
    checkForPublishedResults({manual:true});
  });
  dashboardAutoRefreshTimer=setInterval(()=>checkForPublishedResults(),120000);
  document.addEventListener("visibilitychange",()=>{
    if(document.visibilityState==="visible") checkForPublishedResults();
  });
}

function escapeHtml(value){
  return String(value ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function possessiveName(name){
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

function isJackWix(profile){
  return normalizeExplorerText(profile?.name)==="jack wix";
}

function profileBlocksForDashboard(profile){
  const source=Array.isArray(profile?.blocks) ? profile.blocks : [];
  return [1,2,3,4].map(round=>{
    const block=source.find(item=>Number(item.round)===round);
    if(!block) return {round,games:[],total:null};
    const games=(Array.isArray(block.games) ? block.games : []).map(Number).filter(score=>Number.isFinite(score) && score>0);
    return {
      ...block,
      round,
      games,
      total:Number(block.total)>0 ? Number(block.total) : games.length ? games.reduce((sum,score)=>sum+score,0) : null
    };
  });
}

function selectedCutContext(profile,year,projection){
  if((profile?.division_code || explorerSelectedDivision)!=="U18B") return null;
  const games=Number(profile?.games_complete || 0);
  const currentScore=Number(projection?.current_score);
  const finalTarget=Number(projection?.projected_final_total);
  if(String(year)!=="2026" || games!==Number(projection?.games_basis) || !Number.isFinite(currentScore) || !Number.isFinite(finalTarget)) return null;
  const total=Number(profile.total);
  const remaining=16-games;
  const name=profile.name;
  const current={
    ...profile,
    field_size:profile.field_size,
    pins_from_cut:total-currentScore,
    needed_average:remaining>0 ? Math.max(0,(finalTarget-total)/remaining) : null
  };
  const plan=buildRemainingCutPlan(current,projection);
  return {
    current,
    projection:{
      ...projection,
      status:"confirmed_position",
      position_confirmed:true,
      score_official:false,
      label:`Top ${projection.advancing_place} confirmed`,
      title:`The advancement cut is confirmed at ${projection.advancing_place}st place`,
      explanation:`The number of U18 Boys advancing after 16 games is confirmed at ${projection.advancing_place}. The final score needed is not known until Round 4 is complete, so this view projects from the live ${projection.advancing_place}st-place pace.`,
      gap_basis:`${name} is compared with the current ${projection.advancing_place}st-place score of ${currentScore} after ${games} games`,
      needed_average_basis:`Current-pace target of ${finalTarget} pins; ${name} needs ${plan?.remainingPins ?? 0} over ${plan?.remainingGames ?? 0} games`,
      remaining_plan:plan ? {
        remaining_games:plan.remainingGames,
        remaining_pins:plan.remainingPins,
        remaining_blocks:plan.remainingBlocks,
        block_targets:plan.blockTargets,
        needed_average:plan.neededAverage
      } : null
    }
  };
}

function profileHistoryForDashboard(profile,yearData,cutContext=null){
  return (profile?.blocks || [])
    .filter(block=>Number(block.cumulative_total)>0 && Number(block.cumulative_average)>0)
    .map(block=>{
      const gamesComplete=Number(block.round)*4;
      const isLatest=gamesComplete===Number(profile.games_complete);
      return {
        games_complete:gamesComplete,
        total:Number(block.cumulative_total),
        average:Number(block.cumulative_average),
        position:block.position,
        field_size:yearData.field_size,
        pins_from_cut:isLatest ? cutContext?.current?.pins_from_cut ?? null : null,
        projected_cut_total:isLatest ? cutContext?.projection?.projected_final_total ?? null : null,
        source_url:explorerReport(yearData,block.round)?.source_url || null
      };
    });
}

function profileComparisonYear(profile,yearData){
  const blocks=(profile.blocks || []).map(block=>({
    ...block,
    source_url:explorerReport(yearData,block.derived && Number(block.round)===3 ? 4 : block.round)?.source_url || null
  }));
  return {
    year:Number(yearData.year),
    division:yearData.division || "U18 Boys",
    field_size:yearData.field_size,
    blocks,
    final_qualifying:{
      games_complete:profile.games_complete,
      total:profile.total,
      average:profile.average,
      position:profile.rank,
      tied:profile.tied,
      field_size:yearData.field_size
    }
  };
}

function buildSelectedComparison(profile){
  if((profile?.division_code || explorerSelectedDivision)!=="U18B") return null;
  const archive=explorerYearData("2025","U18B");
  const live=explorerYearData("2026","U18B");
  if(!archive || !live) return null;
  const profile2025=matchingExplorerProfile(profile,archive);
  const profile2026=matchingExplorerProfile(profile,live);
  if(!profile2025 || !profile2026) return null;
  const cutContext=selectedCutContext(profile2026,"2026",dashboardData?.cut_projection || {});
  return {
    comparison:{
      current_year:2026,
      source_page:archive.source_page,
      comparison_basis:`Each day compares ${profile.name}'s same four-game qualifying checkpoint. The 2025 results are final; 2026 remains live and fills in as Bowl.com publishes each round.`,
      previous_year:profileComparisonYear(profile2025,archive)
    },
    currentData:{
      current:{...profile2026,position:profile2026.rank,field_size:live.field_size},
      blocks:profileBlocksForDashboard(profile2026),
      history:profileHistoryForDashboard(profile2026,live,cutContext),
      field_size:{current_report:live.field_size},
      source_status:dashboardData?.source_status || {}
    }
  };
}

function applySelectedBowlerContext(year,yearData,profile){
  if(!dashboardData || !yearData || !profile) return;
  const selectedYear=String(year);
  const division=yearData.division || EXPLORER_DIVISIONS[explorerSelectedDivision] || "U18 Boys";
  const isDefaultJack=isJackWix(profile) && selectedYear==="2026" && yearData.division_code==="U18B";
  const blocks=profileBlocksForDashboard(profile);
  const hasScores=blocks.some(block=>Number(block.total)>0 || block.games.length);
  const cutContext=selectedCutContext(profile,selectedYear,dashboardData.cut_projection || {});
  const history=profileHistoryForDashboard(profile,yearData,cutContext);
  const comparison=buildSelectedComparison(profile);
  const scheduleAvailability=setQualifyingOverviewAvailability({
    schedule:dashboardData.schedule || [],
    blocks,
    isDefaultJack
  });
  const hasEquipment=Boolean(isDefaultJack && dashboardData.equipment?.balls?.length);
  const hasStandings=Number.isFinite(Number(profile.rank))
    && Number.isFinite(Number(profile.total))
    && Number.isFinite(Number(profile.average))
    && Number(profile.games_complete)>0;
  const hasSourceStatus=selectedYear==="2026" && Boolean(
    yearData.source_updated_at || yearData.source_page || yearData.reports?.length
  );
  const hasTournamentPath=selectedYear==="2026"
    && hasStandings
    && Boolean(dashboardData.tournament_path?.length);
  const current={
    ...profile,
    position:profile.rank,
    field_size:yearData.field_size,
    pins_from_cut:cutContext?.current?.pins_from_cut ?? null,
    needed_average:cutContext?.current?.needed_average ?? null
  };

  activeDashboardContext={
    name:profile.name,
    year:selectedYear,
    yearData,
    profile,
    current,
    blocks,
    isDefaultJack
  };

  document.body.classList.toggle("alternate-bowler-context",!isDefaultJack);
  document.querySelector(".banner-shell").hidden=!isDefaultJack;
  document.getElementById("jack-facebook-link").hidden=!isDefaultJack;
  document.title=`${profile.name} | Junior Gold ${selectedYear}`;
  document.querySelector('meta[name="description"]').content=`Official-results dashboard for ${profile.name} at the ${selectedYear} Junior Gold Championships.`;
  setText("dashboard-context-eyebrow",isDefaultJack ? "Live Tournament Dashboard" : `Viewing ${selectedYear} ${division} Results`);
  setText("dashboard-bowler-name",profile.name);
  setText("dashboard-bowler-subtitle",`${selectedYear} ${division} · Squad ${profile.squad || "—"} · ${profile.hometown || "Hometown unavailable"}`);
  setText("active-bowler-context",`Viewing ${profile.name} · ${selectedYear}`);
  const officialLink=document.getElementById("hero-official-link");
  officialLink.href=yearData.source_page || officialLink.href;
  officialLink.firstChild.textContent=`Official ${selectedYear} results `;

  setText("statistics-title",`${possessiveName(profile.name)} tournament statistics`);
  setText("position-field-label",`Position / ${yearData.division_code || "U18B"} field`);
  document.getElementById("statistics-metrics").setAttribute("aria-label",`${possessiveName(profile.name)} current tournament statistics`);
  setText("position",hasStandings ? `#${profile.rank}${profile.tied?"T":""} of ${Number(yearData.field_size).toLocaleString()}` : "Not yet posted");
  setText("field-size-note",yearData.status==="final" ? `Final ${division} qualifying field` : `Published ${division} results field; registration and results counts can differ`);
  setText("total",hasStandings ? Number(profile.total).toLocaleString() : "—");
  setText("average",hasStandings ? Number(profile.average).toFixed(2) : "—");
  setText("games-complete",hasStandings ? `${profile.games_complete}/16` : "0/16 posted");
  document.querySelectorAll(".estimate-metric").forEach(card=>{card.hidden=!cutContext;});
  if(cutContext) renderCutProjection(cutContext.current,cutContext.projection);

  setText("scores-title",`${possessiveName(profile.name)} scores by block`);
  const refreshedAt=yearData.source_updated_at || yearData.generated_at;
  setText("updated",yearData.status==="final" ? `Final archived ${selectedYear} qualifying results` : `Official results updated ${refreshedAt ? fmt.format(new Date(refreshedAt)) : "recently"}`);
  if(isDefaultJack){
    renderSourceStatus(dashboardData.source_status || {},dashboardData.updated_at);
  }else if(selectedYear==="2026"){
    const latestReport=[...(yearData.reports || [])].sort((a,b)=>new Date(b.source_updated_at)-new Date(a.source_updated_at))[0];
    const updatedAt=latestReport?.source_updated_at || yearData.source_updated_at;
    const ageMinutes=updatedAt ? Math.max(0,Math.round((Date.now()-new Date(updatedAt).getTime())/60000)) : null;
    renderSourceStatus({
      status:ageMinutes==null?"unavailable":ageMinutes<=180?"current":"delayed",
      last_updated_at:updatedAt,
      last_checked_at:yearData.generated_at,
      report:latestReport?`Qualifying Round ${latestReport.round}`:`${division} participant report`,
      source_url:latestReport?.source_url || profile.registration_source_url || yearData.source_page,
      age_minutes:ageMinutes
    },yearData.generated_at);
  }
  renderBlocks(blocks);
  const familySource=isDefaultJack
    ? dashboardData.source_status || {}
    : {
        status:selectedYear==="2026" ? "current" : "archive",
        last_updated_at:yearData.source_updated_at,
        last_checked_at:yearData.generated_at,
        source_url:yearData.source_page
      };
  renderFamilyDashboard({
    name:profile.name,
    year:selectedYear,
    current,
    fieldSize:yearData.field_size,
    blocks,
    schedule:isDefaultJack ? dashboardData.schedule || [] : [],
    source:familySource,
    updatedAt:yearData.generated_at,
    isDefaultJack,
    cutProjection:cutContext?.projection || null
  });

  setText("progress-description",cutContext
    ? `${possessiveName(profile.name)} tournament average compared with the projected score pace for the confirmed top-${cutContext.projection.advancing_place} cut. Both values use pins per game.`
    : `${possessiveName(profile.name)} cumulative tournament average and position after each available qualifying block.`);
  setText("progress-bowler-name",profile.name.split(" ")[0]);
  document.getElementById("progress-cut-legend").hidden=!cutContext;
  renderProgress(history,current,cutContext?.projection || {},profile.name);
  renderPerformanceHighlights(blocks);

  setText("year-comparison-title",`${profile.name}: 2025 vs. 2026`);
  if(comparison) renderYearComparison(comparison.comparison,comparison.currentData);

  setText("tournament-path-intro",`${profile.name} must advance at each cut to continue. The current stage is highlighted; future stages are not guaranteed.`);
  renderTournamentPath(dashboardData.tournament_path || [],current);
  setText("qualifying-overview-title",isDefaultJack ? "Qualifying overview" : `${possessiveName(profile.name)} qualifying overview`);
  if(isDefaultJack) restoreDefaultVisitView();
  else setText("visit-title",`${possessiveName(profile.name)} visit updates`);
  setText("schedule-title",isDefaultJack ? "Squad 1 qualifying" : `${possessiveName(profile.name)} qualifying schedule`);
  setText("equipment-title",`${possessiveName(profile.name)} registered ball card`);
  setText("dashboard-guide-context",comparison
    ? `The year-over-year section compares ${possessiveName(profile.name)} 2025 and 2026 results only at matching four-game checkpoints. Sections without source-backed data for this selection are hidden automatically. Personal display choices are stored only in this browser.`
    : hasStandings
      ? `This profile has official ${selectedYear} ${division} qualifying results. Sections requiring another year, a personal schedule, or equipment details are hidden when those data are unavailable. Personal display choices are stored only in this browser.`
      : `${profile.name} appears in the official ${selectedYear} ${division} participant report, but no qualifying score row is posted yet. Score-dependent sections stay hidden until Bowl.com publishes matching results.`);

  const availability={
    "section-bowler-explorer":true,
    "section-qualifying-overview":scheduleAvailability.hasOverview,
    "section-since-last-visit":isDefaultJack && hasStandings,
    "section-results-status":hasSourceStatus,
    "section-current-statistics":hasStandings,
    "section-year-comparison":Boolean(comparison),
    "section-progress":history.length>0,
    "section-cut-status":Boolean(cutContext),
    "section-scores":hasScores,
    "section-schedule":scheduleAvailability.hasSchedule,
    "section-tournament-path":hasTournamentPath,
    "section-alabama":Boolean(document.getElementById("explorer-state")?.value),
    "section-equipment":hasEquipment,
    "section-dashboard-guide":true
  };
  Object.entries(availability).forEach(([id,available])=>setSectionAvailability(id,available));
  if(bowlerExplorerData) refreshStateLeaderboard(false);
  refreshSectionVisibilityLabels();
}

function restoreDefaultDashboardContext(){
  const live=explorerYearData("2026","U18B");
  const jack=(live?.bowlers || []).find(bowler=>isJackWix(bowler));
  if(jack) applySelectedBowlerContext("2026",live,jack);
}

function normalizeExplorerText(value){
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g," ")
    .trim();
}

function explorerYearData(year,division=explorerSelectedDivision){
  const yearData=bowlerExplorerData?.years?.[String(year)] || null;
  if(!yearData) return null;
  if(String(year)==="2026" && yearData.divisions) return yearData.divisions[division] || null;
  return division==="U18B" ? yearData : null;
}

function explorerReport(yearData,round){
  const reports=Array.isArray(yearData?.reports) ? yearData.reports : [];
  return reports.find(report=>Number(report.round)===Number(round)) || reports.at(-1) || null;
}

function explorerStateValue(bowler){
  return String(bowler?.state || "").trim().toUpperCase() || "__NONE__";
}

function explorerStateLabel(value){
  if(value==="__NONE__") return "State unavailable";
  return STATE_NAMES[value] ? `${STATE_NAMES[value]} (${value})` : value;
}

function populateExplorerStates(yearData,preferredState=""){
  const select=document.getElementById("explorer-state");
  const counts=new Map();
  (yearData?.bowlers || []).forEach(bowler=>{
    const value=explorerStateValue(bowler);
    counts.set(value,(counts.get(value) || 0)+1);
  });
  const entries=[...counts.entries()].sort((a,b)=>
    explorerStateLabel(a[0]).localeCompare(explorerStateLabel(b[0]))
  );
  select.innerHTML='<option value="">All states</option>'+entries.map(([value,count])=>
    `<option value="${escapeHtml(value)}">${escapeHtml(explorerStateLabel(value))} · ${count.toLocaleString()}</option>`
  ).join("");
  select.value=counts.has(preferredState) ? preferredState : "";
  select.disabled=false;
}

function matchingExplorerProfile(profile,targetYearData){
  const bowlers=Array.isArray(targetYearData?.bowlers) ? targetYearData.bowlers : [];
  return bowlers.find(bowler=>bowler.id===profile.id)
    || bowlers.find(bowler=>
      normalizeExplorerText(bowler.name)===normalizeExplorerText(profile.name)
      && normalizeExplorerText(bowler.hometown)===normalizeExplorerText(profile.hometown)
    )
    || null;
}

function setExplorerYear(year){
  explorerSelectedYear=String(year);
  const division=document.getElementById("explorer-division");
  if(explorerSelectedYear==="2025") explorerSelectedDivision="U18B";
  if(division){
    division.value=explorerSelectedDivision;
    division.disabled=explorerSelectedYear==="2025";
  }
  document.querySelectorAll("[data-explorer-year]").forEach(button=>{
    button.setAttribute("aria-pressed",String(button.dataset.explorerYear===explorerSelectedYear));
  });
}

function setExplorerDivision(code){
  explorerSelectedDivision=EXPLORER_DIVISIONS[code] ? code : "U18B";
  const division=document.getElementById("explorer-division");
  if(division) division.value=explorerSelectedDivision;
}

function clearExplorerProfile({clearUrl=true}={}){
  explorerSelectedProfile=null;
  const profile=document.getElementById("explorer-profile");
  if(profile) profile.hidden=true;
  const search=document.getElementById("explorer-search");
  if(search){
    search.value="";
    search.focus({preventScroll:true});
  }
  renderExplorerMatches();
  restoreDefaultDashboardContext();
  if(clearUrl){
    const url=new URL(location.href);
    const state=document.getElementById("explorer-state")?.value || "";
    url.searchParams.set("year",explorerSelectedYear);
    url.searchParams.set("division",explorerSelectedDivision);
    if(state) url.searchParams.set("state",state);
    else url.searchParams.delete("state");
    url.searchParams.delete("bowler");
    history.replaceState({},"",url);
  }
}

function renderExplorerMatches(){
  const search=document.getElementById("explorer-search");
  const results=document.getElementById("explorer-results");
  const yearData=explorerYearData(explorerSelectedYear);
  const query=normalizeExplorerText(search.value);
  const selectedState=document.getElementById("explorer-state")?.value || "";
  const division=yearData?.division || EXPLORER_DIVISIONS[explorerSelectedDivision];
  results.innerHTML="";

  const minimumQueryLength=selectedState ? 1 : 2;
  if(!selectedState && query.length<minimumQueryLength){
    setText("explorer-search-status",`Type at least two characters to search the ${explorerSelectedYear} ${division} participants.`);
    return;
  }

  const matches=(yearData?.bowlers || []).filter(bowler=>{
    if(selectedState && explorerStateValue(bowler)!==selectedState) return false;
    if(query.length<minimumQueryLength) return true;
    const haystack=normalizeExplorerText(`${bowler.name} ${bowler.hometown}`);
    return query.split(" ").every(term=>haystack.includes(term));
  }).sort((a,b)=>{
    const left=a.rank==null ? Number.MAX_SAFE_INTEGER : Number(a.rank);
    const right=b.rank==null ? Number.MAX_SAFE_INTEGER : Number(b.rank);
    return left-right || a.name.localeCompare(b.name);
  });
  const visible=selectedState ? matches : matches.slice(0,20);
  const stateLabel=selectedState ? explorerStateLabel(selectedState) : "";
  setText(
    "explorer-search-status",
    selectedState
      ? matches.length
        ? `${query ? `${matches.length.toLocaleString()} matching` : `Showing all ${matches.length.toLocaleString()}`} ${division} bowler${matches.length===1?"":"s"} from ${stateLabel} in ${explorerSelectedYear}. Select a name to open the profile.`
        : `No ${explorerSelectedYear} ${division} bowlers from ${stateLabel} matched “${search.value.trim()}”.`
      : matches.length
        ? `${matches.length.toLocaleString()} match${matches.length===1?"":"es"} in ${explorerSelectedYear}. Select a name to open the profile.`
        : `No ${explorerSelectedYear} ${division} bowlers matched “${search.value.trim()}”.`
  );

  results.innerHTML=visible.map(bowler=>{
    const hasResults=bowler.rank!=null && bowler.total!=null && bowler.average!=null;
    const summary=hasResults
      ? `<strong>#${bowler.rank}${bowler.tied?"T":""}</strong><small>${Number(bowler.total).toLocaleString()} pins · ${Number(bowler.average).toFixed(2)}</small>`
      : `<strong>Registered</strong><small>Squad ${bowler.squad || "—"} · Results pending</small>`;
    return `<button type="button" role="option" data-explorer-id="${escapeHtml(bowler.id)}">
    <span><strong>${escapeHtml(bowler.name)}</strong><small>${escapeHtml(bowler.hometown || "Hometown unavailable")}</small></span>
    <span class="explorer-result-stats">${summary}</span>
  </button>`;
  }).join("");

  if(!selectedState && matches.length>visible.length){
    results.insertAdjacentHTML("beforeend",`<p class="explorer-result-limit">Showing the first ${visible.length}. Keep typing to narrow the list.</p>`);
  }
  results.querySelectorAll("button[data-explorer-id]").forEach(button=>{
    button.addEventListener("click",()=>selectExplorerProfile(explorerSelectedYear,button.dataset.explorerId));
  });
}

function explorerMetric(label,value,note=""){
  if(value==null || value==="") return "";
  return `<article><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${note?`<small>${escapeHtml(note)}</small>`:""}</article>`;
}

function explorerYearCard(year,yearData,profile){
  const status=yearData.status==="final" ? "Final" : "Latest posted";
  return `<article class="explorer-year-card">
    <div><span>${year}</span><small>${status}</small></div>
    <strong>${Number(profile.total).toLocaleString()} pins</strong>
    <p>${Number(profile.average).toFixed(2)} average · #${profile.rank}${profile.tied?"T":""} of ${Number(yearData.field_size).toLocaleString()}</p>
    <small>${profile.games_complete} qualifying games</small>
  </article>`;
}

function explorerCheckpoint(profile,gamesComplete){
  if(Number(profile.games_complete)===Number(gamesComplete)){
    return {total:Number(profile.total),average:Number(profile.average)};
  }
  const round=Number(gamesComplete)/4;
  const block=(profile.blocks || []).find(item=>Number(item.round)===round && item.cumulative_total!=null);
  return block ? {total:Number(block.cumulative_total),average:Number(block.cumulative_average)} : null;
}

function renderExplorerYearComparison(year,yearData,profile){
  const section=document.getElementById("explorer-year-section");
  const container=document.getElementById("explorer-year-comparison");
  if(yearData.division_code!=="U18B" || !Number(profile.games_complete)){
    section.hidden=true;
    container.innerHTML="";
    return;
  }
  const otherYear=String(year)==="2026" ? "2025" : "2026";
  const otherYearData=explorerYearData(otherYear,"U18B");
  const otherProfile=otherYearData ? matchingExplorerProfile(profile,otherYearData) : null;
  if(!otherProfile){
    section.hidden=true;
    container.innerHTML="";
    return;
  }

  const ordered=[
    {year:String(year),yearData,profile},
    {year:otherYear,yearData:otherYearData,profile:otherProfile}
  ].sort((a,b)=>Number(a.year)-Number(b.year));
  const profile2026=String(year)==="2026" ? profile : otherProfile;
  const profile2025=String(year)==="2025" ? profile : otherProfile;
  const checkpointGames=Number(profile2026.games_complete);
  const checkpoint2026=explorerCheckpoint(profile2026,checkpointGames);
  const checkpoint2025=explorerCheckpoint(profile2025,checkpointGames);
  const comparable=checkpoint2026 && checkpoint2025 && checkpointGames>0 && checkpointGames%4===0;
  const comparison=comparable
    ? `<div class="explorer-comparison-delta">
        <span>2026 vs. 2025 at ${checkpointGames} games</span>
        <strong>${signedNumber(checkpoint2026.total-checkpoint2025.total)} pins · ${signedNumber(checkpoint2026.average-checkpoint2025.average,2)} average</strong>
      </div>`
    : `<p class="explorer-comparison-caveat">A same-stage total is not available in both years, so no direct scoring delta is shown.</p>`;

  section.hidden=false;
  container.innerHTML=`<div class="explorer-year-cards">${ordered.map(item=>explorerYearCard(item.year,item.yearData,item.profile)).join("")}</div>${comparison}`;
}

function renderExplorerBlocks(yearData,profile){
  const section=document.getElementById("explorer-block-section");
  const container=document.getElementById("explorer-blocks");
  const blocks=(Array.isArray(profile.blocks) ? profile.blocks : []).filter(block=>
    Number(block.total)>0 || (Array.isArray(block.games) && block.games.length)
  );
  if(!blocks.length){
    section.hidden=true;
    container.innerHTML="";
    return;
  }

  section.hidden=false;
  container.innerHTML=blocks.map(block=>{
    const games=Array.isArray(block.games) ? block.games : [];
    const sourceRound=block.derived && Number(block.round)===3 ? 4 : block.round;
    const report=explorerReport(yearData,sourceRound);
    const details=[];
    if(block.cumulative_total!=null) details.push(`${Number(block.cumulative_total).toLocaleString()} cumulative`);
    if(block.cumulative_average!=null) details.push(`${Number(block.cumulative_average).toFixed(2)} average`);
    if(block.position!=null) details.push(`#${block.position}${block.tied?"T":""} after Day ${block.round}`);
    return `<article class="explorer-block-card ${block.derived?"derived-block":""}">
      <header><h4>Day ${block.round}</h4>${block.derived?'<span>Verified total</span>':""}</header>
      ${games.length
        ? `<div class="explorer-game-list">${games.map(score=>`<span>${score}</span>`).join("")}</div>`
        : '<p class="explorer-games-unavailable">Individual games were not machine-readable in the archived report.</p>'}
      <strong>${Number(block.total).toLocaleString()} block pins</strong>
      ${details.length?`<p>${escapeHtml(details.join(" · "))}</p>`:""}
      ${block.derived?'<small>Calculated only from official cumulative totals; no game scores were inferred.</small>':""}
      ${report?.source_url?`<a href="${escapeHtml(report.source_url)}" target="_blank" rel="noopener">Official report ↗</a>`:""}
    </article>`;
  }).join("");
}

function renderExplorerSources(yearData,profile){
  const section=document.getElementById("explorer-source-section");
  const links=document.getElementById("explorer-source-links");
  const reports=Array.isArray(yearData.reports) ? yearData.reports : [];
  const visibleRounds=new Set((profile.blocks || []).map(block=>block.derived && Number(block.round)===3 ? 4 : Number(block.round)));
  const relevant=reports.filter(report=>visibleRounds.has(Number(report.round)) || Number(report.round)===Number(profile.latest_round));
  const sourceLinks=[];
  if(yearData.source_page) sourceLinks.push(`<a href="${escapeHtml(yearData.source_page)}" target="_blank" rel="noopener">${yearData.year} results page ↗</a>`);
  if(profile.registration_source_url) sourceLinks.push(`<a href="${escapeHtml(profile.registration_source_url)}" target="_blank" rel="noopener">${yearData.division} participant report ↗</a>`);
  relevant.forEach(report=>sourceLinks.push(`<a href="${escapeHtml(report.source_url)}" target="_blank" rel="noopener">Day ${report.round} report ↗</a>`));
  if(!sourceLinks.length){
    section.hidden=true;
    links.innerHTML="";
    return;
  }

  section.hidden=false;
  setText(
    "explorer-source-note",
    yearData.archive_note || `${yearData.year} ${yearData.division} profiles combine the official participant report with the latest valid qualifying results.`
  );
  links.innerHTML=[...new Set(sourceLinks)].join("");
}

function renderExplorerProfile(year,yearData,profile){
  const profileElement=document.getElementById("explorer-profile");
  const hasResults=profile.rank!=null && profile.total!=null && profile.average!=null && Number(profile.games_complete)>0;
  setText("explorer-profile-kicker",`${year} ${yearData.status==="final"?"final":"live"} ${yearData.division}`);
  setText("explorer-profile-name",profile.name);
  setText("explorer-profile-meta",`${profile.hometown || "Hometown unavailable"} · Squad ${profile.squad || "—"} · ${hasResults?`Latest posted Day ${profile.latest_round}`:"Registered participant; qualifying results not yet posted"}`);

  const metrics=[
    hasResults ? explorerMetric("Position",`#${profile.rank}${profile.tied?"T":""} of ${Number(yearData.field_size).toLocaleString()}`,yearData.status==="live"?"Published results field; may change":"Final qualifying field") : "",
    hasResults ? explorerMetric("Total pins",Number(profile.total).toLocaleString()) : "",
    hasResults ? explorerMetric("Average",Number(profile.average).toFixed(2)) : "",
    hasResults ? explorerMetric("Games complete",`${profile.games_complete} of 16`) : "",
    explorerMetric("Squad",profile.squad),
    explorerMetric("Qualifying event",profile.qualification_event),
    explorerMetric("Waiver",profile.waiver_status)
  ].filter(Boolean);
  document.getElementById("explorer-profile-metrics").innerHTML=metrics.join("");

  renderExplorerYearComparison(year,yearData,profile);
  renderExplorerBlocks(yearData,profile);
  renderExplorerSources(yearData,profile);
  profileElement.hidden=false;
}

function selectExplorerProfile(year,id,{updateUrl=true,scroll=true,syncState=true}={}){
  const yearData=explorerYearData(year);
  const profile=(yearData?.bowlers || []).find(bowler=>bowler.id===id || bowler.registration_id===id);
  if(!profile) return false;

  setExplorerYear(year);
  explorerSelectedProfile=profile;
  const stateSelect=document.getElementById("explorer-state");
  const profileState=explorerStateValue(profile);
  if(syncState && stateSelect && profileState!=="__NONE__" && [...stateSelect.options].some(option=>option.value===profileState)){
    stateSelect.value=profileState;
  }
  document.getElementById("explorer-search").value=profile.name;
  document.getElementById("explorer-results").innerHTML="";
  setText("explorer-search-status",`Showing ${profile.name}'s ${year} ${yearData.division} profile.`);
  renderExplorerProfile(String(year),yearData,profile);
  applySelectedBowlerContext(String(year),yearData,profile);

  if(updateUrl){
    const url=new URL(location.href);
    const state=document.getElementById("explorer-state")?.value || "";
    url.searchParams.set("year",String(year));
    url.searchParams.set("division",explorerSelectedDivision);
    if(state) url.searchParams.set("state",state);
    else url.searchParams.delete("state");
    url.searchParams.set("bowler",profile.id);
    history.replaceState({},"",url);
  }
  if(scroll) document.getElementById("explorer-profile").scrollIntoView({behavior:"smooth",block:"start"});
  return true;
}

async function copyExplorerProfileLink(){
  const status=document.getElementById("explorer-search-status");
  if(!explorerSelectedProfile) return;
  const url=new URL(location.href);
  const state=document.getElementById("explorer-state")?.value || "";
  url.searchParams.set("year",explorerSelectedYear);
  url.searchParams.set("division",explorerSelectedDivision);
  if(state) url.searchParams.set("state",state);
  else url.searchParams.delete("state");
  url.searchParams.set("bowler",explorerSelectedProfile.id);
  try{
    await copyText(url.toString());
    status.textContent=`Link copied for ${explorerSelectedProfile.name}.`;
  }catch(error){
    console.error(error);
    status.textContent="The profile link could not be copied in this browser.";
  }
}

function bindBowlerExplorer(){
  const search=document.getElementById("explorer-search");
  const state=document.getElementById("explorer-state");
  const division=document.getElementById("explorer-division");
  if(search.dataset.bound==="true") return;
  search.dataset.bound="true";
  search.addEventListener("input",renderExplorerMatches);
  search.addEventListener("keydown",event=>{
    if(event.key==="Enter") document.querySelector("#explorer-results button[data-explorer-id]")?.click();
    if(event.key==="Escape") clearExplorerProfile();
  });
  document.querySelectorAll("[data-explorer-year]").forEach(button=>{
    button.addEventListener("click",()=>{
      const targetYear=button.dataset.explorerYear;
      if(targetYear==="2025") setExplorerDivision("U18B");
      const targetYearData=explorerYearData(targetYear,explorerSelectedDivision);
      const preferredState=state.value;
      const match=explorerSelectedProfile ? matchingExplorerProfile(explorerSelectedProfile,targetYearData) : null;
      setExplorerYear(targetYear);
      populateExplorerStates(targetYearData,preferredState);
      if(match) selectExplorerProfile(targetYear,match.id);
      else clearExplorerProfile();
    });
  });
  division.addEventListener("change",()=>{
    setExplorerDivision(division.value);
    explorerSelectedProfile=null;
    document.getElementById("explorer-profile").hidden=true;
    search.value="";
    const yearData=explorerYearData(explorerSelectedYear);
    populateExplorerStates(yearData,state.value);
    const url=new URL(location.href);
    url.searchParams.set("year",explorerSelectedYear);
    url.searchParams.set("division",explorerSelectedDivision);
    if(state.value) url.searchParams.set("state",state.value);
    else url.searchParams.delete("state");
    url.searchParams.delete("bowler");
    history.replaceState({},"",url);
    renderExplorerMatches();
    restoreDefaultDashboardContext();
    refreshStateLeaderboard();
  });
  state.addEventListener("change",()=>{
    if(explorerSelectedProfile){
      explorerSelectedProfile=null;
      document.getElementById("explorer-profile").hidden=true;
      search.value="";
      restoreDefaultDashboardContext();
    }
    const url=new URL(location.href);
    url.searchParams.set("year",explorerSelectedYear);
    url.searchParams.set("division",explorerSelectedDivision);
    if(state.value) url.searchParams.set("state",state.value);
    else url.searchParams.delete("state");
    url.searchParams.delete("bowler");
    history.replaceState({},"",url);
    renderExplorerMatches();
    refreshStateLeaderboard();
  });
  document.getElementById("explorer-clear").addEventListener("click",()=>clearExplorerProfile());
  document.getElementById("explorer-copy-link").addEventListener("click",copyExplorerProfileLink);
}

async function loadBowlerExplorer(){
  const response=await fetch(`data/bowlers.json?v=${Date.now()}`,{cache:"no-store"});
  if(!response.ok) throw new Error(`Bowler explorer returned ${response.status}`);
  bowlerExplorerData=await response.json();
  const liveRoot=bowlerExplorerData?.years?.["2026"];
  const liveDivisions=Object.values(liveRoot?.divisions || {});
  const liveCount=liveDivisions.reduce((sum,item)=>sum+(item?.profile_count || item?.bowlers?.length || 0),0);
  const registrationCount=liveDivisions.reduce((sum,item)=>sum+(item?.registration_count || 0),0);
  const archive=explorerYearData("2025","U18B");
  const archiveCount=archive?.bowlers?.length || 0;
  setText("explorer-count-2026",registrationCount?`${registrationCount.toLocaleString()} registered`:"Unavailable");
  setText("explorer-count-2025",archiveCount?`${archiveCount.toLocaleString()} final`:"Unavailable");
  setText("explorer-data-status",`${registrationCount.toLocaleString()} registered across 8 divisions · ${archiveCount.toLocaleString()} archived U18B`);
  document.getElementById("explorer-search").disabled=false;
  bindBowlerExplorer();

  const params=new URLSearchParams(location.search);
  const requestedYear=params.get("year")==="2025" ? "2025" : "2026";
  const requestedDivision=requestedYear==="2025" ? "U18B" : (EXPLORER_DIVISIONS[params.get("division")] ? params.get("division") : "U18B");
  const requestedState=String(params.get("state") || "").toUpperCase();
  const requestedBowler=params.get("bowler");
  setExplorerDivision(requestedDivision);
  const requestedYearData=explorerYearData(requestedYear,requestedDivision);
  const requestedProfile=(requestedYearData?.bowlers || []).find(bowler=>bowler.id===requestedBowler || bowler.registration_id===requestedBowler);
  const initialState=requestedState || (requestedProfile ? explorerStateValue(requestedProfile) : "AL");
  setExplorerYear(requestedYear);
  populateExplorerStates(requestedYearData,initialState);
  if(requestedBowler && selectExplorerProfile(requestedYear,requestedBowler,{updateUrl:false,scroll:false,syncState:!requestedState})) return;
  renderExplorerMatches();
  restoreDefaultDashboardContext();
  refreshStateLeaderboard();
}

function currentVisitSnapshot(data){
  return {
    source_updated_at:data.source_status?.last_updated_at || data.updated_at || null,
    position:data.current?.position ?? null,
    field_size:data.field_size?.current_report ?? data.current?.field_size ?? null,
    total:data.current?.total ?? null,
    average:data.current?.average ?? null,
    games_complete:data.current?.games_complete ?? null,
    pins_from_cut:data.current?.pins_from_cut ?? null
  };
}

function captureDefaultVisitView(){
  defaultVisitView={
    title:document.getElementById("visit-title")?.textContent || "Since your last visit",
    summary:document.getElementById("visit-summary")?.textContent || "",
    changes:document.getElementById("visit-changes")?.innerHTML || ""
  };
}

function restoreDefaultVisitView(){
  if(!defaultVisitView) return;
  setText("visit-title",defaultVisitView.title);
  setText("visit-summary",defaultVisitView.summary);
  document.getElementById("visit-changes").innerHTML=defaultVisitView.changes;
}

function renderSinceLastVisit(data){
  const previous=readStoredJson(LAST_VISIT_KEY,null);
  const current=currentVisitSnapshot(data);
  const changes=[];

  if(!previous || typeof previous!=="object"){
    setText("visit-title","Your visit baseline is set");
    setText("visit-summary","When official results change, this section will summarize the new games and standings movement on your next visit.");
    changes.push(`Current position: #${current.position ?? "—"}${current.field_size ? ` of ${current.field_size}` : ""}`);
  }else{
    const sameResult=previous.source_updated_at===current.source_updated_at
      && previous.position===current.position
      && previous.total===current.total
      && previous.games_complete===current.games_complete;

    if(sameResult){
      setText("visit-title","No new official results since your last visit");
      setText("visit-summary","The dashboard has checked Bowl.com, but Jack's latest posted scores and position have not changed.");
      changes.push(`Still #${current.position ?? "—"}${current.field_size ? ` of ${current.field_size}` : ""}`);
    }else{
      setText("visit-title","New since your last visit");
      setText("visit-summary","Here is what changed in the latest official Bowl.com results.");

      const gameChange=Number(current.games_complete)-Number(previous.games_complete);
      const pinChange=Number(current.total)-Number(previous.total);
      const positionChange=Number(previous.position)-Number(current.position);
      const averageChange=Number(current.average)-Number(previous.average);
      const cutChange=Number(current.pins_from_cut)-Number(previous.pins_from_cut);
      const fieldChange=Number(current.field_size)-Number(previous.field_size);

      if(Number.isFinite(gameChange) && gameChange) changes.push(`${gameChange>0?"+":""}${gameChange} games posted`);
      if(Number.isFinite(pinChange) && pinChange) changes.push(`${pinChange>0?"+":""}${pinChange} pins`);
      if(Number.isFinite(positionChange)){
        changes.push(positionChange>0 ? `Up ${positionChange} place${positionChange===1?"":"s"}` : positionChange<0 ? `Down ${Math.abs(positionChange)} place${positionChange===-1?"":"s"}` : "Position unchanged");
      }
      if(Number.isFinite(averageChange) && Math.abs(averageChange)>=0.01) changes.push(`${averageChange>0?"+":""}${averageChange.toFixed(2)} average`);
      if(Number.isFinite(cutChange) && cutChange) changes.push(`Estimated cut gap ${cutChange>0?"improved":"moved back"} ${Math.abs(cutChange)} pins`);
      if(Number.isFinite(fieldChange) && fieldChange) changes.push(`${fieldChange>0?"+":""}${fieldChange} published participants`);
      if(!changes.length) changes.push("The official report timestamp changed; Jack's headline totals stayed the same.");
    }
  }

  document.getElementById("visit-changes").innerHTML=changes.map(change=>`<span>${escapeHtml(change)}</span>`).join("");
  writeStoredJson(LAST_VISIT_KEY,current);
}

function latestBlockSnapshots(history,current,projection){
  const byGames=new Map();
  (Array.isArray(history) ? history : []).forEach(snapshot=>{
    if(Number(snapshot.games_complete)>0) byGames.set(Number(snapshot.games_complete),snapshot);
  });
  if(!byGames.size && Number(current.games_complete)>0){
    byGames.set(Number(current.games_complete),{
      games_complete:Number(current.games_complete),
      average:Number(current.average),
      position:current.position,
      field_size:current.field_size,
      pins_from_cut:current.pins_from_cut,
      projected_cut_total:projection.projected_final_total
    });
  }
  return [...byGames.values()].sort((a,b)=>Number(a.games_complete)-Number(b.games_complete));
}

function renderProgress(history,current,projection,bowlerName="Jack Wix"){
  const chart=document.getElementById("progress-chart");
  const positionHistory=document.getElementById("position-history");
  if(!chart || !positionHistory) return;

  const snapshots=latestBlockSnapshots(history,current,projection).map(snapshot=>({
    ...snapshot,
    average:Number(snapshot.average),
    cut_pace_average:snapshot.cut_pace_average!=null
      ? Number(snapshot.cut_pace_average)
      : snapshot.projected_cut_total!=null ? Number(snapshot.projected_cut_total)/16 : null
  }));

  if(!snapshots.length){
    chart.innerHTML=`<p class="muted">The progress comparison will appear when ${escapeHtml(possessiveName(bowlerName))} first scores are posted.</p>`;
    positionHistory.innerHTML="";
    return;
  }

  const values=snapshots.flatMap(snapshot=>[snapshot.average,snapshot.cut_pace_average]).filter(Number.isFinite);
  const hasCutPace=snapshots.some(snapshot=>Number.isFinite(snapshot.cut_pace_average));
  const chartMax=Math.min(300,Math.max(200,Math.ceil(Math.max(...values,200)/25)*25));
  const chartLabel=snapshots.map(snapshot=>{
    const cut=Number.isFinite(snapshot.cut_pace_average) ? snapshot.cut_pace_average.toFixed(2) : "unavailable";
    return hasCutPace
      ? `After ${snapshot.games_complete} games, ${bowlerName} averaged ${snapshot.average.toFixed(2)} and the estimated cut pace was ${cut}`
      : `After ${snapshot.games_complete} games, ${bowlerName} averaged ${snapshot.average.toFixed(2)}`;
  }).join(". ");

  chart.setAttribute("role","img");
  chart.setAttribute("aria-label",chartLabel);
  chart.innerHTML=`
    <div class="chart-scale" aria-hidden="true"><span>${chartMax}</span><span>${Math.round(chartMax/2)}</span><span>0</span></div>
    <div class="chart-groups" style="--chart-max:${chartMax}">
      ${snapshots.map(snapshot=>{
        const jackHeight=Math.max(0,Math.min(100,(snapshot.average/chartMax)*100));
        const cutHeight=Number.isFinite(snapshot.cut_pace_average) ? Math.max(0,Math.min(100,(snapshot.cut_pace_average/chartMax)*100)) : 0;
        return `<div class="chart-group">
          <div class="chart-bars" aria-hidden="true">
            <div class="chart-bar jack-bar" style="--bar-height:${jackHeight}%"><span>${snapshot.average.toFixed(2)}</span></div>
            ${hasCutPace?`<div class="chart-bar cut-bar" style="--bar-height:${cutHeight}%"><span>${Number.isFinite(snapshot.cut_pace_average)?snapshot.cut_pace_average.toFixed(2):"—"}</span></div>`:""}
          </div>
          <strong>${snapshot.games_complete} games</strong>
        </div>`;
      }).join("")}
    </div>`;

  positionHistory.innerHTML=snapshots.map((snapshot,index)=>{
    const previous=index ? snapshots[index-1] : null;
    const movement=previous && Number.isFinite(Number(previous.position)) && Number.isFinite(Number(snapshot.position))
      ? Number(previous.position)-Number(snapshot.position)
      : null;
    const movementText=movement==null ? "Starting position" : movement>0 ? `Up ${movement}` : movement<0 ? `Down ${Math.abs(movement)}` : "No rank change";
    const gap=snapshot.pins_from_cut==null ? (hasCutPace ? "Gap pending" : "Cut comparison unavailable") : `${Number(snapshot.pins_from_cut)>0?"+":""}${snapshot.pins_from_cut} vs. pace`;
    return `<article>
      <span>After ${snapshot.games_complete} games</span>
      <strong>#${snapshot.position ?? "—"}${snapshot.field_size ? ` of ${snapshot.field_size}` : ""}</strong>
      <small>${escapeHtml(movementText)} · ${escapeHtml(gap)}</small>
    </article>`;
  }).join("");
}

function renderPerformanceHighlights(blocks){
  const container=document.getElementById("performance-highlights");
  if(!container) return;
  const completed=(Array.isArray(blocks)?blocks:[]).filter(block=>Array.isArray(block.games) && block.games.length);
  const games=completed.flatMap(block=>block.games.map(Number)).filter(Number.isFinite);
  if(!games.length){
    container.innerHTML='<p class="muted">Highlights will appear when scores are posted.</p>';
    return;
  }

  const blockAverages=completed.map(block=>({
    round:block.round,
    average:Number(block.total ?? block.games.reduce((sum,score)=>sum+Number(score),0))/block.games.length
  }));
  const latest=blockAverages[blockAverages.length-1];
  const previous=blockAverages.length>1 ? blockAverages[blockAverages.length-2] : null;
  const best=blockAverages.reduce((top,item)=>item.average>top.average?item:top,blockAverages[0]);
  const trend=previous ? latest.average-previous.average : null;
  const cards=[
    ["High game",Math.max(...games),`Across ${games.length} posted games`],
    ["Low game",Math.min(...games),"Useful consistency floor"],
    ["Latest block",latest.average.toFixed(2),`Round ${latest.round} average`],
    ["Best block",best.average.toFixed(2),`Round ${best.round} average`],
    ["Block trend",trend==null?"Baseline":`${trend>0?"+":""}${trend.toFixed(2)}`,trend==null?"Compare after Round 2":`${trend>=0?"Improvement":"Change"} from prior block`]
  ];
  container.innerHTML=cards.map(([label,value,note])=>`<article><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></article>`).join("");
}

function renderEquipment(equipment){
  const grid=document.getElementById("equipment-grid");
  if(!grid) return;

  const balls=equipment.balls || [];
  setText("equipment-count", `${balls.length} ball${balls.length===1?"":"s"}`);
  setText(
    "equipment-summary",
    `${equipment.handedness || "Bowler"} · ${balls.length} of ${equipment.max_allowed || balls.length} allowed balls registered`
  );

  if(!balls.length){
    grid.innerHTML='<p class="muted">No equipment has been added.</p>';
    return;
  }

  grid.innerHTML=balls.map((ball,index)=>{
    const alias = ball.registered_name && ball.registered_name !== ball.name
      ? `<small>Registered as: ${escapeHtml(ball.registered_name)}</small>`
      : "";
    const restriction = ball.restriction
      ? `<div class="equipment-restriction">${escapeHtml(ball.restriction)}</div>`
      : "";
    const imageNote = ball.image_note
      ? `<small class="equipment-image-note">${escapeHtml(ball.image_note)}</small>`
      : "";

    return `
      <article class="equipment-card">
        <a class="equipment-image-wrap" href="${escapeHtml(ball.source_url)}" target="_blank" rel="noopener">
          <img
            class="equipment-image"
            src="${escapeHtml(ball.image)}"
            alt="${escapeHtml(ball.brand)} ${escapeHtml(ball.name)} bowling ball"
            loading="lazy"
            referrerpolicy="no-referrer"
            onerror="this.style.display='none';this.nextElementSibling.style.display='grid';"
          >
          <span class="equipment-image-fallback" aria-hidden="true">${escapeHtml(ball.brand.slice(0,2).toUpperCase())}</span>
          ${ball.representative_image ? '<span class="representative-badge">Representative image</span>' : ''}
        </a>
        <div class="equipment-card-body">
          <p class="equipment-brand">${escapeHtml(ball.brand)}</p>
          <h3>${escapeHtml(ball.name)}</h3>
          ${alias}
          <div class="equipment-tags">
            <span>${escapeHtml(ball.type)}</span>
            <span>${escapeHtml(ball.role)}</span>
          </div>
          ${restriction}
          <div class="equipment-serial">
            <span>Registered serial</span>
            <strong>${escapeHtml(ball.serial)}</strong>
          </div>
          ${imageNote}
          <a class="equipment-source" href="${escapeHtml(ball.source_url)}" target="_blank" rel="noopener">Product source ↗</a>
        </div>
      </article>
    `;
  }).join("");
}

function renderBlocks(blocks){
  document.getElementById("blocks").innerHTML=blocks.map((b,i)=>{
    const games=Array.isArray(b.games) ? b.games : [];
    const total=Number(b.total)>0 ? Number(b.total) : null;
    const totalText=total && games.length
      ? `${total.toLocaleString()} pins · ${(total/games.length).toFixed(2)} avg.`
      : total ? `${total.toLocaleString()} pins · individual games unavailable` : "Pending";
    return `
    <article class="block">
      <h3>Round ${b.round || i+1}</h3>
      <div class="games">${games.map(g=>`<span class="game">${g}</span>`).join("") || `<span class="muted">${total?"Scores unavailable":"Not bowled"}</span>`}</div>
      <p class="block-total">${totalText}</p>
    </article>`;
  }).join("");
}

function currentYearComparisonRows(data){
  const historyByGames=new Map();
  (Array.isArray(data.history) ? data.history : []).forEach(snapshot=>{
    const games=Number(snapshot.games_complete);
    if(games>0) historyByGames.set(games,snapshot);
  });

  let cumulativeTotal=0;
  let previousBlocksComplete=true;
  return (Array.isArray(data.blocks) ? data.blocks : []).map((block,index)=>{
    const round=Number(block.round || index+1);
    const games=(Array.isArray(block.games) ? block.games : []).map(Number).filter(Number.isFinite);
    const calculatedTotal=games.reduce((sum,score)=>sum+score,0);
    const blockTotal=block.total == null ? calculatedTotal : Number(block.total);
    const complete=games.length===4 && Number.isFinite(blockTotal) && calculatedTotal===blockTotal && previousBlocksComplete;
    if(complete) cumulativeTotal+=blockTotal;
    else previousBlocksComplete=false;

    const gamesComplete=round*4;
    const snapshot=historyByGames.get(gamesComplete)
      || (Number(data.current?.games_complete)===gamesComplete ? data.current : null);
    const isLatestSource=Number(data.current?.games_complete)===gamesComplete;

    return {
      round,
      games:complete ? games : [],
      total:complete ? blockTotal : null,
      cumulative_total:complete ? cumulativeTotal : null,
      cumulative_average:complete ? cumulativeTotal/gamesComplete : null,
      position:complete ? snapshot?.position ?? null : null,
      field_size:complete ? snapshot?.field_size ?? data.field_size?.current_report ?? null : null,
      source_url:complete ? snapshot?.source_url ?? (isLatestSource ? data.source_status?.source_url : null) : null,
      complete
    };
  });
}

function signedNumber(value,digits=0){
  const number=Number(value);
  if(!Number.isFinite(number)) return "—";
  return `${number>0?"+":""}${number.toFixed(digits)}`;
}

function comparisonSummaryCard(label,value,note,tone=""){
  return `<article class="comparison-summary-card ${tone}">
    <span>${escapeHtml(label)}</span>
    <strong>${escapeHtml(value)}</strong>
    <small>${escapeHtml(note)}</small>
  </article>`;
}

function comparisonYearColumn(year,row,fieldSize,isCurrent=false){
  if(!row?.complete && !Array.isArray(row?.games)){
    return `<section class="comparison-year-column pending">
      <div class="comparison-year-label"><strong>${year}</strong><span>Pending</span></div>
      <p class="comparison-pending">Waiting for the official four-game block.</p>
    </section>`;
  }

  const complete=row?.complete !== false && Array.isArray(row?.games) && row.games.length===4;
  if(!complete){
    return `<section class="comparison-year-column pending">
      <div class="comparison-year-label"><strong>${year}</strong><span>Pending</span></div>
      <p class="comparison-pending">Waiting for the official four-game block.</p>
    </section>`;
  }

  const position=row.position == null
    ? "Position unavailable"
    : `#${row.position}${row.tied?"T":""}${fieldSize ? ` of ${Number(fieldSize).toLocaleString()}${isCurrent?" published":""}` : ""}`;
  const source=row.source_url
    ? `<a href="${escapeHtml(row.source_url)}" target="_blank" rel="noopener">Official report ↗</a>`
    : "";

  return `<section class="comparison-year-column ${isCurrent?"current-year-column":"previous-year-column"}">
    <div class="comparison-year-label"><strong>${year}</strong><span>${isCurrent?"Live":"Final"}</span></div>
    <div class="comparison-games">${row.games.map(score=>`<span>${score}</span>`).join("")}</div>
    <div class="comparison-year-total">
      <strong>${Number(row.total).toLocaleString()}</strong>
      <span>block pins</span>
    </div>
    <dl>
      <div><dt>Cumulative</dt><dd>${Number(row.cumulative_total).toLocaleString()}</dd></div>
      <div><dt>Average</dt><dd>${Number(row.cumulative_average).toFixed(2)}</dd></div>
      <div><dt>Position</dt><dd>${escapeHtml(position)}</dd></div>
    </dl>
    ${source}
  </section>`;
}

function renderYearComparison(comparison,data){
  const summary=document.getElementById("year-comparison-summary");
  const chart=document.getElementById("year-comparison-chart");
  const days=document.getElementById("year-comparison-days");
  const sources=document.getElementById("year-comparison-sources");
  if(!summary || !chart || !days || !sources) return;

  const previous=comparison.previous_year || {};
  const previousYear=Number(previous.year || 2025);
  const currentYear=Number(comparison.current_year || 2026);
  const previousBlocks=Array.isArray(previous.blocks) ? previous.blocks.map(block=>({...block,complete:true})) : [];
  const currentBlocks=currentYearComparisonRows(data);
  const completedCurrent=currentBlocks.filter(block=>block.complete);
  const latestCurrent=completedCurrent.at(-1);
  const matchingPrevious=latestCurrent ? previousBlocks.find(block=>Number(block.round)===Number(latestCurrent.round)) : null;
  const finalPrevious=previous.final_qualifying || previousBlocks.at(-1) || {};

  setText(
    "year-comparison-basis",
    comparison.comparison_basis || "Each day compares the same four-game qualifying checkpoint."
  );

  if(latestCurrent && matchingPrevious){
    const pinDifference=Number(latestCurrent.cumulative_total)-Number(matchingPrevious.cumulative_total);
    const averageDifference=Number(latestCurrent.cumulative_average)-Number(matchingPrevious.cumulative_average);
    summary.innerHTML=[
      comparisonSummaryCard(
        `Through Day ${latestCurrent.round}`,
        `${signedNumber(pinDifference)} pins`,
        `${currentYear}: ${Number(latestCurrent.cumulative_total).toLocaleString()} · ${previousYear}: ${Number(matchingPrevious.cumulative_total).toLocaleString()}`,
        pinDifference>=0?"positive-card":"negative-card"
      ),
      comparisonSummaryCard(
        "Average change",
        signedNumber(averageDifference,2),
        `${Number(latestCurrent.cumulative_average).toFixed(2)} vs. ${Number(matchingPrevious.cumulative_average).toFixed(2)}`,
        averageDifference>=0?"positive-card":"negative-card"
      ),
      comparisonSummaryCard(
        `${previousYear} qualifying finish`,
        Number(finalPrevious.total).toLocaleString(),
        `${Number(finalPrevious.average).toFixed(2)} avg. · #${finalPrevious.position}${finalPrevious.tied?"T":""} of ${Number(finalPrevious.field_size).toLocaleString()}`
      ),
      comparisonSummaryCard(
        `${currentYear} live checkpoint`,
        `Day ${latestCurrent.round} of 4`,
        latestCurrent.position == null
          ? `${latestCurrent.round*4} games complete`
          : `#${latestCurrent.position} of ${Number(latestCurrent.field_size).toLocaleString()} published`
      )
    ].join("");
  }else{
    summary.innerHTML=comparisonSummaryCard(
      `${currentYear} comparison pending`,
      "Waiting for scores",
      `The ${previousYear} baseline is ready and will compare automatically after the first complete block.`
    );
  }

  const totals=[
    ...previousBlocks.map(block=>Number(block.total)),
    ...currentBlocks.filter(block=>block.complete).map(block=>Number(block.total))
  ].filter(Number.isFinite);
  const chartMax=Math.max(800,Math.ceil(Math.max(...totals,0)/100)*100);
  const labels=[];
  const rounds=[1,2,3,4];

  chart.setAttribute("role","img");
  rounds.forEach(round=>{
    const oldBlock=previousBlocks.find(block=>Number(block.round)===round);
    const newBlock=currentBlocks.find(block=>Number(block.round)===round && block.complete);
    labels.push(`Day ${round}: ${previousYear} ${oldBlock?.total ?? "unavailable"}; ${currentYear} ${newBlock?.total ?? "pending"}`);
  });
  chart.setAttribute("aria-label",`Four-game block totals. ${labels.join(". ")}.`);
  chart.innerHTML=`
    <div class="comparison-chart-scale" aria-hidden="true"><span>${chartMax}</span><span>${Math.round(chartMax/2)}</span><span>0</span></div>
    <div class="comparison-chart-groups" aria-hidden="true">
      ${rounds.map(round=>{
        const oldBlock=previousBlocks.find(block=>Number(block.round)===round);
        const newBlock=currentBlocks.find(block=>Number(block.round)===round && block.complete);
        const oldHeight=oldBlock ? Math.max(0,Math.min(100,(Number(oldBlock.total)/chartMax)*100)) : 0;
        const newHeight=newBlock ? Math.max(0,Math.min(100,(Number(newBlock.total)/chartMax)*100)) : 0;
        return `<div class="comparison-chart-group">
          <div class="comparison-chart-bars">
            <div class="comparison-chart-bar previous-year-bar" style="--comparison-height:${oldHeight}%"><span>${oldBlock?.total ?? "—"}</span></div>
            ${newBlock
              ? `<div class="comparison-chart-bar current-year-bar" style="--comparison-height:${newHeight}%"><span>${newBlock.total}</span></div>`
              : '<div class="comparison-chart-bar pending-year-bar"><span>Pending</span></div>'}
          </div>
          <strong>Day ${round}</strong>
        </div>`;
      }).join("")}
    </div>`;

  days.innerHTML=rounds.map(round=>{
    const oldBlock=previousBlocks.find(block=>Number(block.round)===round);
    const newBlock=currentBlocks.find(block=>Number(block.round)===round);
    const difference=newBlock?.complete && oldBlock
      ? Number(newBlock.cumulative_total)-Number(oldBlock.cumulative_total)
      : null;
    return `<article class="comparison-day-card">
      <header>
        <div><span>Qualifying checkpoint</span><h3>Day ${round}</h3></div>
        <strong class="comparison-day-difference ${difference==null?"pending":difference>=0?"positive":"negative"}">
          ${difference==null?`${currentYear} pending`:`${signedNumber(difference)} cumulative pins`}
        </strong>
      </header>
      <div class="comparison-year-columns">
        ${comparisonYearColumn(previousYear,oldBlock,previous.field_size,false)}
        ${comparisonYearColumn(currentYear,newBlock,newBlock?.field_size,true)}
      </div>
    </article>`;
  }).join("");

  const previousSource=comparison.source_page || "https://bowl.com/youth/youth-tournaments/junior-gold-championships/2025-results";
  sources.innerHTML=`
    <a href="${escapeHtml(previousSource)}" target="_blank" rel="noopener">Official ${previousYear} results ↗</a>
    <a href="https://bowl.com/youth/youth-tournaments/junior-gold-championships/2026-results" target="_blank" rel="noopener">Official ${currentYear} results ↗</a>`;
}

function stateLeaderboardBaseline(yearData,bowlers){
  const preferred=explorerSelectedProfile || activeDashboardContext?.profile;
  const matched=preferred ? matchingExplorerProfile(preferred,yearData) : null;
  return matched || (yearData?.bowlers || []).find(bowler=>isJackWix(bowler)) || bowlers[0] || null;
}

function refreshStateLeaderboard(refreshVisibility=true){
  const select=document.getElementById("explorer-state");
  const yearData=explorerYearData(explorerSelectedYear);
  const stateCode=select?.value || "";
  const division=yearData?.division || EXPLORER_DIVISIONS[explorerSelectedDivision] || "Junior Gold";
  const hasStateSelection=Boolean(yearData && stateCode && stateCode!=="__NONE__");
  if(!hasStateSelection){
    setSectionAvailability("section-alabama",false);
    setText("state-leaderboard-eyebrow",`${explorerSelectedYear} state results`);
    setText("alabama-title",`State ${division} participants`);
    if(refreshVisibility) refreshSectionVisibilityLabels();
    return;
  }

  const stateName=STATE_NAMES[stateCode] || stateCode;
  const bowlers=(yearData.bowlers || [])
    .filter(bowler=>explorerStateValue(bowler)===stateCode)
    .sort((a,b)=>(a.rank==null?Number.MAX_SAFE_INTEGER:Number(a.rank))-(b.rank==null?Number.MAX_SAFE_INTEGER:Number(b.rank)) || a.name.localeCompare(b.name));
  if(!bowlers.length){
    setSectionAvailability("section-alabama",false);
    if(refreshVisibility) refreshSectionVisibilityLabels();
    return;
  }
  setSectionAvailability("section-alabama",true);
  const baseline=stateLeaderboardBaseline(yearData,bowlers);
  const isFinal=yearData.status==="final";
  const context={stateCode,stateName,year:String(yearData.year),fieldSize:yearData.field_size,baseline};

  setText("state-leaderboard-eyebrow",`${yearData.year} selected state`);
  setText("alabama-title",`${stateName} ${division} participants`);
  setText("favorites-title",`Favorite ${stateName} bowlers`);
  setText("state-comparison-heading",`vs. ${baseline?.name || "selected bowler"}`);
  const pill=document.getElementById("alabama-status-pill");
  pill.textContent=isFinal ? `Final ${yearData.year} field` : `Live ${yearData.year} field`;
  pill.className=`pill ${isFinal ? "alabama-complete" : "alabama-partial"}`;
  setText(
    "alabama-status-note",
    `${bowlers.length.toLocaleString()} ${stateName} ${division} bowler${bowlers.length===1?"":"s"}. ${Number(yearData.result_profile_count || yearData.field_size || 0).toLocaleString()} division profiles currently have published qualifying results; registered participants without scores remain listed as pending.`
  );
  renderAlabama(bowlers,baseline,context);
  if(refreshVisibility) refreshSectionVisibilityLabels();
}

function sameLeaderboardBowler(left,right){
  if(!left || !right) return false;
  if(left.id && right.id) return left.id===right.id;
  return normalizeExplorerText(left.name)===normalizeExplorerText(right.name)
    && normalizeExplorerText(left.hometown)===normalizeExplorerText(right.hometown);
}

function renderAlabama(bowlers,baseline,context){
  const body=document.getElementById("alabama-bowlers");
  if(!body) return;
  if(!bowlers.length){
    body.innerHTML=`<tr><td colspan="8" class="muted">No ${escapeHtml(context.stateName)} bowlers found in these results.</td></tr>`;
    renderFavoriteBowlers([],baseline,context);
    return;
  }

  body.innerHTML=bowlers.map((b,index)=>{
    const isBaseline=sameLeaderboardBowler(b,baseline);
    const isFavorite=favoriteBowlers.includes(b.name);
    const diff=baseline ? Number(b.total)-Number(baseline.total) : null;
    const diffText=isBaseline ? "Baseline" : Number.isFinite(diff) ? `${diff>0?"+":""}${diff}` : "—";
    const rank=b.rank ?? b.position;
    const comparisonLabel=`vs. ${baseline?.name || "selected bowler"}`;

    return `<tr class="${isBaseline?"comparison-anchor":""}">
      <td class="favorite-cell" data-label="Favorite">
        <button class="favorite-button" type="button" data-favorite-index="${index}" aria-pressed="${isFavorite}" aria-label="${isFavorite?"Remove":"Add"} ${escapeHtml(b.name)} ${isFavorite?"from":"to"} favorites">${isFavorite?"★":"☆"}</button>
      </td>
      <td class="rank" data-label="Rank">${rank==null?"Pending":`#${rank}${b.tied?"T":""}`}</td>
      <td class="bowler" data-label="Bowler">
        <button class="bowler-name-button" type="button" data-bowler-index="${index}" aria-label="View tournament details for ${escapeHtml(b.name)}">
          ${escapeHtml(b.name)}${isBaseline?" ◆":""}
        </button>
      </td>
      <td data-label="Hometown">${escapeHtml(b.hometown)}</td>
      <td data-label="Games">${Number(b.games_complete)>0?b.games_complete:"—"}</td>
      <td data-label="Total">${b.total==null?"—":Number(b.total).toLocaleString()}</td>
      <td data-label="Average">${b.average==null?"—":Number(b.average).toFixed(2)}</td>
      <td data-label="${escapeHtml(comparisonLabel)}" class="${diff>0?"positive":diff<0?"negative":""}">${diffText}</td>
    </tr>`;
  }).join("");

  body.querySelectorAll(".bowler-name-button").forEach(button=>{
    button.addEventListener("click",()=>{
      const bowler=bowlers[Number(button.dataset.bowlerIndex)];
      openBowlerDialog(bowler,baseline,context);
    });
  });

  body.querySelectorAll(".favorite-button").forEach(button=>{
    button.addEventListener("click",()=>{
      const bowler=bowlers[Number(button.dataset.favoriteIndex)];
      const favorites=new Set(favoriteBowlers);
      if(favorites.has(bowler.name)) favorites.delete(bowler.name);
      else favorites.add(bowler.name);
      favoriteBowlers=[...favorites];
      writeStoredJson(FAVORITES_KEY,favoriteBowlers);
      renderAlabama(bowlers,baseline,context);
    });
  });

  renderFavoriteBowlers(bowlers,baseline,context);
}

function renderFavoriteBowlers(bowlers,baseline,context){
  const container=document.getElementById("favorite-bowlers");
  if(!container) return;
  const favorites=bowlers.filter(bowler=>favoriteBowlers.includes(bowler.name));
  if(!favorites.length){
    container.innerHTML=`<p class="favorites-empty">No favorites selected yet. Star ${escapeHtml(context.stateName)} bowlers to keep their position and average together here.</p>`;
    return;
  }

  container.innerHTML=favorites.map(bowler=>{
    const index=bowlers.indexOf(bowler);
    const isBaseline=sameLeaderboardBowler(bowler,baseline);
    const diff=baseline ? Number(bowler.total)-Number(baseline.total) : null;
    const rank=bowler.rank ?? bowler.position;
    return `<article class="favorite-card ${isBaseline?"comparison-anchor":""}">
      <button type="button" class="favorite-profile" data-bowler-index="${index}">${escapeHtml(bowler.name)}</button>
      <div><span>Rank</span><strong>${rank==null?"Pending":`#${rank}${bowler.tied?"T":""}`}</strong></div>
      <div><span>Average</span><strong>${bowler.average==null?"—":Number(bowler.average).toFixed(2)}</strong></div>
      <div><span>vs. ${escapeHtml(baseline?.name || "selected bowler")}</span><strong>${isBaseline?"Baseline":Number.isFinite(diff)?`${diff>0?"+":""}${diff}`:"—"}</strong></div>
    </article>`;
  }).join("");

  container.querySelectorAll(".favorite-profile").forEach(button=>{
    button.addEventListener("click",()=>openBowlerDialog(bowlers[Number(button.dataset.bowlerIndex)],baseline,context));
  });
}

function openBowlerDialog(bowler,baseline,context){
  const dialog=document.getElementById("bowler-dialog");
  if(!dialog || !bowler) return;

  const isBaseline=sameLeaderboardBowler(bowler,baseline);
  const diff=baseline ? Number(bowler.total)-Number(baseline.total) : null;
  const rank=bowler.rank ?? bowler.position;

  setText("state-bowler-dialog-kicker",`${context.stateName} bowler profile`);
  setText("bowler-dialog-title",bowler.name);
  setText("bowler-dialog-hometown",bowler.hometown || context.stateName);

  const stats=[
    ["Overall rank",rank==null ? "Results pending" : `#${rank}${bowler.tied?"T":""}${context.fieldSize ? ` of ${Number(context.fieldSize).toLocaleString()}` : ""}`],
    ["Games complete",bowler.games_complete ?? "—"],
    ["Total pins",bowler.total ?? "—"],
    ["Average",bowler.average == null ? "—" : Number(bowler.average).toFixed(2)],
    [`Compared with ${baseline?.name || "selected bowler"}`,isBaseline ? "Baseline" : Number.isFinite(diff) ? `${diff>0?"+":""}${diff} pins` : "—"]
  ];

  document.getElementById("bowler-dialog-stats").innerHTML=stats.map(([label,value])=>`
    <div class="bowler-stat">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `).join("");

  const blocks=Array.isArray(bowler.blocks) ? bowler.blocks : [];
  const rounds=document.getElementById("bowler-dialog-rounds");

  if(blocks.length){
    rounds.innerHTML=blocks.map((block,index)=>{
      const games=Array.isArray(block.games) ? block.games : [];
      const total=block.total ?? (games.length ? games.reduce((sum,score)=>sum+Number(score),0) : null);
      return `<article class="bowler-round-card">
        <h4>Round ${block.round || index+1}</h4>
        <div class="games">${games.length ? games.map(score=>`<span class="game">${score}</span>`).join("") : '<span class="muted">Scores not posted</span>'}</div>
        <p>${total == null ? "Pending" : games.length ? `${total} pins · ${(total/games.length).toFixed(2)} avg.` : `${total} pins · individual games unavailable`}</p>
      </article>`;
    }).join("");
  }else if(Array.isArray(bowler.scores) && bowler.scores.length){
    rounds.innerHTML=`<article class="bowler-round-card">
      <h4>Latest posted block</h4>
      <div class="games">${bowler.scores.map(score=>`<span class="game">${score}</span>`).join("")}</div>
      <p>${bowler.scores.reduce((sum,score)=>sum+Number(score),0)} pins</p>
    </article>`;
  }else{
    rounds.innerHTML='<p class="muted">Individual game scores are not available in the current report snapshot. Rank, total, and average are shown above.</p>';
  }

  if(typeof dialog.showModal==="function"){
    dialog.showModal();
  }else{
    dialog.setAttribute("open","");
  }
}

function setupBowlerDialog(){
  const dialog=document.getElementById("bowler-dialog");
  const close=document.getElementById("bowler-dialog-close");
  if(!dialog || !close) return;

  close.addEventListener("click",()=>dialog.close());
  dialog.addEventListener("click",event=>{
    if(event.target===dialog) dialog.close();
  });
}

function renderLastQualifier(schedule, blocks){
  const completed = schedule
    .map((s, i) => ({...s, index:i, completed: (blocks[i] && blocks[i].games && blocks[i].games.length > 0)}))
    .filter(s => s.completed);
  if(!completed.length){
    setText("last-title","Not bowled yet");
    setText("last-detail","The first qualifying block has not been recorded.");
    return;
  }
  const last = completed[completed.length - 1];
  const dt = new Intl.DateTimeFormat("en-US",{
    weekday:"long",month:"long",day:"numeric",hour:"numeric",minute:"2-digit",
    timeZone:"America/Chicago",timeZoneName:"short"
  }).format(new Date(last.start));
  setText("last-title", last.title);
  setText("last-detail", `${dt} · ${last.location}`);
}

function calendarTimestamp(date){
  return date.toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z");
}

function calendarUrl(event){
  const start=new Date(event.start);
  const end=new Date(start.getTime()+Number(event.duration_minutes || 180)*60000);
  const params=new URLSearchParams({
    action:"TEMPLATE",
    text:`Jack Wix · ${event.title}`,
    dates:`${calendarTimestamp(start)}/${calendarTimestamp(end)}`,
    details:"Jack Wix bowling in the U18 Boys division at the 2026 Junior Gold Championships.",
    location:event.location || ""
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function mapUrl(event){
  if(event.map_url) return event.map_url;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location || "")}`;
}

function renderNextActions(schedule){
  const container=document.getElementById("next-actions");
  if(!container) return;
  const next=(schedule || []).find(event=>new Date(event.start).getTime()>Date.now());
  if(!next){
    container.innerHTML='<span class="next-action-note">Qualifying schedule complete</span>';
    return;
  }

  const stream=next.livestream || {};
  container.innerHTML=`
    <a href="${escapeHtml(mapUrl(next))}" target="_blank" rel="noopener">Open in Maps ↗</a>
    <a href="${escapeHtml(calendarUrl(next))}" target="_blank" rel="noopener">Add to Calendar ↗</a>
    ${stream.available && stream.url
      ? `<a href="${escapeHtml(stream.url)}" target="_blank" rel="noopener">${escapeHtml(stream.label || "Watch on BowlTV")} ↗</a>`
      : '<span class="next-action-note">No BowlTV stream listed for this center</span>'}
  `;
}

function renderTournamentPath(stages,current){
  const list=document.getElementById("tournament-path");
  if(!list) return;
  const defaults=[
    {id:"qualifying",title:"Qualifying",detail:"Four blocks · 16 games"},
    {id:"advancers",title:"Advancers Round",detail:"Five games after the first cut"},
    {id:"final-advancers",title:"Final Advancers",detail:"Five additional games after the second cut"},
    {id:"match-play",title:"Match Play",detail:"Top 16 bowlers"}
  ];
  const path=Array.isArray(stages) && stages.length ? stages : defaults;
  const games=Number(current.games_complete || 0);
  const activeIndex=games<16 ? 0 : 1;

  list.innerHTML=path.map((stage,index)=>{
    const state=index<activeIndex ? "complete" : index===activeIndex ? "current" : "future";
    const stateLabel=state==="complete" ? "Complete" : state==="current" ? (index===0 ? `${games} of 16 games` : "Awaiting official advancement status") : "Must advance";
    return `<li class="path-stage ${state}" ${state==="current"?'aria-current="step"':""}>
      <span class="path-marker" aria-hidden="true">${state==="complete"?"✓":index+1}</span>
      <div>
        <span class="path-state">${escapeHtml(stateLabel)}</span>
        <strong>${escapeHtml(stage.title)}</strong>
        <small>${escapeHtml(stage.detail)}</small>
      </div>
    </li>`;
  }).join("");
}

function shareText(data){
  const context=activeDashboardContext;
  const current=context?.current || data.current || {};
  const name=context?.name || "Jack Wix";
  const year=context?.year || "2026";
  const field=context?.yearData?.field_size ?? data.field_size?.current_report ?? current.field_size;
  const next=context?.isDefaultJack ? (data.schedule || []).find(event=>new Date(event.start).getTime()>Date.now()) : null;
  const lines=[
    `${name} Junior Gold ${year} update: #${current.position ?? current.rank ?? "—"}${field ? ` of ${field}` : ""} after ${current.games_complete ?? "—"} of 16 qualifying games.`,
    `${current.total ?? "—"} total pins · ${current.average==null?"—":Number(current.average).toFixed(2)} average.`
  ];
  if(next) lines.push(`Next: ${next.title}, ${fmt.format(new Date(next.start))} at ${next.location}.`);
  lines.push(location.href);
  return lines.join(" ");
}

function copyText(text){
  if(navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const field=document.createElement("textarea");
  field.value=text;
  field.setAttribute("readonly","");
  field.style.position="fixed";
  field.style.opacity="0";
  document.body.appendChild(field);
  field.select();
  const copied=document.execCommand("copy");
  field.remove();
  return copied ? Promise.resolve() : Promise.reject(new Error("Copy command was unavailable"));
}

function setupShareButton(){
  const button=document.getElementById("share-dashboard");
  const status=document.getElementById("share-status");
  if(!button || !status) return;
  button.addEventListener("click",async()=>{
    if(!dashboardData){
      status.textContent="Dashboard data is still loading.";
      return;
    }
    const text=shareText(dashboardData);
    try{
      if(typeof navigator.share==="function"){
        const context=activeDashboardContext;
        await navigator.share({title:`${context?.name || "Jack Wix"} · Junior Gold ${context?.year || "2026"}`,text,url:location.href});
        status.textContent="Family update shared.";
      }else{
        await copyText(text);
        status.textContent="Family update copied.";
      }
    }catch(error){
      if(error?.name==="AbortError") return;
      try{
        await copyText(text);
        status.textContent="Family update copied.";
      }catch(copyError){
        console.error(copyError);
        status.textContent="Sharing is unavailable in this browser.";
      }
    }
  });
}

function renderSchedule(schedule){
  const now=Date.now(), future=schedule.filter(s=>new Date(s.start).getTime()>now);
  const next=future[0]?.start;
  document.getElementById("schedule").innerHTML=schedule.map(s=>`
    <div class="schedule-row ${s.start===next?"next":""}">
      <strong>${new Intl.DateTimeFormat("en-US",{weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZone:"America/Chicago"}).format(new Date(s.start))}</strong>
      <span>${s.title}<br><small class="muted">${s.location}</small></span>
      <span class="pill">${new Date(s.start).getTime()<now?"Completed":s.start===next?"Next":"Upcoming"}</span>
    </div>`).join("");
}
function startCountdown(schedule){
  const update=()=>{
    const now=Date.now(), next=schedule.find(s=>new Date(s.start).getTime()>now);
    if(!next){
      setText("next-title","Qualifying schedule complete");
      setText("next-detail","Watch the standings for advancement information.");
      setText("countdown","Complete");
      return;
    }
    const t=new Date(next.start).getTime()-now;
    const days=Math.floor(t/86400000), hrs=Math.floor(t%86400000/3600000), mins=Math.floor(t%3600000/60000), secs=Math.floor(t%60000/1000);
    setText("next-title",next.title);
    setText("next-detail",`${fmt.format(new Date(next.start))} · ${next.location}`);
    setText("countdown",`${days}d ${String(hrs).padStart(2,"0")}h ${String(mins).padStart(2,"0")}m ${String(secs).padStart(2,"0")}s`);
  };
  update(); setInterval(update,1000);
}
async function loadDashboardVersion(){
  const response=await fetch(`VERSION?v=${Date.now()}`,{cache:"no-store"});
  if(!response.ok) throw new Error(`Dashboard version request failed: ${response.status}`);
  const version=(await response.text()).trim();
  if(!/^\d+$/.test(version)) throw new Error(`Invalid dashboard version: ${version}`);
  setText("dashboard-version",`Dashboard version v${version}`);
}
setupCollapsibleSections();
setupSectionControls();
setupSectionVisibilityManager();
setupBowlerDialog();
setupShareButton();
setupDashboardRefresh();
loadDashboardVersion().catch(error=>{
  console.error(error);
  setText("dashboard-version","Dashboard version unavailable");
});
load().catch(err=>{console.error(err);setText("next-title","Unable to load dashboard data")});
