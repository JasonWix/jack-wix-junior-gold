let dashboardData = null;
let bowlerExplorerData = null;
let explorerSelectedProfile = null;
let explorerSelectedYear = "2026";

const SECTION_STATE_KEY = "jack-wix-dashboard:section-state";
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
  const saved=readStoredJson(SECTION_STATE_KEY,{});

  document.querySelectorAll("details.dashboard-section").forEach(section=>{
    if(saved[section.id] === false) section.open=false;
    if(saved[section.id] === true) section.open=true;

    section.addEventListener("toggle",()=>{
      saved[section.id]=section.open;
      writeStoredJson(SECTION_STATE_KEY,saved);
    });
  });
}

function setupSectionControls(){
  const sections=[...document.querySelectorAll("details.dashboard-section")];
  const expand=document.getElementById("expand-all");
  const collapse=document.getElementById("collapse-all");
  expand?.addEventListener("click",()=>sections.forEach(section=>{section.open=true;}));
  collapse?.addEventListener("click",()=>sections.forEach(section=>{section.open=false;}));
}

const fmt = new Intl.DateTimeFormat("en-US",{weekday:"long",month:"long",day:"numeric",hour:"numeric",minute:"2-digit",timeZone:"America/Chicago",timeZoneName:"short"});

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
  renderSinceLastVisit(d);

  renderBlocks(d.blocks);
  renderYearComparison(d.year_comparison || {}, d);
  renderProgress(d.history || [], d.current || {}, d.cut_projection || {});
  renderPerformanceHighlights(d.blocks || []);
  renderEquipment(d.equipment || {});
  renderAlabamaStatus(d.alabama_status || {});
  renderAlabama(d.alabama_bowlers || [], d.current.total);
  renderLastQualifier(d.schedule, d.blocks);
  renderSchedule(d.schedule);
  renderNextActions(d.schedule);
  renderTournamentPath(d.tournament_path || [], d.current || {});
  startCountdown(d.schedule);
  loadBowlerExplorer().catch(error=>{
    console.error(error);
    setText("explorer-data-status","Bowler list unavailable");
    setText("explorer-search-status","The searchable bowler data could not be loaded. Jack's dashboard remains available below.");
  });
}


