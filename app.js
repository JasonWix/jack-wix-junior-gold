let dashboardData = null;

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
      fieldFinal
        ? "Total U18B participants"
        : "Participants posted in the latest report; final field updates after remaining Day 1 squads"
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

  renderBlocks(d.blocks);
  renderEquipment(d.equipment || {});
  renderAlabamaStatus(d.alabama_status || {});
  renderAlabama(d.alabama_bowlers || [], d.current.total);
  renderLastQualifier(d.schedule, d.blocks);
  renderSchedule(d.schedule);
  startCountdown(d.schedule);
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

function renderAlabamaStatus(status){
  const pill=document.getElementById("alabama-status-pill");
  const note=document.getElementById("alabama-status-note");
  if(!pill || !note) return;

  const completeAfter=status.complete_after ? new Date(status.complete_after).getTime() : null;
  const isComplete=status.status==="complete" || (completeAfter && Date.now() >= completeAfter);

  pill.textContent=isComplete ? "Complete after today" : "Partial today";
  pill.className=`pill ${isComplete ? "alabama-complete" : "alabama-partial"}`;
  note.textContent=isComplete
    ? (status.complete_note || "The Alabama bowler list is complete and reflects the latest Bowl.com report.")
    : (status.partial_note || "Additional Alabama bowlers are scheduled later today. This list will expand as their scores are posted, and will be complete after today's squads.");
}

function renderAlabama(bowlers,jackTotal){
  const body=document.getElementById("alabama-bowlers");
  if(!body) return;
  if(!bowlers.length){
    body.innerHTML='<tr><td colspan="7" class="muted">No Alabama bowlers found in the latest report.</td></tr>';
    return;
  }

  body.innerHTML=bowlers.map((b,index)=>{
    const isJack=b.name.toLowerCase()==="jack wix";
    const diff=isJack ? 0 : Number(b.total)-Number(jackTotal);
    const diffText=diff===0 ? "Jack" : `${diff>0?"+":""}${diff}`;

    return `<tr class="${isJack?"jack":""}">
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
setupBowlerDialog();
load().catch(err=>{console.error(err);setText("next-title","Unable to load dashboard data")});