function renderCutProjection(current, projection){
  const fc=document.getElementById("from-cut");
  const needed=document.getElementById("needed-average");
  const diff=current.pins_from_cut;
  const neededValue=current.needed_average;
  const isPlaceholder=projection.status !== "official";

  fc.textContent=diff == null ? "Pending" : `${isPlaceholder ? "≈ " : ""}${diff > 0 ? "+" : ""}${diff}`;
  fc.className=diff == null ? "" : diff >= 0 ? "positive" : "negative";
  needed.textContent=neededValue == null ? "Pending" : `${isPlaceholder ? "≈ " : ""}${Number(neededValue).toFixed(1)}`;

  setText("cut-status-badge", projection.label || (isPlaceholder ? "Placeholder estimate" : "Official cut"));
  setText("cut-status-title", projection.title || (isPlaceholder ? "There is no official cut yet" : "Official advancement cut"));
  setText("cut-status-explanation", projection.explanation || "The cut is established only after all U18 Boys complete 16 qualifying games.");
  setText("cut-gap-basis", projection.gap_basis || "Temporary comparison only");
  setText("needed-average-basis", projection.needed_average_basis || "Temporary target only");

  const badge=document.getElementById("cut-status-badge");
  badge.className=`cut-status-badge ${isPlaceholder ? "placeholder" : "official-cut"}`;
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

function setText(id,v){document.getElementById(id).textContent=v}

function escapeHtml(value){
  return String(value ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function normalizeExplorerText(value){
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g," ")
    .trim();
}

function explorerYearData(year){
  return bowlerExplorerData?.years?.[String(year)] || null;
}

function explorerReport(yearData,round){
  const reports=Array.isArray(yearData?.reports) ? yearData.reports : [];
  return reports.find(report=>Number(report.round)===Number(round)) || reports.at(-1) || null;
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
  document.querySelectorAll("[data-explorer-year]").forEach(button=>{
    button.setAttribute("aria-pressed",String(button.dataset.explorerYear===explorerSelectedYear));
  });
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
  document.getElementById("explorer-results").innerHTML="";
  setText("explorer-search-status",`Type at least two characters to search the ${explorerSelectedYear} U18 Boys field.`);
  if(clearUrl){
    const url=new URL(location.href);
    url.searchParams.delete("year");
    url.searchParams.delete("bowler");
    history.replaceState({},"",url);
  }
}

function renderExplorerMatches(){
  const search=document.getElementById("explorer-search");
  const results=document.getElementById("explorer-results");
  const yearData=explorerYearData(explorerSelectedYear);
  const query=normalizeExplorerText(search.value);
  results.innerHTML="";

  if(query.length<2){
    setText("explorer-search-status",`Type at least two characters to search the ${explorerSelectedYear} U18 Boys field.`);
    return;
  }

  const matches=(yearData?.bowlers || []).filter(bowler=>{
    const haystack=normalizeExplorerText(`${bowler.name} ${bowler.hometown}`);
    return query.split(" ").every(term=>haystack.includes(term));
  });
  const visible=matches.slice(0,20);
  setText(
    "explorer-search-status",
    matches.length
      ? `${matches.length.toLocaleString()} match${matches.length===1?"":"es"} in ${explorerSelectedYear}. Select a name to open the profile.`
      : `No ${explorerSelectedYear} U18 Boys bowlers matched “${search.value.trim()}”.`
  );

  results.innerHTML=visible.map(bowler=>`<button type="button" role="option" data-explorer-id="${escapeHtml(bowler.id)}">
    <span><strong>${escapeHtml(bowler.name)}</strong><small>${escapeHtml(bowler.hometown || "Hometown unavailable")}</small></span>
    <span class="explorer-result-stats"><strong>#${bowler.rank}${bowler.tied?"T":""}</strong><small>${Number(bowler.total).toLocaleString()} pins · ${Number(bowler.average).toFixed(2)}</small></span>
  </button>`).join("");

  if(matches.length>visible.length){
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
  const otherYear=String(year)==="2026" ? "2025" : "2026";
  const otherYearData=explorerYearData(otherYear);
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
  relevant.forEach(report=>sourceLinks.push(`<a href="${escapeHtml(report.source_url)}" target="_blank" rel="noopener">Day ${report.round} report ↗</a>`));
  if(!sourceLinks.length){
    section.hidden=true;
    links.innerHTML="";
    return;
  }

  section.hidden=false;
  setText(
    "explorer-source-note",
    yearData.archive_note || `${yearData.year} results reflect the latest valid official U18 Boys reports available to the dashboard.`
  );
  links.innerHTML=[...new Set(sourceLinks)].join("");
}

function renderExplorerProfile(year,yearData,profile){
  const profileElement=document.getElementById("explorer-profile");
  setText("explorer-profile-kicker",`${year} ${yearData.status==="final"?"final":"live"} U18 Boys results`);
  setText("explorer-profile-name",profile.name);
  setText("explorer-profile-meta",`${profile.hometown || "Hometown unavailable"} · Squad ${profile.squad} · Latest posted Day ${profile.latest_round}`);

  const metrics=[
    explorerMetric("Position",`#${profile.rank}${profile.tied?"T":""} of ${Number(yearData.field_size).toLocaleString()}`,yearData.status==="live"?"Published field; may change":"Final qualifying field"),
    explorerMetric("Total pins",Number(profile.total).toLocaleString()),
    explorerMetric("Average",Number(profile.average).toFixed(2)),
    explorerMetric("Games complete",`${profile.games_complete} of 16`),
    explorerMetric("Squad",profile.squad)
  ].filter(Boolean);
  document.getElementById("explorer-profile-metrics").innerHTML=metrics.join("");

  renderExplorerYearComparison(year,yearData,profile);
  renderExplorerBlocks(yearData,profile);
  renderExplorerSources(yearData,profile);
  profileElement.hidden=false;
}

function selectExplorerProfile(year,id,{updateUrl=true,scroll=true}={}){
  const yearData=explorerYearData(year);
  const profile=(yearData?.bowlers || []).find(bowler=>bowler.id===id);
  if(!profile) return false;

  setExplorerYear(year);
  explorerSelectedProfile=profile;
  document.getElementById("explorer-search").value=profile.name;
  document.getElementById("explorer-results").innerHTML="";
  setText("explorer-search-status",`Showing ${profile.name}'s ${year} U18 Boys results.`);
  renderExplorerProfile(String(year),yearData,profile);

  if(updateUrl){
    const url=new URL(location.href);
    url.searchParams.set("year",String(year));
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
  url.searchParams.set("year",explorerSelectedYear);
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
      const targetYearData=explorerYearData(targetYear);
      const match=explorerSelectedProfile ? matchingExplorerProfile(explorerSelectedProfile,targetYearData) : null;
      setExplorerYear(targetYear);
      if(match) selectExplorerProfile(targetYear,match.id);
      else clearExplorerProfile();
    });
  });
  document.getElementById("explorer-clear").addEventListener("click",()=>clearExplorerProfile());
  document.getElementById("explorer-copy-link").addEventListener("click",copyExplorerProfileLink);
}

async function loadBowlerExplorer(){
  const response=await fetch(`data/bowlers.json?v=${Date.now()}`,{cache:"no-store"});
  if(!response.ok) throw new Error(`Bowler explorer returned ${response.status}`);
  bowlerExplorerData=await response.json();
  const live=explorerYearData("2026");
  const archive=explorerYearData("2025");
  const liveCount=live?.bowlers?.length || 0;
  const archiveCount=archive?.bowlers?.length || 0;
  setText("explorer-count-2026",liveCount?`${liveCount.toLocaleString()} live`:"Unavailable");
  setText("explorer-count-2025",archiveCount?`${archiveCount.toLocaleString()} final`:"Unavailable");
  setText("explorer-data-status",`${liveCount.toLocaleString()} live · ${archiveCount.toLocaleString()} archived`);
  document.getElementById("explorer-search").disabled=false;
  bindBowlerExplorer();

  const params=new URLSearchParams(location.search);
  const requestedYear=params.get("year")==="2025" ? "2025" : "2026";
  const requestedBowler=params.get("bowler");
  setExplorerYear(requestedYear);
  if(requestedBowler && selectExplorerProfile(requestedYear,requestedBowler,{updateUrl:false,scroll:false})) return;
  setText("explorer-search-status",`Type at least two characters to search the ${requestedYear} U18 Boys field.`);
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

function renderProgress(history,current,projection){
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
    chart.innerHTML='<p class="muted">The progress comparison will appear when Jack\'s first scores are posted.</p>';
    positionHistory.innerHTML="";
    return;
  }

  const values=snapshots.flatMap(snapshot=>[snapshot.average,snapshot.cut_pace_average]).filter(Number.isFinite);
  const chartMax=Math.min(300,Math.max(200,Math.ceil(Math.max(...values,200)/25)*25));
  const chartLabel=snapshots.map(snapshot=>{
    const cut=Number.isFinite(snapshot.cut_pace_average) ? snapshot.cut_pace_average.toFixed(2) : "unavailable";
    return `After ${snapshot.games_complete} games, Jack averaged ${snapshot.average.toFixed(2)} and the estimated cut pace was ${cut}`;
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
            <div class="chart-bar cut-bar" style="--bar-height:${cutHeight}%"><span>${Number.isFinite(snapshot.cut_pace_average)?snapshot.cut_pace_average.toFixed(2):"—"}</span></div>
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
    const gap=snapshot.pins_from_cut==null ? "Gap pending" : `${Number(snapshot.pins_from_cut)>0?"+":""}${snapshot.pins_from_cut} vs. pace`;
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
  document.getElementById("blocks").innerHTML=blocks.map((b,i)=>`
    <article class="block">
      <h3>Round ${i+1}</h3>
      <div class="games">${(b.games||[]).map(g=>`<span class="game">${g}</span>`).join("") || '<span class="muted">Not bowled</span>'}</div>
      <p class="block-total">${b.total ? `${b.total} pins · ${(b.total/b.games.length).toFixed(2)} avg.` : "Pending"}</p>
    </article>`).join("");
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

function renderAlabamaStatus(status){
  const pill=document.getElementById("alabama-status-pill");
  const note=document.getElementById("alabama-status-note");
  if(!pill || !note) return;

  // Trust report coverage, not the wall clock. Bowl.com may post a squad late.
  const isComplete=status.status==="complete";

  pill.textContent=isComplete ? "Day 1 field complete" : "Partial Day 1 field";
  pill.className=`pill ${isComplete ? "alabama-complete" : "alabama-partial"}`;
  note.textContent=isComplete
    ? (status.complete_note || "The Alabama bowler list is complete and reflects the latest Bowl.com report.")
    : (status.partial_note || "Additional Alabama bowlers are scheduled later today. This list will expand as their scores are posted, and will be complete after today's squads.");
}

function renderAlabama(bowlers,jackTotal){
  const body=document.getElementById("alabama-bowlers");
  if(!body) return;
  if(!bowlers.length){
    body.innerHTML='<tr><td colspan="8" class="muted">No Alabama bowlers found in the latest report.</td></tr>';
    renderFavoriteBowlers([],jackTotal);
    return;
  }

  body.innerHTML=bowlers.map((b,index)=>{
    const isJack=b.name.toLowerCase()==="jack wix";
    const isFavorite=favoriteBowlers.includes(b.name);
    const diff=isJack ? 0 : Number(b.total)-Number(jackTotal);
    const diffText=diff===0 ? "Jack" : `${diff>0?"+":""}${diff}`;

    return `<tr class="${isJack?"jack":""}">
      <td class="favorite-cell" data-label="Favorite">
        <button class="favorite-button" type="button" data-favorite-index="${index}" aria-pressed="${isFavorite}" aria-label="${isFavorite?"Remove":"Add"} ${escapeHtml(b.name)} ${isFavorite?"from":"to"} favorites">${isFavorite?"★":"☆"}</button>
      </td>
      <td class="rank" data-label="Rank">#${b.rank}${b.tied?"T":""}</td>
      <td class="bowler" data-label="Bowler">
        <button class="bowler-name-button" type="button" data-bowler-index="${index}" aria-label="View tournament details for ${escapeHtml(b.name)}">
          ${escapeHtml(b.name)}${isJack?" ⭐":""}
        </button>
      </td>
      <td data-label="Hometown">${escapeHtml(b.hometown)}</td>
      <td data-label="Games">${b.games_complete}</td>
      <td data-label="Total">${b.total}</td>
      <td data-label="Average">${Number(b.average).toFixed(2)}</td>
      <td data-label="vs. Jack" class="${diff>0?"positive":diff<0?"negative":""}">${diffText}</td>
    </tr>`;
  }).join("");

  body.querySelectorAll(".bowler-name-button").forEach(button=>{
    button.addEventListener("click",()=>{
      const bowler=bowlers[Number(button.dataset.bowlerIndex)];
      openBowlerDialog(bowler,jackTotal);
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
      renderAlabama(bowlers,jackTotal);
    });
  });

  renderFavoriteBowlers(bowlers,jackTotal);
}

function renderFavoriteBowlers(bowlers,jackTotal){
  const container=document.getElementById("favorite-bowlers");
  if(!container) return;
  const favorites=bowlers.filter(bowler=>favoriteBowlers.includes(bowler.name));
  if(!favorites.length){
    container.innerHTML='<p class="favorites-empty">No favorites selected yet. Star Alabama bowlers to keep their latest position and average together here.</p>';
    return;
  }

  container.innerHTML=favorites.map(bowler=>{
    const index=bowlers.indexOf(bowler);
    const isJack=bowler.name.toLowerCase()==="jack wix";
    const diff=isJack ? 0 : Number(bowler.total)-Number(jackTotal);
    return `<article class="favorite-card ${isJack?"jack-favorite":""}">
      <button type="button" class="favorite-profile" data-bowler-index="${index}">${escapeHtml(bowler.name)}</button>
      <div><span>Rank</span><strong>#${bowler.rank}${bowler.tied?"T":""}</strong></div>
      <div><span>Average</span><strong>${Number(bowler.average).toFixed(2)}</strong></div>
      <div><span>vs. Jack</span><strong>${isJack?"Jack":`${diff>0?"+":""}${diff}`}</strong></div>
    </article>`;
  }).join("");

  container.querySelectorAll(".favorite-profile").forEach(button=>{
    button.addEventListener("click",()=>openBowlerDialog(bowlers[Number(button.dataset.bowlerIndex)],jackTotal));
  });
}

function openBowlerDialog(bowler,jackTotal){
  const dialog=document.getElementById("bowler-dialog");
  if(!dialog || !bowler) return;

  const isJack=bowler.name.toLowerCase()==="jack wix";
  const diff=isJack ? 0 : Number(bowler.total)-Number(jackTotal);

  setText("bowler-dialog-title",bowler.name);
  setText("bowler-dialog-hometown",bowler.hometown || "Alabama");

  const stats=[
    ["Overall rank",`#${bowler.rank}${bowler.tied?"T":""}${dashboardData?.field_size?.current_report ? ` of ${dashboardData.field_size.current_report}` : ""}`],
    ["Games complete",bowler.games_complete ?? "—"],
    ["Total pins",bowler.total ?? "—"],
    ["Average",bowler.average == null ? "—" : Number(bowler.average).toFixed(2)],
    ["Compared with Jack",isJack ? "Jack" : `${diff>0?"+":""}${diff} pins`]
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
        <p>${total == null ? "Pending" : `${total} pins · ${(total/games.length).toFixed(2)} avg.`}</p>
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
  const current=data.current || {};
  const field=data.field_size?.current_report ?? current.field_size;
  const next=(data.schedule || []).find(event=>new Date(event.start).getTime()>Date.now());
  const lines=[
    `Jack Wix Junior Gold update: #${current.position ?? "—"}${field ? ` of ${field}` : ""} after ${current.games_complete ?? "—"} of 16 qualifying games.`,
    `${current.total ?? "—"} total pins · ${current.average==null?"—":Number(current.average).toFixed(2)} average.`
  ];
  if(next) lines.push(`Next: ${next.title}, ${fmt.format(new Date(next.start))} at ${next.location}.`);
  lines.push(data.site?.url || "https://jasonwix.github.io/jack-wix-junior-gold/");
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
        await navigator.share({title:"Jack Wix · Junior Gold 2026",text,url:dashboardData.site?.url || location.href});
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
setupCollapsibleSections();
setupSectionControls();
setupBowlerDialog();
setupShareButton();
load().catch(err=>{console.error(err);setText("next-title","Unable to load dashboard data")});
